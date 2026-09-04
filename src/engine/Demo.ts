// The pilot for the demo (Chris, 2026-09-04: "get a demo built so we can watch what's
// supposed to happen, play testing is quite boring"). Flies the hover ship to a point on
// the ground and puts it down there, on the same Controls a keyboard makes, so what you
// watch is what you would do. Pure: the flight harness flies it headless. The game
// decides where to go and what to do on the ground; this only gets there.
import * as THREE from 'three'
import type { Craft, Controls } from './Craft.ts'
import { IDLE } from './Craft.ts'

export type Leg = 'lift' | 'climb' | 'cruise' | 'descend' | 'fly' | 'settle' | 'down'

/** Metres above the ground to cruise at, the most lean to use (radians), how close and how slow before settling. */
export const DEMO_HEIGHT = 140
export const DEMO_LEAN = 0.85
export const DEMO_CLOSE = 20
export const DEMO_SLOW = 2.5
/** A leg longer than this goes up through the air and across in cruise (Chris, 2026-09-04: "have we not got the other faster version of the ship"). */
export const DEMO_CRUISE_LEG = 8_000
/** Metres over the ground to cruise at, and how far above the target to aim so the arrival cap reels you in over its hover floor. */
export const DEMO_CRUISE_HEIGHT = 6_000
export const DEMO_ARRIVE_HEIGHT = 6_000
/** The carrot: cruise aims at a point this far ahead along the great circle, at cruise height, so the nose rides the horizon on a small world. Dive inside DEMO_DESCEND of the target. */
export const DEMO_CARROT = 5_000
export const DEMO_DESCEND = 7_000
/** In the dive out of cruise, brake above this speed so hover can take the ship at the floor. */
export const DEMO_DIVE_SPEED = 180

export class Pilot {
  /** Where to go: a point in the craft's local frame, on the ground. */
  readonly target = new THREE.Vector3()
  leg: Leg = 'lift'
  private readonly up = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly vH = new THREE.Vector3()
  private readonly lean = new THREE.Vector3()
  private readonly n = new THREE.Vector3()
  private readonly qInv = new THREE.Quaternion()
  private readonly tb = new THREE.Vector3()

  goTo(p: THREE.Vector3): void { this.target.copy(p); this.leg = 'lift' }
  private readonly aimPoint = new THREE.Vector3()
  /** Straight-line metres to the point over the target the cruise aims at; the craft's arrival cap reads it. */
  arrive(craft: Craft): number { return this.target.distanceTo(craft.pos) }
  private readonly axis = new THREE.Vector3()
  private readonly tdir = new THREE.Vector3()

  /** Ground distance to the target, along the sphere. */
  distance(craft: Craft): number {
    const r = craft.pos.length()
    return Math.acos(Math.min(1, craft.pos.dot(this.target) / (r * this.target.length()))) * r
  }

