// Canned stunts on one key (research/jet-stunts-2026-09-05.md: "easy means one key"). The
// Immelmann (I): pull up and over until the heading has reversed, then roll upright; you come
// out higher, going back the way you came. The split-S (K): roll inverted, then pull through
// until the heading has reversed; you come out lower and faster. Both drive the stick the
// player would have held, so they read as flying, and both refuse under 80 m/s; the split-S
// also refuses without twice the loop's radius of sky under you. Pure: the flight harness
// flies them. Any stick input cancels (the game handles that).
import * as THREE from 'three'
import type { Craft, Controls } from './Craft.ts'
import { IDLE } from './Craft.ts'
import { JET_PITCH_RATE } from '../world/config.ts'

export type StuntKind = 'immelmann' | 'splits'
export type StuntPhase = 'pull' | 'roll' | 'done'
export const STUNT_MIN_SPEED = 80
export const STUNT_NAME: Record<StuntKind, string> = { immelmann: 'IMMELMANN', splits: 'SPLIT-S' }

const FWD = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0)

export class Stunts {
  kind: StuntKind | null = null
  phase: StuntPhase = 'done'
  /** Seconds into the stunt. */
  age = 0
  private readonly fwd0 = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly nose = new THREE.Vector3()
  private readonly bodyUp = new THREE.Vector3()

  /** The loop's radius at this speed: v over the pitch rate. */
  static radius(speed: number): number { return speed / JET_PITCH_RATE }

  start(kind: StuntKind, craft: Craft): 'ok' | 'not-jet' | 'too-slow' | 'too-low' {
    if (!craft.jet || craft.state !== 'flying') return 'not-jet'
    const v = craft.speed()
    if (v < STUNT_MIN_SPEED) return 'too-slow'
    if (kind === 'splits' && craft.altitude() < 2.2 * Stunts.radius(v)) return 'too-low'
    this.kind = kind
    this.age = 0
    this.up.copy(craft.pos).normalize()
    this.fwd0.copy(FWD).applyQuaternion(craft.quat).addScaledVector(this.up, -this.fwd0.dot(this.up)).normalize()
    this.phase = kind === 'immelmann' ? 'pull' : 'roll'
    return 'ok'
  }

  get active(): boolean { return this.kind !== null && this.phase !== 'done' }
  cancel(): void { this.kind = null; this.phase = 'done' }

  /** The stick for this step, or null when the stunt is over. */
  controls(craft: Craft, dt: number): Controls | null {
    if (!this.active) return null
    this.age += dt
    if (this.age > 12 || !craft.jet || craft.state !== 'flying') { this.cancel(); return null }
    this.up.copy(craft.pos).normalize()
    this.nose.copy(FWD).applyQuaternion(craft.quat)
    this.bodyUp.copy(UP).applyQuaternion(craft.quat)
    const heading = this.nose.clone().addScaledVector(this.up, -this.nose.dot(this.up))
    const reversed = heading.lengthSq() > 0.05 && heading.normalize().dot(this.fwd0) < -0.95
    const upright = this.bodyUp.dot(this.up)
    if (this.kind === 'immelmann') {
      if (this.phase === 'pull') {
        // Pull until over the top with the heading reversed: the nose is back on the horizon, upside down.
        if (reversed && Math.abs(this.nose.dot(this.up)) < 0.35) this.phase = 'roll'
        else return { ...IDLE, thrust: 1, pitch: -1 }
      }
      if (this.phase === 'roll') {
        if (upright > 0.97) { this.phase = 'done'; return { ...IDLE, thrust: 1 } }
        return { ...IDLE, thrust: 1, roll: 1 }
      }
    } else {
      if (this.phase === 'roll') {
        if (upright < -0.97) this.phase = 'pull'
        else return { ...IDLE, thrust: 0.3, roll: 1 }
      }
      if (this.phase === 'pull') {
        // Pull through the bottom until the heading has reversed and the ship is upright again.
        if (reversed && upright > 0.8) { this.phase = 'done'; return { ...IDLE, thrust: 1 } }
        return { ...IDLE, thrust: 0.6, pitch: -1 }
      }
    }
    return null
  }
}
