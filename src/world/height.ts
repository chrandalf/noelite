// THE interface. DESIGN.md §5. Everything on a body derives from this.
//
// Evaluated on the unit sphere and nowhere else. The moment anything in here
// takes a face or a (u, v) the six faces stop agreeing at their seams.
import { Simplex3 } from './noise.ts'
import { PLANET_RADIUS, TERRAIN_AMPLITUDE, MASTER_SEED } from './config.ts'
import { body, type Body, type BodyKind } from './system.ts'

export type UnitVector = { readonly x: number; readonly y: number; readonly z: number }
export type PlanetSeed = number // uint32

/** What the terrain layer needs to know about a body. Derived from the roster, never edited. */
export type Terrain = {
  readonly id: string
  readonly seed: PlanetSeed
  readonly radius: number
  /** Metres, roughly peak-to-datum. */
  readonly amplitude: number
  readonly kind: BodyKind
  /** m/s² at the surface. */
  readonly g: number
  /** Metres of atmosphere; 0 is airless. */
  readonly air: number
  /** Spin axis in the body's own frame, for latitude bands. */
  readonly axis: UnitVector
  /** Metres above datum that water fills to; null for a dry body. */
  readonly sea: number | null
  /** Bounds of height(), metres. The harness holds the function to them. */
  readonly top: number
  readonly bottom: number
  /** A water terrain: height() is the sea surface. `land` is the ground it covers. */
  readonly water?: boolean
  readonly land?: Terrain
}

/** Mountains reach this many amplitudes above the continent surface; canyons cut this many below it. */
export const MOUNTAIN = 2.2
export const CANYON = 0.6

/**
 * Relief as a fraction of radius. Real rocky bodies sit at 0.15-0.6% (Everest, Maxwell
 * Montes, the lunar highlands); 0.5% is the same small exaggeration home gets.
 */
const AMPLITUDE_BY_KIND: Record<BodyKind, number> = {
  sun: 0, hot: 0.005, terrestrial: 0.005, tiny: 0.012, giant: 0, moon: 0.005,
}

export function terrainOf(b: Body): Terrain {
  const amplitude = b.id === 'home' ? TERRAIN_AMPLITUDE : b.radius * AMPLITUDE_BY_KIND[b.kind]
  return {
    id: b.id, seed: b.seed, radius: b.radius, amplitude, kind: b.kind, g: b.surfaceGravity, air: b.atmosphereHeight, axis: b.spinAxis,
    sea: b.seaLevel, top: (1 + MOUNTAIN) * amplitude, bottom: -(1 + CANYON) * amplitude,
  }
}

/** The sea of a body as a terrain of its own: flat at sea level, so the LOD can tile it. */
export function waterOf(t: Terrain): Terrain {
  if (t.sea === null) throw new Error(`${t.id} is dry`)
  return { ...t, water: true, land: t }
}

/** The world you start on. Same numbers as before the solar system existed. */
export const HOME: Terrain = terrainOf(body('home'))
if (HOME.seed !== MASTER_SEED || HOME.radius !== PLANET_RADIUS) throw new Error('home terrain drifted from config')

const tables = new Map<number, Simplex3>()
function noiseFor(seed: PlanetSeed): Simplex3 {
  let n = tables.get(seed)
  if (!n) { n = new Simplex3(seed); tables.set(seed, n) }
  return n
}

/** Metres. The coarsest cell of the deck-scale detail field. */
const DETAIL_CELL = 600

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Ridged multifractal in [0, 1]: crests along the noise's zero crossings, each octave weighted by the last. */
function ridged(n: Simplex3, x: number, y: number, z: number, octaves: number): number {
  let sum = 0, amp = 0.5, freq = 1, weight = 1, norm = 0
  for (let o = 0; o < octaves; o++) {
    let v = 1 - Math.abs(n.noise(x * freq, y * freq, z * freq))
    v = v * v * weight
    weight = Math.min(1, Math.max(0, v * 2))
    sum += v * amp; norm += amp
    amp *= 0.5; freq *= 2.1
  }
  return sum / norm
}