  /** The controls for this substep. Landed on the target it returns IDLE and stays on 'down'. */
  controls(craft: Craft): Controls {
    if (craft.state !== 'flying') {
      if (this.leg === 'down' || this.leg === 'lift') return this.leg === 'lift' ? { ...IDLE, thrust: 1 } : IDLE
      return IDLE
    }
    const alt = craft.altitude()
    this.up.copy(craft.pos).normalize()
    this.to.copy(this.target).sub(craft.pos)
    this.to.addScaledVector(this.up, -this.to.dot(this.up))   // across the ground
    const dist = this.to.length()
    this.vH.copy(craft.vel).addScaledVector(this.up, -craft.vel.dot(this.up))
    const speed = this.vH.length()
    if (this.leg === 'lift' && alt > 40) this.leg = dist > DEMO_CRUISE_LEG ? 'climb' : 'fly'
    // Cruise: up through the air, wings out, nose on a point over the target, the cap does the speed;
    // near it the cap has us slow and the floor hands us back to hover, which then flies the last bit.
    if (this.leg === 'climb') {
      if (craft.cruise) this.leg = 'cruise'
      else { this.lean.set(0, 0, 0); return { ...IDLE, thrust: 1, ...this.aim(craft, 0) } }
    }
    if (this.leg === 'cruise') {
      if (!craft.cruise) { this.leg = 'fly' }
      else {
        // Nose on the carrot: a point DEMO_CARROT ahead along the great circle to the target, at
        // cruise height over the ground. A far point sits below the horizon on a world this
        // small; the carrot keeps the nose just above it, climbing to height and holding it.
        this.tdir.copy(this.target).normalize()
        const whole = this.up.angleTo(this.tdir)
        const step = Math.min(whole, DEMO_CARROT / craft.pos.length())
        this.axis.crossVectors(this.up, this.tdir).normalize()
        this.aimPoint.copy(this.up).applyAxisAngle(this.axis, step).multiplyScalar(craft.pos.length() - alt + DEMO_ARRIVE_HEIGHT)
        this.n.copy(this.aimPoint).sub(craft.pos)
        const far = this.n.length()
        this.n.divideScalar(far)
        if (dist < DEMO_DESCEND) { this.leg = 'descend' }
        else {
          const a = craft.aimControls(this.n, 3)
          // Thrust while the nose is on it; hold off while it swings round, or the drive throws you the wrong way.
          const nose = this.tb.set(0, 0, -1).applyQuaternion(craft.quat)
          return { ...IDLE, thrust: nose.dot(this.n) > 0.95 ? 1 : 0, ...a }
        }
      }
    }
    if (this.leg === 'descend') {
      // Over the target, high: nose down at it, no thrust, brake to keep under the speed hover takes at the floor.
      if (!craft.cruise) this.leg = 'fly'
      else {
        this.n.copy(this.target).sub(craft.pos).normalize()
        const a = craft.aimControls(this.n, 3)
        return { ...IDLE, thrust: 0, vertical: craft.speed() > DEMO_DIVE_SPEED ? -1 : 0, ...a }
      }
    }
    if (this.leg === 'fly' && dist < DEMO_CLOSE && speed < DEMO_SLOW) this.leg = 'settle'
    if (this.leg === 'settle' && (dist > DEMO_CLOSE * 3)) this.leg = 'fly'
    if (this.leg === 'lift') return { ...IDLE, thrust: 1, ...this.aim(craft, 0) }
    // Lean toward the target and against the drift: a spring on position, damped on speed.
    // Far out it saturates at DEMO_LEAN, which is where the speed comes from.
    this.lean.copy(this.to).multiplyScalar(0.012).addScaledVector(this.vH, -0.08)
    const l = this.lean.length()
    const most = this.leg === 'fly' ? DEMO_LEAN : 0.25
    if (l > most) this.lean.multiplyScalar(most / l)
    if (this.leg === 'settle') {
      // Down over the spot; hands off for the last stretch so the assist does the landing.
      if (alt < 30 && speed < DEMO_SLOW && dist < DEMO_CLOSE) { this.leg = 'down'; return IDLE }
      const want = -Math.min(6, 1 + alt * 0.05)
      return { ...IDLE, thrust: craft.vUp() < want ? 1 : 0, ...this.aim(craft, 1) }
    }
    if (this.leg === 'down') return IDLE
    // Cruise height above the ground; slow the climb rate near it. Coming down from the hover floor, faster higher up: the assist's own floor is under us.
    const want = Math.max(-(2 + 0.08 * alt), Math.min(8, 0.5 * (DEMO_HEIGHT - alt)))
    return { ...IDLE, thrust: craft.vUp() < want ? 1 : 0, ...this.aim(craft, 1) }
  }

  private aim(craft: Craft, use: number): { pitch: number; roll: number; yaw: number } {
    this.n.copy(this.up).addScaledVector(this.lean, use).normalize()
    const a = craft.aimControls(this.n, 3)
    // Nose toward where we are going, so the ship flies forwards and reads as flying
    // somewhere (Chris, 2026-09-04: "the space ship flies backwards"). Yaw on the bearing
    // to the target in the body frame, damped on the yaw rate; nothing to do when close.
    if (this.to.length() > DEMO_CLOSE) {
      this.qInv.copy(craft.quat).invert()
      this.tb.copy(this.to).applyQuaternion(this.qInv)
      const bearing = Math.atan2(this.tb.x, -this.tb.z)
      a.yaw = Math.max(-1, Math.min(1, 2 * bearing + 1.2 * craft.angVel.y))
    }
    return a
  }

  /** Degrees between the nose and the way to the target, across the ground. For the harness. */
  heading(craft: Craft): number {
    this.up.copy(craft.pos).normalize()
    this.to.copy(this.target).sub(craft.pos); this.to.addScaledVector(this.up, -this.to.dot(this.up))
    this.n.set(0, 0, -1).applyQuaternion(craft.quat); this.n.addScaledVector(this.up, -this.n.dot(this.up))
    return (this.n.angleTo(this.to) * 180) / Math.PI
  }
}
