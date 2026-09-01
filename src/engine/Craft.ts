// The craft. One rigid body, DESIGN.md §5 "Flight: one model, not two".
//
// Thrust fires along the body's own up-axis, so you tilt to move and tilt back
// to stop, and nothing forgives you. Gravity and drag are functions of altitude:
// on the deck this is Zarch, in orbit it is Elite, and it is the same code.
//
// Integrates at FIXED_DT so a recorded input tape replays exactly. No browser
// dependency: tools/verify-flight.mjs drives this straight from Node.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { groundRadius, surfaceNormal, slopeDeg } from '../world/terrain.ts'
import { atmosphereDensity } from '../world/atmosphere.ts'
import {
  DRAG, THRUST_ACCEL, ANG_ACCEL, ANG_DAMP,
  HULL_CLEARANCE, LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE, FIXED_DT,
  BOOST_MULT, GROUND_EFFECT_HEIGHT, GROUND_EFFECT_ACCEL, GROUND_EFFECT_DAMP, GRAVITY_FALLOFF, RCS_ACCEL,
} from '../world/config.ts'

/**
 * pitch: nose down positive. roll: right wing down positive. yaw: nose right positive. All -1..1.
 * thrust 0..1 on the main engine, boost 0..1 multiplies it.
 * RCS, body frame, small: lateral (+ right), vertical (− is the top thruster pushing you down), fore (+ rear thruster pushing you forward).
 */
export type Controls = { pitch: number; roll: number; yaw: number; thrust: number; boost: number; lateral: number; vertical: number; fore: number }
export const IDLE: Readonly<Controls> = Object.freeze({ pitch: 0, roll: 0, yaw: 0, thrust: 0, boost: 0, lateral: 0, vertical: 0, fore: 0 })

export type CraftState = 'landed' | 'flying' | 'crashed'

const BODY_UP = new THREE.Vector3(0, 1, 0)

/** m/s² at distance r from the body's centre. */
export function gravityAt(r: number, t: Terrain): number {
  return t.g * (t.radius / r) ** GRAVITY_FALLOFF
}
const BODY_FWD = new THREE.Vector3(0, 0, -1)

export class Craft {
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  /** Body frame, rad/s. */
  readonly angVel = new THREE.Vector3()
  state: CraftState = 'landed'
  thrusting = false
  landings = 0
  crashes = 0
  /** Set by the last contact, for the HUD and the harness. */
  lastContact = { vUp: 0, vH: 0, tilt: 0, slope: 0 }

  readonly terrain: Terrain
  private accumulator = 0
  private readonly up = new THREE.Vector3()
  private readonly bodyUp = new THREE.Vector3()
  private readonly acc = new THREE.Vector3()
  private readonly dq = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly n = new THREE.Vector3()
  private readonly rcs = new THREE.Vector3()

  constructor(terrain: Terrain) {
    this.terrain = terrain
  }

  /** Altitude of the hull's feet above the ground directly below. */
  altitude(): number {
    this.up.copy(this.pos).normalize()
    return this.pos.length() - groundRadius(this.up, this.terrain) - HULL_CLEARANCE
  }

  /** Atmospheric density where the craft is, 1 on the deck, 0 in vacuum. */
  atmosphere(): number { return atmosphereDensity(this.altitude() + HULL_CLEARANCE, this.terrain.air) }

  speed(): number { return this.vel.length() }
  /** Circular orbital speed at the craft's current radius. */
  orbitalSpeed(): number { const r = this.pos.length(); return Math.sqrt(gravityAt(r, this.terrain) * r) }
  /** Speed beyond which gravity never brings you back. */
  escapeSpeed(): number { const r = this.pos.length(); return Math.sqrt(2 * gravityAt(r, this.terrain) * r) }

  /**
   * Attitude assist. Pitch and roll inputs that swing the thrust axis (body up)
   * toward `target` (unit, world). A P-controller on angular velocity whose
   * setpoint is the angle error, so it plays the same keys a pilot would.
   */
  aimControls(target: THREE.Vector3, k = 3): { pitch: number; roll: number } {
    this.dq.copy(this.quat).invert()
    this.fwd.copy(target).applyQuaternion(this.dq) // target in body frame
    let tx = this.fwd.x, tz = this.fwd.z
    // Dead astern the cross product vanishes and a P-controller balances on the
    // point forever (boost straight up, press retro: exactly this). Pitch over.
    if (this.fwd.y < -0.995 && Math.hypot(tx, tz) < 0.05) { tx = 0; tz = 1 }
    const clamp = (x: number) => Math.max(-1, Math.min(1, x))
    return { pitch: -clamp(k * tz - this.angVel.x), roll: -clamp(-k * tx - this.angVel.z) }
  }

  /** Vertical speed, positive up. */
  vUp(): number { return this.vel.dot(this.up.copy(this.pos).normalize()) }

  /** Degrees between the craft's up and the local vertical. */
  tilt(): number {
    this.up.copy(this.pos).normalize()
    this.bodyUp.copy(BODY_UP).applyQuaternion(this.quat)
    return (Math.acos(Math.min(1, Math.max(-1, this.bodyUp.dot(this.up)))) * 180) / Math.PI
  }

