// Orbit autopilot. Chris, 2026-09-02: arriving at the moon at 1.6 km/s in hover with no
// air to lean on was "nearly impossible" not to crash; he wants the ship brought in and
// left circling "until you're ready to land or scan".
//
// It flies the same controls a pilot has: the cruise nose assist, thrust, the brake.
// Under the cruise floor it climbs straight up until cruise takes over. In cruise it
// wants a velocity: inward at a rate that closes the gap to the parking radius in about
// twenty seconds (the cap limits it), blending into the circular speed sideways as the
// gap closes. The nose goes where that velocity points, because the flight assist makes
// velocity follow the nose, and thrust or brake matches the magnitude. Once there the
// wanted velocity is the current sideways direction at circular speed, which is a
// stable fixed point: gravity bends the velocity, the tangent follows it, the corrections
// stay tiny. Erasable TypeScript: the harness imports this.
import * as THREE from 'three'
import type { Controls, Craft } from './Craft.ts'
import { IDLE, gravityAt } from './Craft.ts'
import { CRUISE_FLOOR } from '../world/config.ts'

export type OrbitPhase = 'climb' | 'approach' | 'circularise' | 'orbit'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export class OrbitAutopilot {
  engaged = false
  phase: OrbitPhase = 'approach'
  private readonly radial = new THREE.Vector3()
  private readonly tangent = new THREE.Vector3()
  private readonly vDes = new THREE.Vector3()
  private readonly nose = new THREE.Vector3()
  private readonly err = new THREE.Vector3()
  private readonly aim = new THREE.Vector3()
  private thrustOut = 0
  private brakeOut = 0

  /**
   * Metres from the body's centre to park at: clear of the air and of the cruise floor,
   * plus a share of the radius, so a moon parks low and a giant high (Chris, 2026-09-02:
   * "orbit on smaller planets needs to be lower than the bigger planets"). The moon: 3.9 km;
   * home: 6.2 km; the giant: 95 km.
   */
  parkRadius(craft: Craft): number {
    const t = craft.terrain
    return t.radius + Math.max(t.air * 1.5, CRUISE_FLOOR * 1.2) + 0.08 * t.radius
  }

  /** Circular orbital speed at the parking radius. */
  parkSpeed(craft: Craft): number { const r = this.parkRadius(craft); return Math.sqrt(gravityAt(r, craft.terrain) * r) }

  controls(craft: Craft): Controls {
    const r = craft.pos.length()
    this.radial.copy(craft.pos).divideScalar(r)
    if (!craft.cruise) {
      this.phase = 'climb'
      const a = craft.aimControls(this.radial)
      return { ...IDLE, ...a, thrust: 1, boost: 1 }
    }
    const rPark = this.parkRadius(craft)
    const H = rPark - craft.terrain.radius
    const vCirc = this.parkSpeed(craft)
    // Sideways: where the velocity already goes, minus its radial part; failing that, anywhere sideways.
    this.tangent.copy(craft.vel).addScaledVector(this.radial, -craft.vel.dot(this.radial))
    if (this.tangent.lengthSq() < 1) this.tangent.set(0, 1, 0).cross(this.radial)
    if (this.tangent.lengthSq() < 1e-6) this.tangent.set(1, 0, 0).cross(this.radial)
    this.tangent.normalize()
    const gap = r - rPark
    // The approach aims along the line from here that grazes the parking circle, so the
    // path curves in and arrives already tangential instead of flying at the centre and
    // turning at the end (Chris, 2026-09-02: "I was coming in on a sideways angle").
    const sinA = Math.min(1, rPark / r), cosA = Math.sqrt(1 - sinA * sinA)
    if (gap > 0) this.aim.copy(this.radial).multiplyScalar(-cosA).addScaledVector(this.tangent, sinA)
    else this.aim.copy(this.tangent).addScaledVector(this.radial, clamp(-gap / (0.5 * H), 0, 0.5)).normalize()
    // Speed: circular at the park radius, faster the further out, never past the cap.
    const want = Math.min(craft.cap(), vCirc + Math.max(0, gap) / 12)
    this.vDes.copy(this.aim).multiplyScalar(want)
    this.err.copy(this.vDes).sub(craft.vel)
    const e = this.err.length()
    const radialSpeed = craft.vel.dot(this.radial)
    this.phase = gap > 2 * H ? 'approach' : Math.abs(gap) < 0.05 * H && Math.abs(radialSpeed) < 3 && e < 0.03 * vCirc + 2 ? 'orbit' : 'circularise'

    // Velocity follows the nose in cruise, so the nose goes where the velocity should be and
    // never anywhere else; thrust and brake set the magnitude once the nose is roughly there.
    // A deadband either side of the wanted speed, and the commands are smoothed, because the
    // spool makes a twitch of throttle a real burn and the flame was flickering (Chris).
    const a = craft.aimControls(this.aim)
    this.nose.set(0, 0, -1).applyQuaternion(craft.quat)
    const along = this.nose.dot(this.aim)
    const vPar = craft.vel.dot(this.nose)
    const band = 2 + 0.02 * want
    let thrust = 0, brake = 0
    if (along > 0.7) {
      thrust = clamp((want - band - vPar) / (20 + 0.1 * want), 0, 1)
      brake = clamp((vPar - want - band) / (20 + 0.1 * want), 0, 1)
    }
    this.thrustOut += (thrust - this.thrustOut) * 0.25
    this.brakeOut += (brake - this.brakeOut) * 0.25
    const th = this.thrustOut < 0.03 ? 0 : this.thrustOut, br = this.brakeOut < 0.03 ? 0 : this.brakeOut
    return { ...IDLE, ...a, thrust: th, boost: this.phase === 'approach' ? 1 : 0, vertical: -br }
  }
}
