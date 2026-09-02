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
import { MASTER_SEED, PLANET_RADIUS, GRAVITY, ATMOSPHERE_HEIGHT, DAY_LENGTH } from './config.ts'
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
  /** Metres above datum that water fills to; null for a dry body. */
  seaLevel: number | null
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

/** The roster: the real inner system plus Jupiter, at 1:159. See DESIGN.md §5b. */
export function buildSystem(seed = MASTER_SEED): Body[] {
  const next = rng(seed ^ 0x53595354)
  const bodies: Body[] = []
  const byId = new Map<string, Body>()

  const add = (spec: {
    id: string; name: string; kind: BodyKind; radius: number; g: number; air: number
    spin: number; parent: string | null; a: number; tilt?: number; sea?: number
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
      seaLevel: spec.sea ?? null,
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

  // The real solar system at 1:159 (Earth's radius to 40 km; Chris, 2026-09-02).
  // Radii, semi-major axes and surface gravities are the real values through one
  // scale factor, so angles are preserved: the sun is a half-degree disc from home,
  // the moon the same, an eclipse is possible. Periods fall out of Kepler III and are
  // the real ones times √(1/159): a 29-day year, a 2-day month. Spin periods are not
  // gravitational and are gameplay numbers. Atmosphere depth cannot be to scale (it
  // would be ~30 m); it is exaggerated about 3x, the one exception, see config.ts.
  // Names are the fiction's; the ids say which real body each one is scaled from.
  const K = PLANET_RADIUS / 6_371_000
  const scaled = (metres: number) => Math.round(metres * K)
  add({ id: 'sun', name: 'Sol', kind: 'sun', radius: scaled(696_000_000), g: 274, air: 0, spin: 4 * DAY_LENGTH, parent: null, a: 0, tilt: 0 })
  // Mercury: airless, 3.7 g, 88-day year.
  add({ id: 'hot', name: 'Cinder', kind: 'hot', radius: scaled(2_440_000), g: 3.7, air: 0, spin: 3 * DAY_LENGTH, parent: 'sun', a: scaled(57_900_000_000) })
  // Venus: a deep, thick, hot atmosphere; nearly Earth's size and gravity.
  add({ id: 'terra-a', name: 'Marram', kind: 'terrestrial', radius: scaled(6_052_000), g: 8.87, air: 4_000, spin: 5 * DAY_LENGTH, parent: 'sun', a: scaled(108_200_000_000), tilt: 0.05 })
  // Earth, and its moon at a quarter of Earth's Hill radius, as the real one is.
  add({ id: 'home', name: 'Vale', kind: 'terrestrial', radius: PLANET_RADIUS, g: GRAVITY, air: ATMOSPHERE_HEIGHT, spin: DAY_LENGTH, parent: 'sun', a: scaled(149_600_000_000), tilt: 0.41, sea: 0 })
  add({ id: 'home-1', name: 'Vale I', kind: 'moon', radius: scaled(1_737_000), g: 1.62, air: 0, spin: 0, parent: 'home', a: scaled(384_400_000) })
  // Jupiter: no surface, 24.8 g, so hover is impossible without boost. A crush line later.
  add({ id: 'giant', name: 'Bulwark', kind: 'giant', radius: scaled(69_911_000), g: 24.8, air: 40_000, spin: DAY_LENGTH / 2, parent: 'sun', a: scaled(778_500_000_000), tilt: 0.05 })
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