/**
 * Base terrain, metres above datum. Chris, 2026-09-02: "proper canyons, lakes, mountains,
 * like a planet. SEAs, oceans." So: coordinates warped by a slow noise so coasts and
 * ranges meander; continents from a shaped broad field with a sea level the basins fill
 * to; mountain belts of ridged crests standing on land; canyons as thin inverted ridge
 * lines cut into the plateaus; hills and a deck-scale detail field over all of it.
 * Every term is continuous, so the seams and the crack check hold.
 */
export function baseHeight(p: UnitVector, t: Terrain): number {
  if (t.amplitude === 0) return 0
  const n = noiseFor(t.seed)
  const A = t.amplitude
  // Warp.
  const wx = n.fbm(p.x * 1.1 + 3.1, p.y * 1.1 + 3.1, p.z * 1.1 + 3.1, 2)
  const wy = n.fbm(p.x * 1.1 + 17.9, p.y * 1.1 + 17.9, p.z * 1.1 + 17.9, 2)
  const wz = n.fbm(p.x * 1.1 + 41.3, p.y * 1.1 + 41.3, p.z * 1.1 + 41.3, 2)
  const qx = p.x + 0.18 * wx, qy = p.y + 0.18 * wy, qz = p.z + 0.18 * wz
  // Broad: a handful of uplands and basins per body.
  const broad = n.fbm(qx * 1.6, qy * 1.6, qz * 1.6, 4)
  // Hills riding on top, finer and quieter. Offset so it isn't the same field scaled.
  const hills = n.fbm(qx * 7 + 31.7, qy * 7 + 31.7, qz * 7 + 31.7, 3)
  // Ground: cells of ~600 m down to ~150 m in absolute metres, whatever the radius.
  const fd = t.radius / DETAIL_CELL
  const detail = n.fbm(p.x * fd + 7.3, p.y * fd + 7.3, p.z * fd + 7.3, 3)
  if (t.kind === 'hot' || t.kind === 'moon' || t.kind === 'tiny') {
    // Airless rock: fold the broad field into crests and basins, and stand ridges on it.
    const folded = 1 - 2 * Math.abs(broad)
    const crests = ridged(n, qx * 3 + 5.5, qy * 3 + 5.5, qz * 3 + 5.5, 5)
    return A * (0.55 * folded + 0.2 * hills + 0.1 * detail) + A * MOUNTAIN * 0.5 * crests * crests
  }
  // Push the broad signal toward its extremes so there are wide plains between the
  // uplands rather than uniform rolling. Somewhere to land is a design requirement.
  const shaped = Math.sign(broad) * Math.pow(Math.abs(broad), 1.4)
  let h = A * (0.72 * shaped + 0.18 * hills + 0.1 * detail)
  // Mountains: ridged crests, in belts, standing on land.
  const belt = smooth(0.05, 0.45, n.fbm(qx * 2.2 + 61.7, qy * 2.2 + 61.7, qz * 2.2 + 61.7, 2))
  const land = smooth(-0.15, 0.1, shaped)
  if (belt > 0 && land > 0) {
    const crests = ridged(n, qx * 5 + 9.1, qy * 5 + 9.1, qz * 5 + 9.1, 5)
    h += A * MOUNTAIN * belt * land * crests * crests
  }
  // Canyons: a thin inverted ridge line, cut into plateaus away from the ranges.
  const plateau = smooth(0.2, 0.5, n.fbm(qx * 2.8 + 83.3, qy * 2.8 + 83.3, qz * 2.8 + 83.3, 2)) * smooth(0.05, 0.25, shaped) * (1 - belt)
  if (plateau > 0) {
    const line = 1 - Math.abs(n.noise(qx * 8 + 23.9, qy * 8 + 23.9, qz * 8 + 23.9))
    h -= A * CANYON * plateau * smooth(0.82, 0.97, line)
  }
  return h
}

/**
 * Authored local shapes over the base: a flattened pad, a crater, a plinth.
 * Empty until easter eggs arrive. Stays pure; the harness never knows the difference.
 */
export function overrides(_p: UnitVector, _t: Terrain): number {
  return 0
}

export function height(p: UnitVector, t: Terrain): number {
  if (t.water) return t.sea ?? 0
  return baseHeight(p, t) + overrides(p, t)
}
