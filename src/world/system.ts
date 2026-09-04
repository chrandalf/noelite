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

export type BodyKind = 'sun' | 'hot' | 'terrestrial' | 'desert' | 'ice' | 'tiny' | 'giant' | 'moon'
/** Kinds with ground you can settle: pads, a station, outposts, seams. */
export const SETTLED: ReadonlySet<BodyKind> = new Set<BodyKind>(['terrestrial', 'desert', 'ice'])

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
      // Moons are tidally locked: one rotation per orbit. (spin 0 with a parent planet means locked, whatever the kind.)
      spinPeriod: orbit && parent && parent.kind !== 'sun' && (spec.kind === 'moon' || spec.spin === 0) ? orbit.period : spec.spin,
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
  // Mars: the red world, thin air, no sea, a day like ours. The first "richer" tier (DESIGN §10g).
  add({ id: 'desert', name: 'Rust', kind: 'desert', radius: scaled(3_389_500), g: 3.71, air: 700, spin: DAY_LENGTH * 1.03, parent: 'sun', a: scaled(227_900_000_000), tilt: 0.44 })
  // Ceres: a dwarf in the belt, airless, a stepping stone to the giants.
  add({ id: 'dwarf', name: 'Hollow', kind: 'tiny', radius: scaled(470_000), g: 0.28, air: 0, spin: DAY_LENGTH * 0.4, parent: 'sun', a: scaled(414_000_000_000), tilt: 0.07 })
  // Jupiter: no surface, 24.8 g, so hover is impossible without boost. A crush line later.
  add({ id: 'giant', name: 'Bulwark', kind: 'giant', radius: scaled(69_911_000), g: 24.8, air: 40_000, spin: DAY_LENGTH / 2, parent: 'sun', a: scaled(778_500_000_000), tilt: 0.05 })
  // Io and Europa: a volcanic moon and an ice moon, the far tier begins here.
  add({ id: 'giant-1', name: 'Ember', kind: 'hot', radius: scaled(1_821_600), g: 1.8, air: 0, spin: 0, parent: 'giant', a: scaled(421_700_000) })
  add({ id: 'giant-2', name: 'Rime', kind: 'ice', radius: scaled(1_560_800), g: 1.31, air: 0, spin: 0, parent: 'giant', a: scaled(671_000_000), sea: 0 })
  // Saturn and Titan: the ringed world (rings to come) and a cold moon under a thick haze.
  add({ id: 'ringed', name: 'Halo', kind: 'giant', radius: scaled(58_232_000), g: 10.4, air: 30_000, spin: DAY_LENGTH / 2.2, parent: 'sun', a: scaled(1_433_500_000_000), tilt: 0.47 })
  add({ id: 'ringed-1', name: 'Murk', kind: 'desert', radius: scaled(2_574_700), g: 1.35, air: 3_000, spin: 0, parent: 'ringed', a: scaled(1_221_900_000), tilt: 0.01 })
  // Uranus and Neptune: the ice giants, then Triton and Pluto: the far, cold end.
  add({ id: 'giant-b', name: 'Umber', kind: 'giant', radius: scaled(25_362_000), g: 8.87, air: 20_000, spin: DAY_LENGTH / 1.7, parent: 'sun', a: scaled(2_872_500_000_000), tilt: 1.7 })
  add({ id: 'giant-c', name: 'Deep', kind: 'giant', radius: scaled(24_622_000), g: 11.15, air: 20_000, spin: DAY_LENGTH / 1.5, parent: 'sun', a: scaled(4_495_000_000_000), tilt: 0.49 })
  add({ id: 'giant-c-1', name: 'Hush', kind: 'ice', radius: scaled(1_353_400), g: 0.78, air: 0, spin: 0, parent: 'giant-c', a: scaled(354_800_000), sea: 0 })
  add({ id: 'far', name: 'Far', kind: 'ice', radius: scaled(1_188_300), g: 0.62, air: 0, spin: DAY_LENGTH * 6, parent: 'sun', a: scaled(5_906_000_000_000), tilt: 2.1, sea: 0 })
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
