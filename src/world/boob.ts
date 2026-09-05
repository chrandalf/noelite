// The boob. Ben, 2026-09-05, by way of Chris: "he wants a big flying boob." So there is
// one, on home, and it flies. It is not bolted to the sky: it drifts round the world on a
// great circle at walking-plus pace, 500 m over whatever ground is under it, bobbing, and
// a circuit of home takes most of a real afternoon, so on any given flight it is somewhere
// and you do not know where. The scanner (G) will find it inside its range as an UNKNOWN
// CONTACT; fly to within a few hundred metres and it names itself, once, and the save
// remembers you saw it. Fly into it and it gives, wobbles, and shoves you off. Pure: the
// flight harness re-tests the circuit, the bounce and the first sight. The mesh is in
// engine/Boob.ts.
import * as THREE from 'three'
import type { Terrain } from './height.ts'
import { HOME, padOf } from './height.ts'
import { groundRadius } from './terrain.ts'

/** The body it lives on. One boob, one world; Ben can find it there. */
export const BOOB_BODY = 'home'
/** Metres, the sphere; a hill in the sky. */
export const BOOB_RADIUS = 60
/** Metres over the ground under it. */
export const BOOB_ALT = 500
/** Metres a second along the ground. A circuit of home is 4.6 hours real. */
export const BOOB_SPEED = 15
/** Metres: inside this it names itself. */
export const BOOB_SIGHT = 400
/** Metres of bob either side of BOOB_ALT, and its period in seconds. */
export const BOOB_BOB = 12
export const BOOB_BOB_PERIOD = 9
/** The scanner's reach for it; the same as a seam's. */
export const BOOB_SCAN_RANGE = 25_000

const _d0 = new THREE.Vector3()
const _t0 = new THREE.Vector3()
let framed = false
/** The circuit: starts over the far side of the world from the home pad, so it is never at the front door on day one. */
function frame(): void {
  if (framed) return
  const pad = padOf(HOME)!
  _d0.set(pad.dir.x, pad.dir.y, pad.dir.z).negate()
  // A tangent: anything not parallel, crossed and normalised.
  const ax = Math.abs(_d0.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  _t0.crossVectors(ax, _d0).normalize()
  framed = true
}

/** Where it is over the ground at game time `t`: a unit direction, written into `out`. */
export function boobDir(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  frame()
  const th = (BOOB_SPEED * t) / HOME.radius
  return out.copy(_d0).multiplyScalar(Math.cos(th)).addScaledVector(_t0, Math.sin(th))
}

/** Its centre in home's local frame at game time `t`, written into `out`. */
export function boobPos(t: number, terrain: Terrain = HOME, out = new THREE.Vector3()): THREE.Vector3 {
  boobDir(t, out)
  const r = groundRadius(out, terrain) + BOOB_ALT + BOOB_BOB * Math.sin((t / BOOB_BOB_PERIOD) * Math.PI * 2)
  return out.multiplyScalar(r)
}

/** What the save keeps: the game time it was first seen up close, or -1. */
let foundAt = -1
export function boobFound(): number { return foundAt }
export function saveBoob(): { found: number } | undefined { return foundAt >= 0 ? { found: foundAt } : undefined }
export function loadBoob(j: { found: number } | undefined): void { foundAt = j && j.found >= 0 ? j.found : -1 }

/** The name it gives when it has been seen; before that the scanner has only a contact. */
export function boobName(): string { return foundAt >= 0 ? 'THE BOOB' : 'UNKNOWN CONTACT' }

/** Bounce restitution and how hard a hit sets it wobbling. */
const GIVE = 0.55
const WOBBLE_PER_MS = 0.012
const WOBBLE_DECAY = 0.9

export type BoobHit = { speed: number }

export class Boob {
  readonly pos = new THREE.Vector3()
  /** The jiggle: an amplitude that decays and a phase that runs; the mesh squashes by it. */
  wobble = 0
  phase = 0
  /** Set by step when the craft hits it this step. */
  hit: BoobHit | null = null
  private readonly n = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  readonly terrain: Terrain
  constructor(terrain: Terrain = HOME) { this.terrain = terrain }

  /** Move it to game time `t`; then, if `craftPos` is inside it, push the craft out along the normal, reflect the closing speed with GIVE, and wobble. */
  step(dt: number, t: number, craftPos?: THREE.Vector3, craftVel?: THREE.Vector3, craftSize = 8): void {
    boobPos(t, this.terrain, this.pos)
    this.phase += dt * 5
    this.wobble *= Math.pow(WOBBLE_DECAY, dt * 10)
    this.hit = null
    if (!craftPos || !craftVel) return
    const reach = BOOB_RADIUS + craftSize
    this.n.copy(craftPos).sub(this.pos)
    const d = this.n.length()
    if (d >= reach || d < 1e-6) return
    this.n.divideScalar(d)
    craftPos.copy(this.pos).addScaledVector(this.n, reach)
    const closing = -craftVel.dot(this.n)
    if (closing > 0) {
      craftVel.addScaledVector(this.n, closing * (1 + GIVE))
      this.wobble = Math.min(1, this.wobble + closing * WOBBLE_PER_MS)
      this.hit = { speed: closing }
    }
  }

  /** Metres from the craft to its skin, or less than zero inside. */
  distance(craftPos: THREE.Vector3): number { return this.tmp.copy(craftPos).sub(this.pos).length() - BOOB_RADIUS }

  /** The first close look names it: true the once, at game time `t`. */
  sight(craftPos: THREE.Vector3, t: number): boolean {
    if (foundAt >= 0 || this.distance(craftPos) > BOOB_SIGHT) return false
    foundAt = t
    return true
  }
}
