// The solar system as a pure function of the seed and time. DESIGN.md §5b.
//
// Bodies ride analytic Kepler orbits (circular, in the ecliptic, for now) and
// spin about an axis. Every mass comes from GM = g·R², every period from
// Kepler III, moons sit well inside their planet's Hill sphere, and moons are
// tidally locked. Nothing is integrated; positions and velocities at any t are
// exact and bit-identical, forever. The craft feels gravity from all of it.
//
// Only erasable TypeScript: tools/verify-system.mjs imports this directly.
import * as THREE from 'three'
import { MASTER_SEED } from './config.ts'
import { rng } from './noise.ts'

export type BodyKind = 'sun' | 'hot' | 'terrestrial' | 'tiny' | 'giant' | 'moon'

export type Orbit = {
  /** Semi-major axis (radius, for now), metres. */
  a: number
  /** Seconds. Derived from Kepler III. */
  period: number
  /** Radians at t = 0. */
  phase0: number
}

export type Body = {
  id: string
  name: string
  kind: BodyKind
  seed: number
  /** Metres. */
  radius: number
  /** m/s² at the surface. */
  surfaceGravity: number
  /** GM, m³/s². Always surfaceGravity × radius². */
  mu: number
  /** Metres; 0 is airless. */
  atmosphereHeight: number
  /** Seconds per rotation. */
  spinPeriod: number
  spinAxis: THREE.Vector3
  spinPhase0: number
  parent: string | null
  orbit: Orbit | null
  /** Sphere of influence, roughly: the Hill radius against the parent. 0 for the sun. */
  hill: number
}

const TWO_PI = Math.PI * 2

function kepler3(a: number, muParent: number): number {
  return TWO_PI * Math.sqrt((a * a * a) / muParent)
}

function hillRadius(a: number, mu: number, muParent: number): number {
  return a * Math.cbrt(mu / (3 * muParent))
}

