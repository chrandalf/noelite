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
}

/**
 * Relief as a fraction of radius. Real rocky bodies sit at 0.15-0.6% (Everest, Maxwell
 * Montes, the lunar highlands); 0.5% is the same small exaggeration home gets.
 */
const AMPLITUDE_BY_KIND: Record<BodyKind, number> = {
  sun: 0, hot: 0.005, terrestrial: 0.005, tiny: 0.012, giant: 0, moon: 0.005,
}

export function terrainOf(b: Body): Terrain {
  const amplitude = b.id === 'home' ? TERRAIN_AMPLITUDE : b.radius * AMPLITUDE_BY_KIND[b.kind]
  return { id: b.id, seed: b.seed, radius: b.radius, amplitude, kind: b.kind, g: b.surfaceGravity, air: b.atmosphereHeight, axis: b.spinAxis }
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

/** Base terrain, metres above datum. */
/** Metres. The coarsest cell of the deck-scale detail field. */
const DETAIL_CELL = 600

export function baseHeight(p: UnitVector, t: Terrain): number {
  if (t.amplitude === 0) return 0
  const n = noiseFor(t.seed)
  // Broad: a handful of uplands per body.
  const broad = n.fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6, 4)
  // Hills riding on top, finer and quieter. Offset so it isn't the same field scaled.
  const hills = n.fbm(p.x * 7 + 31.7, p.y * 7 + 31.7, p.z * 7 + 31.7, 3)
  // Ground: cells of ~600 m down to ~150 m in absolute metres, whatever the radius.
  // The two fields above scale with the body (a handful of uplands per world, as a
  // real planet has); without this a 40 km world is a billiard ball from the deck.
  const fd = t.radius / DETAIL_CELL
  const detail = n.fbm(p.x * fd + 7.3, p.y * fd + 7.3, p.z * fd + 7.3, 3)
  if (t.kind === 'hot' || t.kind === 'moon' || t.kind === 'tiny') {
    // Ridged: fold the broad field so it makes crests and basins rather than rolling hills.
    const ridged = 1 - 2 * Math.abs(broad)
    return t.amplitude * (0.68 * ridged + 0.22 * hills + 0.1 * detail)
  }
  // Push the broad signal toward its extremes so there are wide plains between
  // the uplands rather than uniform rolling. Somewhere to land is a design requirement.
  const shaped = Math.sign(broad) * Math.pow(Math.abs(broad), 1.4)
  return t.amplitude * (0.72 * shaped + 0.18 * hills + 0.1 * detail)
}

/**
 * Authored local shapes over the base: a flattened pad, a crater, a plinth.
 * Empty until easter eggs arrive. Stays pure; the harness never knows the difference.
 */
export function overrides(_p: UnitVector, _t: Terrain): number {
  return 0
}

export function height(p: UnitVector, t: Terrain): number {
  return baseHeight(p, t) + overrides(p, t)
}
