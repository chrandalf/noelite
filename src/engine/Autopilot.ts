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

  /** Metres from the body's centre to park at: clear of the air, and of the cruise floor, by a margin. */
  parkRadius(craft: Craft): number {
    const t = craft.terrain
    return t.radius + Math.max(6_000, t.air * 1.5, 0.1 * t.radius)
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
    const inward = clamp(gap / 30, -craft.cap(), craft.cap())
    const near = clamp(1 - gap / (2 * H), 0, 1)
    this.vDes.copy(this.radial).multiplyScalar(-inward).addScaledVector(this.tangent, vCirc * near)
    this.err.copy(this.vDes).sub(craft.vel)
    const e = this.err.length()
    const radialSpeed = craft.vel.dot(this.radial)
    this.phase = gap > 2 * H ? 'approach' : Math.abs(gap) < 0.05 * H && Math.abs(radialSpeed) < 3 && e < 0.03 * vCirc + 2 ? 'orbit' : 'circularise'

    // Velocity follows the nose in cruise, so the nose goes where the velocity should be and
    // never anywhere else; thrust and brake set the magnitude once the nose is roughly there.
    const want = this.vDes.length()
    const a = craft.aimControls(this.vDes.clone().normalize())
    this.nose.set(0, 0, -1).applyQuaternion(craft.quat)
    const along = this.nose.dot(this.vDes) / Math.max(want, 1e-6)
    const vPar = craft.vel.dot(this.nose)
    let thrust = 0, brake = 0
    if (along > 0.7) {
      thrust = clamp((want - vPar) / 20, 0, 1)
      brake = clamp((vPar - want) / 20, 0, 1)
    }
    return { ...IDLE, ...a, thrust, boost: this.phase === 'approach' ? 1 : 0, vertical: -brake }
  }
}