  /**
   * Put it down at rest in direction `dir`, feet on the ground, nose along `heading` if given.
   * `align: 'surface'` sits it on the slope, so thrust from a tilted pad pushes you sideways,
   * which is honest. `'radial'` is dead level, for harnesses that only want to test landing.
   */
  spawnOn(dir: THREE.Vector3, heading?: THREE.Vector3, align: 'surface' | 'radial' = 'surface'): void {
    this.up.copy(dir).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(align === 'surface' ? surfaceNormal(this.up, this.terrain, this.n) : this.n.copy(this.up), heading)
    this.state = 'landed'
    this.thrusting = false
    this.accumulator = 0
  }

  /** Advance by real time; integrates in FIXED_DT substeps. Returns substeps taken. */
  step(dt: number, c: Controls): number {
    this.accumulator += Math.min(dt, 0.25)
    let n = 0
    while (this.accumulator >= FIXED_DT) { this.substep(FIXED_DT, c); this.accumulator -= FIXED_DT; n++ }
    return n
  }

  /** One exact substep. The harness calls this directly. */
  substep(h: number, c: Controls): void {
    this.thrusting = c.thrust > 0
    if (this.state !== 'flying') {
      if (this.state === 'landed' && (c.thrust > 0 || c.vertical > 0)) this.state = 'flying'
      else return
    }

    // Attitude. Torque in body frame, exponential damping, first-order quaternion update.
    this.angVel.x -= c.pitch * ANG_ACCEL * h
    this.angVel.z -= c.roll * ANG_ACCEL * h
    this.angVel.y -= c.yaw * ANG_ACCEL * 0.6 * h
    this.angVel.multiplyScalar(Math.exp(-ANG_DAMP * h))
    this.dq.set(this.angVel.x * h * 0.5, this.angVel.y * h * 0.5, this.angVel.z * h * 0.5, 1).normalize()
    this.quat.multiply(this.dq).normalize()

    // Forces.
    const r = this.pos.length()
    this.up.copy(this.pos).divideScalar(r)
    const alt = r - groundRadius(this.up, this.terrain)
    const g = gravityAt(r, this.terrain)
    this.acc.copy(this.up).multiplyScalar(-g)
    if (c.thrust > 0) {
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.quat)
      this.acc.addScaledVector(this.bodyUp, THRUST_ACCEL * c.thrust * (1 + c.boost * (BOOST_MULT - 1)))
    }
    // RCS: small pushes along the body axes. Translation without tilting.
    if (c.lateral || c.vertical || c.fore) {
      this.rcs.set(c.lateral, c.vertical, -c.fore).multiplyScalar(RCS_ACCEL).applyQuaternion(this.quat)
      this.acc.add(this.rcs)
    }
    // Ground effect. A cushion in the last few metres, plus damping against
    // descent, both fading to nothing at GROUND_EFFECT_HEIGHT. It is the ground
    // answering back, and it is what makes the last part of a landing readable.
    const feet = alt - HULL_CLEARANCE
    if (feet < GROUND_EFFECT_HEIGHT) {
      const k = 1 - Math.max(0, feet) / GROUND_EFFECT_HEIGHT
      this.acc.addScaledVector(this.up, GROUND_EFFECT_ACCEL * k)
      const vUp = this.vel.dot(this.up)
      if (vUp < 0) this.acc.addScaledVector(this.up, -vUp * GROUND_EFFECT_DAMP * k)
    }
    const rho = atmosphereDensity(alt, this.terrain.air)
    const speed = this.vel.length()
    if (rho > 0 && speed > 0) this.acc.addScaledVector(this.vel, -DRAG * rho * speed)

    this.vel.addScaledVector(this.acc, h)
    this.pos.addScaledVector(this.vel, h)

    // Contact.
    const r2 = this.pos.length()
    this.up.copy(this.pos).divideScalar(r2)
    const ground = groundRadius(this.up, this.terrain)
    if (r2 - ground < HULL_CLEARANCE) {
      const vUp = this.vel.dot(this.up)
      const vH = Math.sqrt(Math.max(0, this.vel.lengthSq() - vUp * vUp))
      const tilt = this.tilt()
      const slope = slopeDeg(this.up, this.terrain)
      this.lastContact = { vUp, vH, tilt, slope }
      this.pos.copy(this.up).multiplyScalar(ground + HULL_CLEARANCE)
      this.vel.set(0, 0, 0)
      this.angVel.set(0, 0, 0)
      const gentle = vUp > -LAND_MAX_VSPEED && vH < LAND_MAX_HSPEED && tilt < LAND_MAX_TILT && slope < LAND_MAX_SLOPE
      if (gentle) {
        this.state = 'landed'
        this.landings++
        this.alignTo(surfaceNormal(this.up, this.terrain, this.n))
      } else {
        this.state = 'crashed'
        this.crashes++
      }
    }
  }

  /** Rotate so body-up matches `up`, keeping the current heading (or taking `heading`). */
  private alignTo(up: THREE.Vector3, heading?: THREE.Vector3): void {
    if (heading) this.fwd.copy(heading)
    else this.fwd.copy(BODY_FWD).applyQuaternion(this.quat)
    this.fwd.addScaledVector(up, -this.fwd.dot(up))
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(1, 0, 0).addScaledVector(up, -up.x)
    this.fwd.normalize()
    // Matrix4.lookAt puts -Z toward the target, which is exactly body-forward.
    this.m.lookAt(new THREE.Vector3(), this.fwd, up)
    this.quat.setFromRotationMatrix(this.m)
  }
}
