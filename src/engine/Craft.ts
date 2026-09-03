// The craft. One rigid body, DESIGN.md §5 "Flight: one model, not two".
//
// Since Stage C (2026-09-02) the truth is heliocentric: `hpos`, `hvel`, `hquat` in
// the sun's inertial frame, gravity summed from every body in the system, and a
// reference body chosen by sphere of influence. Everything outside reads the LOCAL
// VIEW instead: `pos`, `vel`, `quat` in the reference body's rotating frame with a
// ground-relative velocity, which is what the renderer, the camera, the HUD and the
// harness always read. Landed means riding the body: the rest pose is body-fixed and
// the heliocentric state is re-derived from it every step, so lifting off inherits
// the surface velocity without anyone having to remember to add it.
//
// Thrust fires along the body's own up-axis in air (tilt to move, tilt back to
// stop) and along the nose in vacuum (cruise). Integrates at FIXED_DT so a recorded
// input tape replays exactly. No browser dependency: tools/verify-flight.mjs drives
// this straight from Node.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { terrainOf, padOf } from '../world/height.ts'
import { groundRadius, surfaceNormal, slopeDeg, setGroundClock } from '../world/terrain.ts'
import { wind } from '../world/weather.ts'
import { atmosphereDensity } from '../world/atmosphere.ts'
import { SYSTEM, body, bodyPosition, bodyVelocity, bodySpin, type Body } from '../world/system.ts'
import {
  DRAG, THRUST_ACCEL, ANG_ACCEL, ANG_DAMP,
  HULL_CLEARANCE, LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE, FIXED_DT,
  BOOST_MULT, GROUND_EFFECT_HEIGHT, GROUND_EFFECT_ACCEL_G, GROUND_EFFECT_DAMP, GRAVITY_FALLOFF, RCS_ACCEL,
  CRUISE_ENTER, CRUISE_EXIT, CRUISE_FLOOR, CRUISE_ALIGN_TAU, CRUISE_MAX, CRUISE_BRAKE, CRUISE_DECEL, CRUISE_SECONDS, CRUISE_SPOOL,
  FUEL_TANK, FUEL_HOVER_BURN, FUEL_CRUISE_BURN, FUEL_RCS_BURN, FUEL_PAD_REFILL, FUEL_SOLAR_TRICKLE, FUEL_RELIGHT, PAD_RADIUS,
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
const BODY_FWD = new THREE.Vector3(0, 0, -1)
const TWO_PI = Math.PI * 2

/** 1 below CRUISE_FLOOR, 0 above twice it. See Craft.hold. */
function holdAt(alt: number): number { return Math.min(1, Math.max(0, (2 * CRUISE_FLOOR - alt) / CRUISE_FLOOR)) }

/** m/s² at distance r from the body's centre. Readouts (orbital and escape speed); the integrator sums real μ/r² from every body. */
export function gravityAt(r: number, t: Terrain): number {
  return t.g * (t.radius / r) ** GRAVITY_FALLOFF
}

export class Craft {
  /** Local view: the reference body's rotating frame, velocity relative to the ground. */
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  /** The truth: heliocentric, inertial. */
  readonly hpos = new THREE.Vector3()
  readonly hvel = new THREE.Vector3()
  readonly hquat = new THREE.Quaternion()
  /** Body frame, rad/s. */
  readonly angVel = new THREE.Vector3()
  /** Simulation clock, seconds. The system is a function of it. */
  time = 0
  /** The body whose sphere of influence you are in. Frame, ground, air and altimeter all follow it. */
  ref: Body
  terrain: Terrain
  /** True for the step in which the reference body changed, so the camera can snap to the new frame. */
  refChanged = false
  state: CraftState = 'landed'
  thrusting = false
  /**
   * False near ground or in air: Zarch, thrust along body-up, tilt to move. True in
   * vacuum and high up: cruise, thrust along the nose, velocity follows the nose,
   * / brakes. Switches on density with hysteresis, and never above CRUISE_FLOOR of
   * altitude, so an airless moon still gets a hover landing.
   */
  cruise = false
  /** Metres to the nearest body's surface, whichever body that is. Drives the cruise cap and thrust gain. */
  proximity = Infinity
  /** Metres to the surface of the target ahead, set by whoever knows the target; Infinity for none. Caps cruise too, so you arrive. */
  arrive = Infinity
  /** Weather on. The harness turns it off for tests that are not about weather. */
  windy = true
  /** The wind at the craft, m/s, local frame. Zero in vacuum. */
  readonly wind = new THREE.Vector3()
  landings = 0
  crashes = 0
  /** Units in the tank, 0..FUEL_TANK. Dry means the engine and the RCS do nothing. */
  fuel = FUEL_TANK
  /** Units per second going out of the tank this substep, for the endurance readout. */
  burn = 0
  /** Set by the last contact, for the HUD and the harness. */
  lastContact = { vUp: 0, vH: 0, tilt: 0, slope: 0 }

  private accumulator = 0
  /**
   * How much of the reference body's spin the local frame carries: 1 on the ground and
   * through the air, fading to 0 by twice CRUISE_FLOOR. Drag is against co-rotating air
   * and a landing is judged against the ground; in orbit the frame stops turning, because
   * the sun's co-rotating frame at home's distance moves at 650 km/s and nobody wants that
   * in a speed readout. Position never fades (the scene is drawn in the spinning frame);
   * only what "relative velocity" means.
   */
  private hold = 1
  // Rest pose, body-fixed, held while landed or crashed.
  private readonly restPos = new THREE.Vector3()
  private readonly restQuat = new THREE.Quaternion()
  // The reference body's frame at `time`: centre, velocity, spin, angular velocity (inertial).
  private readonly bPos = new THREE.Vector3()
  private readonly bVel = new THREE.Vector3()
  private readonly spin = new THREE.Quaternion()
  private readonly spinInv = new THREE.Quaternion()
  private readonly omega = new THREE.Vector3()
  // Scratch.
  private readonly rel = new THREE.Vector3()
  private readonly frameVel = new THREE.Vector3()
  private readonly vRel = new THREE.Vector3()
  private readonly localDir = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly bodyUp = new THREE.Vector3()
  private readonly acc = new THREE.Vector3()
  private readonly dq = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly n = new THREE.Vector3()
  private readonly rcs = new THREE.Vector3()
  private readonly nose = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()

  /** `terrain` names the starting body; the craft looks the body up by id. */
  constructor(terrain: Terrain) {
    this.ref = body(terrain.id)
    this.terrain = terrain
  }

  /** Altitude of the hull's feet above the ground directly below. */
  altitude(): number {
    this.up.copy(this.pos).normalize()
    return this.pos.length() - groundRadius(this.up, this.terrain) - HULL_CLEARANCE
  }

  /** Atmospheric density where the craft is, 1 on the deck, 0 in vacuum. */
  atmosphere(): number { return atmosphereDensity(this.altitude() + HULL_CLEARANCE, this.terrain.air) }

  /** Ground-relative speed: what the pilot feels and what a landing is judged on. */
  speed(): number { return this.vel.length() }
  /** Speed relative to the reference body's centre, not its spin: the one to compare with orbital speed. */
  inertialSpeed(): number { return this.tmp.copy(this.hvel).sub(this.bVel).length() }
  /** Circular orbital speed at the craft's current radius. */
  orbitalSpeed(): number { const r = this.pos.length(); return Math.sqrt(gravityAt(r, this.terrain) * r) }
  /** Speed beyond which gravity never brings you back. */
  escapeSpeed(): number { const r = this.pos.length(); return Math.sqrt(2 * gravityAt(r, this.terrain) * r) }

  /** Seconds the tank lasts at the current burn; Infinity when nothing is burning. */
  endurance(): number { return this.burn > 0 ? this.fuel / this.burn : Infinity }
  /** Within PAD_RADIUS of the reference body's pad, measured along the ground. */
  onPad(): boolean {
    const site = padOf(this.terrain)
    if (!site) return false
    this.up.copy(this.pos).normalize()
    const cos = this.up.x * site.dir.x + this.up.y * site.dir.y + this.up.z * site.dir.z
    return Math.acos(Math.min(1, cos)) * this.terrain.radius < PAD_RADIUS
  }

  /**
   * Attitude assist. Pitch and roll inputs that swing the thrust axis (body up)
   * toward `target` (unit, local frame). A P-controller on angular velocity whose
   * setpoint is the angle error, so it plays the same keys a pilot would.
   */
  aimControls(target: THREE.Vector3, k = 3): { pitch: number; roll: number; yaw: number } {
    this.dq.copy(this.quat).invert()
    this.fwd.copy(target).applyQuaternion(this.dq) // target in body frame
    const clamp = (x: number) => Math.max(-1, Math.min(1, x))
    if (this.cruise) {
      // Aim the nose (-Z). Error axis is fwd × t = (ty, -tx, 0): pitch and yaw, roll free.
      let tx = this.fwd.x, ty = this.fwd.y
      if (this.fwd.z > 0.995 && Math.hypot(tx, ty) < 0.05) ty = 1 // dead astern: pitch up and over
      return { pitch: -clamp(k * ty - this.angVel.x), roll: 0, yaw: -clamp((-k * tx - this.angVel.y) / 0.6) }
    }
    let tx = this.fwd.x, tz = this.fwd.z
    // Dead astern the cross product vanishes and a P-controller balances on the
    // point forever (boost straight up, press retro: exactly this). Pitch over.
    if (this.fwd.y < -0.995 && Math.hypot(tx, tz) < 0.05) { tx = 0; tz = 1 }
    return { pitch: -clamp(k * tz - this.angVel.x), roll: -clamp(-k * tx - this.angVel.z), yaw: 0 }
  }

  /** The cruise speed allowed at distance d from a surface: brakeable near it, d / CRUISE_SECONDS far from it. */
  cruiseCap(d: number): number {
    d = Math.max(0, d)
    return Math.max(Math.sqrt(CRUISE_MAX * CRUISE_MAX + 2 * CRUISE_DECEL * d), d / CRUISE_SECONDS)
  }
  /** The cap in force now: the nearest body's, or the target's if that is tighter. */
  cap(): number { return Math.min(this.cruiseCap(this.proximity), this.cruiseCap(this.arrive)) }

  /** Vertical speed, positive up, relative to the ground. */
  vUp(): number { return this.vel.dot(this.up.copy(this.pos).normalize()) }

  /** Degrees between the craft's up and the local vertical. */
  tilt(): number {
    this.up.copy(this.pos).normalize()
    this.bodyUp.copy(BODY_UP).applyQuaternion(this.quat)
    return (Math.acos(Math.min(1, Math.max(-1, this.bodyUp.dot(this.up)))) * 180) / Math.PI
  }

  /**
   * Put it down at rest in direction `dir` on `on` (default: the current reference body),
   * feet on the ground, nose along `heading` if given. `align: 'surface'` sits it on the
   * slope, so thrust from a tilted pad pushes you sideways, which is honest. `'radial'`
   * is dead level, for harnesses that only want to test landing.
   */
  spawnOn(dir: THREE.Vector3, heading?: THREE.Vector3, align: 'surface' | 'radial' = 'surface', on?: Body): void {
    this.setRef(on ?? this.ref)
    this.up.copy(dir).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(align === 'surface' ? surfaceNormal(this.up, this.terrain, this.n) : this.n.copy(this.up), heading)
    this.rest()
    this.hold = 1
    this.state = 'landed'
    this.thrusting = false
    this.cruise = false
    this.fuel = FUEL_TANK
    this.burn = 0
    this.accumulator = 0
    this.frameAt(this.time)
    this.syncHelio()
  }

  /** Hang it in the air `altitude` metres over direction `dir` on `on`, level, at rest relative to the ground. */
  placeAbove(on: Body, dir: THREE.Vector3, altitude: number, heading?: THREE.Vector3): void {
    this.setRef(on)
    this.up.copy(dir).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE + altitude)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(this.n.copy(this.up), heading)
    this.hold = holdAt(altitude)
    this.state = 'flying'
    this.thrusting = false
    this.cruise = false
    this.accumulator = 0
    this.frameAt(this.time)
    this.syncHelio()
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
    // A dry tank: the controls still move but nothing answers. In the air the engine dies
    // with the last drop; on the ground it will not light again on less than FUEL_RELIGHT.
    const dry = this.fuel <= 0 || (this.state === 'landed' && this.fuel < FUEL_RELIGHT)
    if (dry && (c.thrust || c.lateral || c.vertical || c.fore)) c = { ...c, thrust: 0, lateral: 0, vertical: 0, fore: 0 }
    this.thrusting = c.thrust > 0
    this.refChanged = false
    setGroundClock(this.time)
    if (this.state !== 'flying') {
      if (this.state === 'landed' && (c.thrust > 0 || c.vertical > 0)) this.state = 'flying'
      else {
        this.burn = 0
        if (this.state === 'landed') this.fuel = Math.min(FUEL_TANK, this.fuel + (this.onPad() ? FUEL_PAD_REFILL : FUEL_SOLAR_TRICKLE) * h)
        // Ride the body: the rest pose is body-fixed, the heliocentric state follows it.
        this.time += h
        this.frameAt(this.time)
        this.pos.copy(this.restPos); this.quat.copy(this.restQuat); this.vel.set(0, 0, 0)
        this.syncHelio()
        return
      }
    }
    this.frameAt(this.time)

    // Gravity from every body, and how close the nearest surface is.
    this.acc.set(0, 0, 0)
    let nearest = Infinity
    for (const b of SYSTEM) {
      bodyPosition(b, this.time, this.tmp).sub(this.hpos)
      const r2 = this.tmp.lengthSq(), r = Math.sqrt(r2)
      this.acc.addScaledVector(this.tmp, b.mu / (r2 * r))
      nearest = Math.min(nearest, r - b.radius)
    }
    this.proximity = Math.max(0, nearest)

    // Where we are relative to the reference body: altitude, air, the frame's velocity.
    this.rel.copy(this.hpos).sub(this.bPos)
    const r = this.rel.length()
    this.up.copy(this.rel).divideScalar(r)
    this.localDir.copy(this.up).applyQuaternion(this.spinInv)
    const alt = r - groundRadius(this.localDir, this.terrain)
    const rhoNow = atmosphereDensity(alt, this.terrain.air)
    if (this.cruise ? rhoNow > CRUISE_EXIT || alt < CRUISE_FLOOR : rhoNow < CRUISE_ENTER && alt > CRUISE_FLOOR * 1.2) this.cruise = !this.cruise
    this.hold = holdAt(alt)
    this.frameVelAt(this.rel, this.frameVel)
    this.vRel.copy(this.hvel).sub(this.frameVel)

    // Attitude. Torque in body frame, exponential damping, first-order quaternion update.
    // Near the ground the attitude holds against the ground, which turns under an
    // inertial craft at 9° a minute on a 40-minute day; by twice CRUISE_FLOOR it holds
    // against the stars. Rotation, not force: blending it is harmless.
    this.angVel.x -= c.pitch * ANG_ACCEL * h
    this.angVel.z -= c.roll * ANG_ACCEL * h
    this.angVel.y -= c.yaw * ANG_ACCEL * 0.6 * h
    this.angVel.multiplyScalar(Math.exp(-ANG_DAMP * h))
    this.dq.set(this.angVel.x * h * 0.5, this.angVel.y * h * 0.5, this.angVel.z * h * 0.5, 1).normalize()
    this.hquat.multiply(this.dq).normalize()
    const wh = this.omega.length()
    if (this.hold > 0 && wh > 0) {
      this.dq.setFromAxisAngle(this.tmp.copy(this.omega).divideScalar(wh), this.hold * wh * h)
      this.hquat.premultiply(this.dq).normalize()
    }

    const mainThrust = THRUST_ACCEL * c.thrust * (1 + c.boost * (BOOST_MULT - 1))
    const cap = this.cap()
    // What this substep costs. Boost multiplies burn the way it multiplies thrust; the
    // cruise brake burns like the cruise engine; the RCS sips.
    this.burn = c.thrust * (this.cruise ? FUEL_CRUISE_BURN : FUEL_HOVER_BURN) * (1 + c.boost * (BOOST_MULT - 1))
      + (this.cruise && c.vertical < 0 ? FUEL_CRUISE_BURN * CRUISE_BRAKE : 0)
      + FUEL_RCS_BURN * (Math.abs(c.lateral) + (this.cruise ? 0 : Math.abs(c.vertical)) + Math.abs(c.fore))
    this.fuel = Math.max(0, this.fuel - this.burn * h)
    if (this.cruise) {
      // Cruise: the engine fires along the nose, spooled so full thrust reaches whatever
      // the cap is in about CRUISE_SPOOL seconds, and / is a brake on the same scale.
      this.nose.copy(BODY_FWD).applyQuaternion(this.hquat)
      const gain = Math.max(1, cap / (THRUST_ACCEL * CRUISE_SPOOL))
      if (c.thrust > 0) this.acc.addScaledVector(this.nose, mainThrust * gain)
      if (c.vertical < 0) this.acc.addScaledVector(this.nose, -THRUST_ACCEL * CRUISE_BRAKE * gain)
    } else if (c.thrust > 0) {
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      this.acc.addScaledVector(this.bodyUp, mainThrust)
    }
    // RCS: small pushes along the body axes. Translation without tilting. In cruise the
    // top thruster is the brake instead, handled above.
    if (c.lateral || (c.vertical && !this.cruise) || c.fore) {
      this.rcs.set(c.lateral, this.cruise ? 0 : c.vertical, -c.fore).multiplyScalar(RCS_ACCEL).applyQuaternion(this.hquat)
      this.acc.add(this.rcs)
    }
    // Ground effect. A cushion in the last few metres, plus damping against
    // descent, both fading to nothing at GROUND_EFFECT_HEIGHT. It is the ground
    // answering back, and it is what makes the last part of a landing readable.
    const feet = alt - HULL_CLEARANCE
    if (feet < GROUND_EFFECT_HEIGHT) {
      const k = 1 - Math.max(0, feet) / GROUND_EFFECT_HEIGHT
      this.acc.addScaledVector(this.up, GROUND_EFFECT_ACCEL_G * this.terrain.g * k)
      const vUp = this.vRel.dot(this.up)
      if (vUp < 0) this.acc.addScaledVector(this.up, -vUp * GROUND_EFFECT_DAMP * k)
    }
    // Drag, against the air, which rides the body and carries the wind.
    if (rhoNow > 0) {
      if (this.windy) wind(this.localDir, this.terrain, this.time, this.wind); else this.wind.set(0, 0, 0)
      this.tmp.copy(this.wind).applyQuaternion(this.spin)
      this.tmp.subVectors(this.vRel, this.tmp)
      const speed = this.tmp.length()
      if (speed > 0) this.acc.addScaledVector(this.tmp, -DRAG * rhoNow * speed)
    } else this.wind.set(0, 0, 0)

    this.hvel.addScaledVector(this.acc, h)
    if (this.cruise) {
      // Flight assist: velocity across the nose bleeds away, so where you point is where
      // you go; and above the cap the assist eases you back. Not physics. Very playable.
      // All of it on the velocity relative to the body you are near, never on the orbit.
      this.vRel.copy(this.hvel).sub(this.frameVel)
      const vPar = this.vRel.dot(this.nose)
      const bleed = 1 - Math.exp(-h / CRUISE_ALIGN_TAU)
      this.vRel.addScaledVector(this.nose, -vPar).multiplyScalar(1 - bleed).addScaledVector(this.nose, vPar)
      // The cap is a hard clamp on speed along the nose. Thrust grows with the cap and
      // would otherwise out-muscle any gentle reel-in on a dive.
      if (vPar > cap) this.vRel.addScaledVector(this.nose, cap - vPar)
      this.hvel.copy(this.frameVel).add(this.vRel)
    }
    this.hpos.addScaledVector(this.hvel, h)
    this.time += h
    this.frameAt(this.time)

    // Contact, against the reference body's ground where it is now.
    this.rel.copy(this.hpos).sub(this.bPos)
    const r2 = this.rel.length()
    this.up.copy(this.rel).divideScalar(r2)
    this.localDir.copy(this.up).applyQuaternion(this.spinInv)
    const ground = groundRadius(this.localDir, this.terrain)
    if (r2 - ground < HULL_CLEARANCE) {
      this.hold = 1
      this.frameVelAt(this.rel, this.frameVel)
      this.vRel.copy(this.hvel).sub(this.frameVel)
      const vUp = this.vRel.dot(this.up)
      const vH = Math.sqrt(Math.max(0, this.vRel.lengthSq() - vUp * vUp))
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      const tilt = (Math.acos(Math.min(1, Math.max(-1, this.bodyUp.dot(this.up)))) * 180) / Math.PI
      const slope = slopeDeg(this.localDir, this.terrain)
      this.lastContact = { vUp, vH, tilt, slope }
      this.hpos.copy(this.bPos).addScaledVector(this.up, ground + HULL_CLEARANCE)
      this.angVel.set(0, 0, 0)
      this.syncLocal()
      this.vel.set(0, 0, 0)
      const gentle = vUp > -LAND_MAX_VSPEED && vH < LAND_MAX_HSPEED && tilt < LAND_MAX_TILT && slope < LAND_MAX_SLOPE
      if (gentle) {
        this.state = 'landed'
        this.landings++
        this.alignTo(surfaceNormal(this.localDir, this.terrain, this.n))
      } else {
        this.state = 'crashed'
        this.crashes++
      }
      this.rest()
      this.syncHelio()
      return
    }
    this.syncLocal()
    this.pickRef()
  }

  // ---- Frames ----

  /** The reference body's centre, velocity, spin and angular velocity at time t. */
  private frameAt(t: number): void {
    bodyPosition(this.ref, t, this.bPos)
    bodyVelocity(this.ref, t, this.bVel)
    bodySpin(this.ref, t, this.spin)
    this.spinInv.copy(this.spin).invert()
    const w = this.ref.spinPeriod > 0 ? TWO_PI / this.ref.spinPeriod : 0
    this.omega.copy(this.ref.spinAxis).multiplyScalar(w)
  }

  /** Velocity of the local frame at inertial offset `rel` from the body: orbit plus `hold` of the spin. */
  private frameVelAt(rel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.omega).cross(rel).multiplyScalar(this.hold).add(this.bVel)
  }

  /** Local view from the heliocentric truth, using the frame last computed by frameAt. */
  private syncLocal(): void {
    this.rel.copy(this.hpos).sub(this.bPos)
    this.pos.copy(this.rel).applyQuaternion(this.spinInv)
    this.frameVelAt(this.rel, this.frameVel)
    this.vel.copy(this.hvel).sub(this.frameVel).applyQuaternion(this.spinInv)
    this.quat.copy(this.spinInv).multiply(this.hquat)
  }

  /** Heliocentric truth from the local view, using the frame last computed by frameAt. */
  private syncHelio(): void {
    this.rel.copy(this.pos).applyQuaternion(this.spin)
    this.hpos.copy(this.bPos).add(this.rel)
    this.frameVelAt(this.rel, this.frameVel)
    this.hvel.copy(this.vel).applyQuaternion(this.spin).add(this.frameVel)
    this.hquat.copy(this.spin).multiply(this.quat)
  }

  private rest(): void { this.restPos.copy(this.pos); this.restQuat.copy(this.quat) }

  private setRef(b: Body): void {
    if (b === this.ref) return
    this.ref = b
    this.terrain = terrainOf(b)
    this.refChanged = true
  }

  /**
   * The deepest body whose sphere of influence holds the craft; the sun otherwise.
   * A little hysteresis on the boundary so the frame never flickers.
   */
  private pickRef(): void {
    let best: Body | null = null
    for (const b of SYSTEM) {
      if (!b.parent) continue
      const d = bodyPosition(b, this.time, this.tmp).distanceTo(this.hpos)
      if (d < b.hill * (b === this.ref ? 1.05 : 0.95) && (!best || b.hill < best.hill)) best = b
    }
    best ??= body('sun')
    if (best !== this.ref) {
      this.setRef(best)
      this.frameAt(this.time)
      this.syncLocal()
    }
  }

  /** Rotate the LOCAL orientation so body-up matches `up`, keeping the current heading (or taking `heading`). */
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
