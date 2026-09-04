// The pilot for the demo (Chris, 2026-09-04: "get a demo built so we can watch what's
// supposed to happen, play testing is quite boring"). Flies the hover ship to a point on
// the ground and puts it down there, on the same Controls a keyboard makes, so what you
// watch is what you would do. Pure: the flight harness flies it headless. The game
// decides where to go and what to do on the ground; this only gets there.
import * as THREE from 'three'
import type { Craft, Controls } from './Craft.ts'
import { IDLE } from './Craft.ts'

export type Leg = 'lift' | 'fly' | 'settle' | 'down'

/** Metres above the ground to cruise at, the most lean to use (radians), how close and how slow before settling. */
export const DEMO_HEIGHT = 140
export const DEMO_LEAN = 0.85
export const DEMO_CLOSE = 20
export const DEMO_SLOW = 2.5

export class Pilot {
  /** Where to go: a point in the craft's local frame, on the ground. */
  readonly target = new THREE.Vector3()
  leg: Leg = 'lift'
  private readonly up = new THREE.Vector3()
  private readonly to = new THREE.Vector3()
  private readonly vH = new THREE.Vector3()
  private readonly lean = new THREE.Vector3()
  private readonly n = new THREE.Vector3()

  goTo(p: THREE.Vector3): void { this.target.copy(p); this.leg = 'lift' }

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
    if (this.leg === 'lift' && alt > 40) this.leg = 'fly'
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
    // Cruise height above the ground; slow the climb rate near it.
    const want = Math.max(-8, Math.min(8, 0.5 * (DEMO_HEIGHT - alt)))
    return { ...IDLE, thrust: craft.vUp() < want ? 1 : 0, ...this.aim(craft, 1) }
  }

  private aim(craft: Craft, use: number): { pitch: number; roll: number; yaw: number } {
    this.n.copy(this.up).addScaledVector(this.lean, use).normalize()
    return craft.aimControls(this.n, 3)
  }
}
