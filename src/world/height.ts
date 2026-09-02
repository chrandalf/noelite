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

/** Where the forest clumps are: -1..1, forest above CLUMP_EDGE. Cells of ~R/25, a kilometre or two. */
export function clump(p: UnitVector, t: Terrain): number {
  return noiseFor((t.seed ^ 0x464f5245) >>> 0).fbm(p.x * 25 + 91.3, p.y * 25 + 91.3, p.z * 25 + 91.3, 2)
}
export const CLUMP_EDGE = 0.05

// ---- The landing pad: the one authored shape so far. Chris, 2026-09-02: "make sure I
// spawn on a landing pad somewhere with reasonable height, I just spawned in the trees."
/** Metres of dead-flat disc, and metres of ramp beyond it back to the ground. */
export const PAD_RADIUS = 22
export const PAD_BLEND = 18
/** Metres above the sea a pad wants to sit: enough for a view, not a mountain. */
const PAD_MIN = 25, PAD_MAX = 140

export type PadSite = { dir: UnitVector; h: number }
const pads = new Map<string, PadSite | null>()

/** The body's landing pad, found once: a dry, flat, forest-free spot at a reasonable height, spiralling out from (0, 0, 1). */
export function padOf(t: Terrain): PadSite | null {
  if (t.water || t.kind !== 'terrestrial' || !t.amplitude) return null
  let p = pads.get(t.id)
  if (p === undefined) { p = findPadSite(t); pads.set(t.id, p) }
  return p
}

function findPadSite(t: Terrain): PadSite {
  const sea = t.sea ?? -Infinity
  const step = 12 / t.radius
  const e = 3 / t.radius
  const slopeAt = (d: { x: number; y: number; z: number }) => {
    const ax = Math.abs(d.x) < 0.9 ? 1 : 0
    // Two tangents from an axis cross d, unnormalised is fine at this scale.
    const t1 = { x: ax ? 0 : 0, y: ax ? -d.z : d.z, z: ax ? d.y : 0 }
    if (!ax) { t1.x = 0; t1.y = d.z; t1.z = -d.y } else { t1.x = 0; t1.y = -d.z; t1.z = d.y }
    const l1 = Math.hypot(t1.x, t1.y, t1.z) || 1
    const t2 = { x: d.y * t1.z - d.z * t1.y, y: d.z * t1.x - d.x * t1.z, z: d.x * t1.y - d.y * t1.x }
    const l2 = Math.hypot(t2.x, t2.y, t2.z) || 1
    const h0 = baseHeight(d, t)
    let worst = 0
    for (const [tx, ty, tz] of [[t1.x / l1, t1.y / l1, t1.z / l1], [t2.x / l2, t2.y / l2, t2.z / l2]]) {
      const q = { x: d.x + e * tx, y: d.y + e * ty, z: d.z + e * tz }
      const l = Math.hypot(q.x, q.y, q.z)
      worst = Math.max(worst, Math.abs(baseHeight({ x: q.x / l, y: q.y / l, z: q.z / l }, t) - h0) / 3)
    }
    return worst
  }
  const g = { x: 0, y: 0, z: 1 }
  const gt1 = { x: 1, y: 0, z: 0 }, gt2 = { x: 0, y: 1, z: 0 }
  let best: PadSite | null = null, bestScore = Infinity
  for (let k = 0; k < 6000; k++) {
    const ang = k * 2.4, rad = step * Math.sqrt(k) * 3
    const x = g.x + gt1.x * Math.cos(ang) * rad + gt2.x * Math.sin(ang) * rad
    const y = g.y + gt1.y * Math.cos(ang) * rad + gt2.y * Math.sin(ang) * rad
    const z = g.z + gt1.z * Math.cos(ang) * rad + gt2.z * Math.sin(ang) * rad
    const l = Math.hypot(x, y, z)
    const d = { x: x / l, y: y / l, z: z / l }
    const h = baseHeight(d, t)
    const above = h - (t.sea ?? 0)
    if (h < sea + 3 || above < PAD_MIN || above > PAD_MAX) continue
    if (clump(d, t) > CLUMP_EDGE - 0.15) continue // well clear of any forest edge
    const s = slopeAt(d)
    if (s > Math.tan((5 * Math.PI) / 180)) continue
    // Prefer gentle and not too far out.
    const score = s * 40 + k * 0.001
    if (score < bestScore) { bestScore = score; best = { dir: d, h } }
    if (s < Math.tan((1.5 * Math.PI) / 180)) break
  }
  return best ?? { dir: g, h: baseHeight(g, t) }
}

/** The pad flattens the ground to its own height inside PAD_RADIUS, ramping back over PAD_BLEND. */
function applyPad(p: UnitVector, t: Terrain, base: number): number {
  const pad = padOf(t)
  if (!pad) return base
  const c = p.x * pad.dir.x + p.y * pad.dir.y + p.z * pad.dir.z
  const outer = (PAD_RADIUS + PAD_BLEND) / t.radius
  if (c < Math.cos(outer)) return base
  const dist = Math.acos(Math.min(1, c)) * t.radius
  const w = 1 - smooth(PAD_RADIUS, PAD_RADIUS + PAD_BLEND, dist)
  return base + (pad.h - base) * w
}

/** Angular test: is p within `metres` of the pad's centre? */
export function nearPad(p: UnitVector, t: Terrain, metres: number): boolean {
  const pad = padOf(t)
  if (!pad) return false
  return p.x * pad.dir.x + p.y * pad.dir.y + p.z * pad.dir.z > Math.cos(metres / t.radius)
}

export function height(p: UnitVector, t: Terrain): number {
  if (t.water) return t.sea ?? 0
  return applyPad(p, t, baseHeight(p, t))
}