/** The roster. Numbers are gameplay, not astronomy; see DESIGN.md §5b for the table. */
export function buildSystem(seed = MASTER_SEED): Body[] {
  const next = rng(seed ^ 0x53595354)
  const bodies: Body[] = []
  const byId = new Map<string, Body>()

  const add = (spec: {
    id: string; name: string; kind: BodyKind; radius: number; g: number; air: number
    spin: number; parent: string | null; a: number; tilt?: number
  }): Body => {
    const mu = spec.g * spec.radius * spec.radius
    const parent = spec.parent ? byId.get(spec.parent)! : null
    const orbit: Orbit | null = parent ? { a: spec.a, period: kepler3(spec.a, parent.mu), phase0: next() * TWO_PI } : null
    const tilt = spec.tilt ?? (next() - 0.5) * 0.5
    const b: Body = {
      id: spec.id, name: spec.name, kind: spec.kind,
      // Home keeps the master seed so its terrain (and the pad) is what it always was.
      seed: spec.id === 'home' ? seed : (seed ^ Math.imul(bodies.length + 1, 0x9e3779b1)) >>> 0,
      radius: spec.radius, surfaceGravity: spec.g, mu,
      atmosphereHeight: spec.air,
      // Moons are tidally locked: one rotation per orbit.
      spinPeriod: spec.kind === 'moon' && orbit ? orbit.period : spec.spin,
      spinAxis: new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0).normalize(),
      spinPhase0: next() * TWO_PI,
      parent: spec.parent, orbit,
      hill: parent && orbit ? hillRadius(orbit.a, mu, parent.mu) : 0,
    }
    bodies.push(b); byId.set(b.id, b)
    return b
  }

  add({ id: 'sun', name: 'Sol', kind: 'sun', radius: 25_000, g: 6.4, air: 0, spin: 2400, parent: null, a: 0, tilt: 0 })
  add({ id: 'hot', name: 'Cinder', kind: 'hot', radius: 1_500, g: 6, air: 120, spin: 900, parent: 'sun', a: 55_000 })
  add({ id: 'home', name: 'Vale', kind: 'terrestrial', radius: 2_000, g: 7, air: 700, spin: 480, parent: 'sun', a: 120_000, tilt: 0.2 })
  add({ id: 'home-1', name: 'Vale I', kind: 'moon', radius: 350, g: 1.0, air: 0, spin: 0, parent: 'home', a: 5_000 })
  add({ id: 'terra-a', name: 'Marram', kind: 'terrestrial', radius: 1_800, g: 6.5, air: 600, spin: 400, parent: 'sun', a: 180_000 })
  add({ id: 'terra-a-1', name: 'Marram I', kind: 'moon', radius: 300, g: 0.8, air: 0, spin: 0, parent: 'terra-a', a: 6_500 })
  add({ id: 'terra-b', name: 'Sedge', kind: 'terrestrial', radius: 2_400, g: 8, air: 800, spin: 600, parent: 'sun', a: 260_000 })
  add({ id: 'terra-b-1', name: 'Sedge I', kind: 'moon', radius: 420, g: 1.2, air: 0, spin: 0, parent: 'terra-b', a: 7_000 })
  add({ id: 'terra-b-2', name: 'Sedge II', kind: 'moon', radius: 260, g: 0.7, air: 0, spin: 0, parent: 'terra-b', a: 12_000 })
  add({ id: 'giant', name: 'Bulwark', kind: 'giant', radius: 10_000, g: 8, air: 3000, spin: 300, parent: 'sun', a: 520_000, tilt: 0.05 })
  for (let i = 0; i < 5; i++) {
    add({ id: `giant-${i + 1}`, name: `Bulwark ${['I', 'II', 'III', 'IV', 'V'][i]}`, kind: 'moon', radius: 220 + i * 110, g: 0.5 + i * 0.35, air: 0, spin: 0, parent: 'giant', a: 18_000 + i * 10_500 })
  }
  add({ id: 'tiny', name: 'Mote', kind: 'tiny', radius: 400, g: 1.2, air: 0, spin: 120, parent: 'sun', a: 800_000 })
  return bodies
}

export const SYSTEM: readonly Body[] = buildSystem()
const INDEX = new Map(SYSTEM.map((b) => [b.id, b]))
export function body(id: string): Body { const b = INDEX.get(id); if (!b) throw new Error(`no body ${id}`); return b }

const tmpP = new THREE.Vector3(), tmpV = new THREE.Vector3()

/** Heliocentric position at time t. Recurses up the parent chain. */
export function bodyPosition(b: Body, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (!b.orbit || !b.parent) return out.set(0, 0, 0)
  const th = b.orbit.phase0 + (TWO_PI * t) / b.orbit.period
  bodyPosition(body(b.parent), t, out)
  return out.add(tmpP.set(Math.cos(th) * b.orbit.a, 0, Math.sin(th) * b.orbit.a))
}

/** Heliocentric velocity at time t. */
export function bodyVelocity(b: Body, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (!b.orbit || !b.parent) return out.set(0, 0, 0)
  const th = b.orbit.phase0 + (TWO_PI * t) / b.orbit.period
  const w = (TWO_PI * b.orbit.a) / b.orbit.period
  bodyVelocity(body(b.parent), t, out)
  return out.add(tmpV.set(-Math.sin(th) * w, 0, Math.cos(th) * w))
}

/** Rotation of the body's local frame at time t. */
export function bodySpin(b: Body, t: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromAxisAngle(b.spinAxis, b.spinPhase0 + (TWO_PI * t) / b.spinPeriod)
}

/** Surface velocity from spin at a heliocentric point p on/near the body (ω × r). */
export function bodySurfaceVelocity(b: Body, t: number, p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  bodyPosition(b, t, tmpP)
  const r = out.copy(p).sub(tmpP)
  const w = TWO_PI / b.spinPeriod
  return out.crossVectors(tmpV.copy(b.spinAxis).multiplyScalar(w), r)
}
