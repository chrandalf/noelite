// Seams: where the goods come out of the ground (DESIGN §10g). Seeded per body, placed by
// the ground they sit in (ore on the ridges of the mountain belts, crystal on gully floors,
// salt on the flats by the sea, timber in the forest stands, ice on the caps and the cold
// bodies, helium in regolith, sulphur on the hot ones), never near a pad, and richer the
// further the body is from the sun: the tiers are the ladder. Pure; the terrain harness
// re-tests every seam against its own rule.
import type { Terrain, UnitVector } from './height.ts'
import { baseHeight, clump, CLUMP_EDGE, padOf, stationOf, outpostsOf, MOUNTAIN } from './height.ts'
import { SYSTEM, body } from './system.ts'
import { rng } from './noise.ts'

export type Good = 'water' | 'timber' | 'ore' | 'salt' | 'crystal' | 'ice' | 'helium' | 'sulphur'
export type Seam = { dir: UnitVector; h: number; good: Good; /** Tonnes in the ground. */ richness: number; /** Metres: land inside it to dig. */ radius: number; tier: 1 | 2 | 3 }

export const SEAMS_PER_BODY = 12
/** A dwarf gets half a dozen; there is only so much ground. */
export function seamsWanted(t: Terrain): number { return t.radius < 5_000 ? SEAMS_PER_BODY / 2 : SEAMS_PER_BODY }
export const SEAM_RADIUS = 150
/** Metres from any pad, station or outpost: a seam is never by the front door. */
export const SEAM_MIN_FROM_PAD = 5_000
/** Tonnes a plain seam holds, by good; the tier multiplies it. */
export const SEAM_BASE: Record<Good, number> = { water: 400, timber: 120, ore: 90, salt: 150, crystal: 14, ice: 100, helium: 30, sulphur: 60 }
export const TIER_MULT: Record<1 | 2 | 3, number> = { 1: 1, 2: 2.5, 3: 6 }

const cache = new Map<string, Seam[]>()

/** 1 at home and inward, 2 out to the belt, 3 beyond it. By the orbit of the body or its planet. */
export function tierOf(t: Terrain): 1 | 2 | 3 {
  const b = body(t.id)
  const planet = b.parent && b.parent !== 'sun' ? body(b.parent) : b
  const a = planet.orbit?.a ?? 0
  const home = body('home').orbit!.a
  if (t.id === 'home') return 1
  return a > home * 3.5 ? 3 : 2
}

function frame(d: UnitVector): [UnitVector, UnitVector] {
  const ax0 = Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const t1 = norm({ x: ax0.y * d.z - ax0.z * d.y, y: ax0.z * d.x - ax0.x * d.z, z: ax0.x * d.y - ax0.y * d.x })
  const t2 = { x: d.y * t1.z - d.z * t1.y, y: d.z * t1.x - d.x * t1.z, z: d.x * t1.y - d.y * t1.x }
  return [t1, t2]
}
function norm(v: { x: number; y: number; z: number }): UnitVector { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l } }
function at(d: UnitVector, t1: UnitVector, t2: UnitVector, u: number, v: number): UnitVector { return norm({ x: d.x + t1.x * u + t2.x * v, y: d.y + t1.y * u + t2.y * v, z: d.z + t1.z * u + t2.z * v }) }

/** The ground round a point: its height, the highest and the mean of four neighbours `e` metres out, and the slope. */
export function groundAt(d: UnitVector, t: Terrain, e = 300): { h: number; hi: number; mean: number; slope: number } {
  const [t1, t2] = frame(d)
  const ee = e / t.radius
  const h = baseHeight(d, t)
  let hi = -Infinity, sum = 0, slope = 0
  for (const [u, v] of [[ee, 0], [0, ee], [-ee, 0], [0, -ee]]) {
    const q = baseHeight(at(d, t1, t2, u, v), t)
    hi = Math.max(hi, q); sum += q; slope = Math.max(slope, Math.abs(q - h) / e)
  }
  return { h, hi, mean: sum / 4, slope }
}

