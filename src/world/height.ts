// THE interface. DESIGN.md §5. Everything on a planet derives from this.
//
// Evaluated on the unit sphere and nowhere else. The moment anything in here
// takes a face or a (u, v) the six faces stop agreeing at their seams.
import { Simplex3 } from './noise.ts'
import { TERRAIN_AMPLITUDE } from './config.ts'

export type UnitVector = { readonly x: number; readonly y: number; readonly z: number }
export type PlanetSeed = number // uint32

const tables = new Map<number, Simplex3>()
function noiseFor(seed: PlanetSeed): Simplex3 {
  let n = tables.get(seed)
  if (!n) { n = new Simplex3(seed); tables.set(seed, n) }
  return n
}

/** Base terrain, metres above datum. */
export function baseHeight(p: UnitVector, seed: PlanetSeed): number {
  const n = noiseFor(seed)
  // Broad: a handful of uplands per planet.
  const broad = n.fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6, 4)
  // Hills riding on top, finer and quieter. Offset so it isn't the same field scaled.
  const hills = n.fbm(p.x * 7 + 31.7, p.y * 7 + 31.7, p.z * 7 + 31.7, 3)
  // Push the broad signal toward its extremes so there are wide plains between
  // the uplands rather than uniform rolling. Somewhere to land is a design requirement.
  const shaped = Math.sign(broad) * Math.pow(Math.abs(broad), 1.4)
  return TERRAIN_AMPLITUDE * (0.8 * shaped + 0.2 * hills)
}

/**
 * Authored local shapes over the base: a flattened pad, a crater, a plinth.
 * Empty until easter eggs arrive. Stays pure; the harness never knows the difference.
 */
export function overrides(_p: UnitVector, _seed: PlanetSeed): number {
  return 0
}

export function height(p: UnitVector, seed: PlanetSeed): number {
  return baseHeight(p, seed) + overrides(p, seed)
}
