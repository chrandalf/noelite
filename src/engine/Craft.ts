// The craft. One rigid body, DESIGN.md §5 "Flight: one model, not two".
//
// Thrust fires along the body's own up-axis, so you tilt to move and tilt back
// to stop, and nothing forgives you. Gravity and drag are functions of altitude:
// on the deck this is Zarch, in orbit it is Elite, and it is the same code.
//
// Integrates at FIXED_DT so a recorded input tape replays exactly. No browser
// dependency: tools/verify-flight.mjs drives this straight from Node.
import * as THREE from 'three'
import type { PlanetSeed } from '../world/height.ts'
import { groundRadius, surfaceNormal, slopeDeg } from '../world/terrain.ts'
import {
  PLANET_RADIUS, GRAVITY, ATMOSPHERE_HEIGHT, DRAG, THRUST_ACCEL, ANG_ACCEL, ANG_DAMP,
  HULL_CLEARANCE, LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE, FIXED_DT,
} from '../world/config.ts'

/** pitch: nose down positive. roll: right wing down positive. yaw: nose right positive. All -1..1. thrust 0..1. */
export type Controls = { pitch: number; roll: number; yaw: number; thrust: number }
export const IDLE: Readonly<Controls> = Object.freeze({ pitch: 0, roll: 0, yaw: 0, thrust: 0 })

export type CraftState = 'landed' | 'flying' | 'crashed'

const BODY_UP = new THREE.Vector3(0, 1, 0)
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

  private readonly seed: PlanetSeed
  private accumulator = 0
  private readonly up = new THREE.Vector3()
  private readonly bodyUp = new THREE.Vector3()
  private readonly acc = new THREE.Vector3()
  private readonly dq = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly n = new THREE.Vector3()

  constructor(seed: PlanetSeed) {
    this.seed = seed
  }

  /** Altitude of the hull's feet above the ground directly below. */
  altitude(): number {
    this.up.copy(this.pos).normalize()
    return this.pos.length() - groundRadius(this.up, this.seed) - HULL_CLEARANCE
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
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.seed) + HULL_CLEARANCE)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(align === 'surface' ? surfaceNormal(this.up, this.seed, this.n) : this.n.copy(this.up), heading)
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
      if (this.state === 'landed' && c.thrust > 0) this.state = 'flying'
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
    const alt = r - groundRadius(this.up, this.seed)
    const g = GRAVITY * (PLANET_RADIUS / r) ** 2
    this.acc.copy(this.up).multiplyScalar(-g)
    if (c.thrust > 0) {
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.quat)
      this.acc.addScaledVector(this.bodyUp, THRUST_ACCEL * c.thrust)
    }
    const x = 1 - Math.min(1, Math.max(0, alt / ATMOSPHERE_HEIGHT))
    const rho = x * x * (3 - 2 * x) // smoothstep to zero at the top of the atmosphere
    const speed = this.vel.length()
    if (rho > 0 && speed > 0) this.acc.addScaledVector(this.vel, -DRAG * rho * speed)

    this.vel.addScaledVector(this.acc, h)
    this.pos.addScaledVector(this.vel, h)

    // Contact.
    const r2 = this.pos.length()
    this.up.copy(this.pos).divideScalar(r2)
    const ground = groundRadius(this.up, this.seed)
    if (r2 - ground < HULL_CLEARANCE) {
      const vUp = this.vel.dot(this.up)
      const vH = Math.sqrt(Math.max(0, this.vel.lengthSq() - vUp * vUp))
      const tilt = this.tilt()
      const slope = slopeDeg(this.up, this.seed)
      this.lastContact = { vUp, vH, tilt, slope }
      this.pos.copy(this.up).multiplyScalar(ground + HULL_CLEARANCE)
      this.vel.set(0, 0, 0)
      this.angVel.set(0, 0, 0)
      const gentle = vUp > -LAND_MAX_VSPEED && vH < LAND_MAX_HSPEED && tilt < LAND_MAX_TILT && slope < LAND_MAX_SLOPE
      if (gentle) {
        this.state = 'landed'
        this.landings++
        this.alignTo(surfaceNormal(this.up, this.seed, this.n))
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