/** The good a spot of ground yields, or null for plain ground. The rules the harness re-tests. */
export function goodAt(d: UnitVector, t: Terrain): Good | null {
  const A = t.amplitude
  if (!A) return null
  const sea = t.sea ?? -Infinity
  const g = groundAt(d, t)
  const lat = Math.abs(d.x * t.axis.x + d.y * t.axis.y + d.z * t.axis.z)
  if (g.h < sea + 3) return null                                   // under water: water is free at any shore
  if (t.kind === 'hot') return g.h > 0.3 * A ? 'sulphur' : null     // the hot world's crusts
  if (g.h > (1 + 0.2 * MOUNTAIN) * A && g.h > g.mean + 10) return 'ore'                  // a ridge in a belt
  if (g.hi - g.h > Math.min(40, 0.5 * A) && g.h < 0.4 * A) return 'crystal'              // a gully floor
  if (t.kind === 'ice' || (t.kind === 'terrestrial' && lat > 0.78 && g.h > sea + 20)) return 'ice'   // the caps, the cold worlds
  if ((t.kind === 'moon' || t.kind === 'tiny') && g.slope < 0.03 && g.h < 0.2 * A) return 'helium'  // regolith flats
  if (t.sea !== null && g.h < sea + 12 && g.slope < 0.02) return 'salt'                  // the flats by the sea
  if (t.kind === 'terrestrial' && clump(d, t) > CLUMP_EDGE + 0.1) return 'timber'        // a forest stand
  return null
}

/** The body's seams, found once: seeded throws at the sphere, kept where the ground yields something and no pad is near. */
export function seamsOf(t: Terrain): Seam[] {
  if (t.water || !t.amplitude || t.kind === 'giant' || t.kind === 'sun') return []
  let list = cache.get(t.id)
  if (list !== undefined) return list
  list = []
  const next = rng((t.seed ^ 0x5345414d) >>> 0)
  const tier = tierOf(t)
  const pads: UnitVector[] = []
  const p = padOf(t); if (p) pads.push(p.dir)
  const st = stationOf(t); if (st) pads.push(st.site.dir)
  for (const o of outpostsOf(t)) pads.push(o.site.dir)
  const avoidCos = Math.cos(SEAM_MIN_FROM_PAD / t.radius)
  const apartCos = Math.cos((3 * SEAM_RADIUS) / t.radius)
  // Round the goods in turn, so a body gets a spread rather than whatever its commonest
  // ground yields: for each seam, throw at the sphere until the ground gives the good
  // wanted next; a good the body cannot give is dropped from the round after 1,500 misses.
  const wanted: Good[] = ['ore', 'salt', 'timber', 'crystal', 'ice', 'helium', 'sulphur', 'water']
  let w = 0
  const want_n = seamsWanted(t)
  while (list.length < want_n && wanted.length) {
    const want = wanted[w % wanted.length]
    let found = false
    for (let k = 0; k < 1500 && !found; k++) {
      const d = norm({ x: next() - 0.5, y: next() - 0.5, z: next() - 0.5 })
      if (pads.some((q) => d.x * q.x + d.y * q.y + d.z * q.z > avoidCos)) continue
      if (list.some((s) => d.x * s.dir.x + d.y * s.dir.y + d.z * s.dir.z > apartCos)) continue
      const good = goodAt(d, t)
      if (good !== want) continue
      list.push({ dir: d, h: baseHeight(d, t), good, richness: Math.round(SEAM_BASE[good] * TIER_MULT[tier] * (0.6 + 0.8 * next())), radius: SEAM_RADIUS, tier })
      found = true
    }
    if (found) w++
    else wanted.splice(w % wanted.length, 1)
  }
  cache.set(t.id, list)
  return list
}

/** Every body that has seams, for the harness and the shop's range talk. */
export function seamBodies(): string[] { return SYSTEM.filter((b) => b.kind !== 'sun' && b.kind !== 'giant').map((b) => b.id) }
