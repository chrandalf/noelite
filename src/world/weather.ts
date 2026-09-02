// Weather as a field over each body, and the tide. Chris, 2026-09-02: "wind, rain and
// waves, basically some weather, and a tide when there is a moon"; then "the tides need
// to be in the ocean only ... you won't get tides in small volumes of water".
//
// One slow seeded noise in position and time is the FRONT, -1 clear and calm to +1
// storm. Wind blows along the front's contours (the rotated gradient, so it is
// divergence-free and swirls round systems) at a speed set by the front, with gusts.
// Rain falls where the front is high. The tide is the moon's two bulges, and the caller
// fades it by water depth so ponds and lakes never breathe.
//
// Only erasable TypeScript: the harnesses import this.
import * as THREE from 'three'
import type { Terrain, UnitVector } from './height.ts'
import { Simplex3 } from './noise.ts'
import { SYSTEM, body, bodyPosition, bodySpin, type Body } from './system.ts'

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

const tables = new Map<number, Simplex3>()
function noiseFor(seed: number): Simplex3 {
  let n = tables.get(seed)
  if (!n) { n = new Simplex3((seed ^ 0x57454154) >>> 0); tables.set(seed, n) }
  return n
}

/** Seconds for a weather system to drift about one cell. */
export const WEATHER_PERIOD = 900
/** m/s in a flat calm and in a full storm. */
export const WIND_CALM = 4
export const WIND_STORM = 30
/** Metres, home. Exaggerated: the real equilibrium tide at 1:159 would be three millimetres. */
export const TIDE_AMPLITUDE = 2.5

/** The front at body-local direction d: -1 clear and calm, +1 storm. Slow in time. Airless bodies have none. */
export function front(d: UnitVector, t: Terrain, time: number): number {
  if (t.air <= 0) return -1
  const n = noiseFor(t.seed)
  const tt = time / WEATHER_PERIOD
  return n.fbm(d.x * 3 + tt, d.y * 3 + 0.37 * tt, d.z * 3 - 0.61 * tt, 3)
}

export function windSpeedOf(f: number): number { return WIND_CALM + (WIND_STORM - WIND_CALM) * smooth(-0.3, 0.9, f) }
/** 0 dry to 1 pouring. */
export function rainOf(f: number): number { return smooth(0.3, 0.6, f) }
/** 0 clear to 1 overcast. Comes in ahead of the rain. */
export function cloudOf(f: number): number { return smooth(0.0, 0.5, f) }

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), ax = new THREE.Vector3(), q = new THREE.Vector3()
/** Wind at body-local direction d, m/s, tangential to the surface, body-local axes. */
export function wind(d: THREE.Vector3, t: Terrain, time: number, out: THREE.Vector3): THREE.Vector3 {
  if (t.air <= 0) return out.set(0, 0, 0)
  ax.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0)
  t1.crossVectors(ax, d).normalize()
  t2.crossVectors(d, t1)
  const e = 0.004
  const g1 = (front(q.copy(d).addScaledVector(t1, e).normalize(), t, time) - front(q.copy(d).addScaledVector(t1, -e).normalize(), t, time)) / (2 * e)
  const g2 = (front(q.copy(d).addScaledVector(t2, e).normalize(), t, time) - front(q.copy(d).addScaledVector(t2, -e).normalize(), t, time)) / (2 * e)
  // Rotate the gradient a quarter turn about up: along the contours.
  out.copy(t1).multiplyScalar(-g2).addScaledVector(t2, g1)
  if (out.lengthSq() < 1e-12) out.copy(t1)
  out.normalize()
  const f = front(d, t, time)
  const gust = 1 + 0.25 * noiseFor(t.seed).noise(d.x * 400 + time * 0.7, d.y * 400 + time * 0.3, d.z * 400)
  return out.multiplyScalar(windSpeedOf(f) * gust)
}

/** The first moon of a body, or null. */
export function moonOf(b: Body): Body | null {
  for (const m of SYSTEM) if (m.parent === b.id && m.kind === 'moon') return m
  return null
}

const moonDir = new THREE.Vector3(), spinQ = new THREE.Quaternion()
let moonCacheId = '', moonCacheTime = NaN, moonCacheHas = false
/** Direction to the body's moon in the body's own spinning frame at `time`; false if it has none. Cached per (body, time). */
export function moonDirection(t: Terrain, time: number, out: THREE.Vector3): boolean {
  if (moonCacheId !== t.id || moonCacheTime !== time) {
    moonCacheId = t.id; moonCacheTime = time
    const b = body(t.id), m = moonOf(b)
    moonCacheHas = !!m
    if (m) {
      bodyPosition(m, time, moonDir).sub(bodyPosition(b, time, q)).applyQuaternion(bodySpin(b, time, spinQ).invert()).normalize()
    }
  }
  if (moonCacheHas) out.copy(moonDir)
  return moonCacheHas
}

const md = new THREE.Vector3()
/** Tide height at body-local direction d, metres: two bulges, toward the moon and away. Unfaded; see oceanFade. */
export function tide(d: UnitVector, t: Terrain, time: number): number {
  if (t.sea === null || !moonDirection(t, time, md)) return 0
  const c = d.x * md.x + d.y * md.y + d.z * md.z
  return TIDE_AMPLITUDE * (1.5 * c * c - 0.5)
}

/** 0 in a pond, 1 in the open sea, by depth of water in metres. Tides and swell are ocean things. */
export function oceanFade(depth: number): number { return smooth(10, 30, depth) }
