// Asteroids: fields of rocks as a pure function of the seed and time, like the
// bodies. Chris, 2026-09-03: "in No Man's Sky you could fill up by destroying
// asteroids, can we have asteroids that we destroy too, make it a bit more
// challenging to find what you need, cos we'll have fuel stations as well."
//
// Fields ride Kepler orbits round the sun: home's and Marram's Trojan clusters at
// L4 and L5 (60° ahead and behind on the same orbit, which is where real Trojans
// sit), and clumps in a main belt beyond home. Every rock has a fixed offset in
// its field's orbiting frame (radial, normal, tangential), so a cluster keeps its
// shape as it goes round. A minority of rocks are ice; those refuel you when
// they break. Nothing here is integrated; positions at any t are exact.
//
// Only erasable TypeScript: tools/verify-system.mjs imports this directly.
import * as THREE from 'three'
import { MASTER_SEED, ROCK_HP_PER_METRE, ICE_FUEL_PER_METRE, ICE_FUEL_MAX } from './config.ts'
import { rng } from './noise.ts'
import { SYSTEM, body } from './system.ts'

export type FieldKind = 'trojan' | 'belt'

export type Field = {
  id: string
  name: string
  kind: FieldKind
  seed: number
  /** Semi-major axis (radius) of the field's centre round the sun, metres. */
  a: number
  period: number
  phase0: number
  /** Metres: the rocks lie within this of the centre. */
  spread: number
  rocks: Rock[]
}

export type Rock = {
  /** Unique across fields. */
  id: number
  field: Field
  /** Offset in the field's orbiting frame: x radial, y normal, z tangential. Metres. */
  offset: THREE.Vector3
  radius: number
  ice: boolean
  /** Hits left. 0 is gone. */
  hp: number
  /** Which of the rock shapes to draw, and how it tumbles. */
  shape: number
  spinAxis: THREE.Vector3
  spinRate: number
}

const TWO_PI = Math.PI * 2

/** The fields. Home's Trojans are the first rung: reachable on a tank, a minority of ice. The belt is richer and further. */
export function buildFields(seed = MASTER_SEED): Field[] {
  const sun = body('sun')
  const fields: Field[] = []
  let nextId = 1
  const add = (id: string, name: string, kind: FieldKind, a: number, period: number, phase0: number, spread: number, count: number, iceFraction: number, minR: number, maxR: number): Field => {
    const fseed = (seed ^ Math.imul(fields.length + 101, 0x85ebca6b)) >>> 0
    const next = rng(fseed)
    const f: Field = { id, name, kind, seed: fseed, a, period, phase0, spread, rocks: [] }
    let tries = 0
    while (f.rocks.length < count && tries++ < count * 50) {
      // A blob, denser toward the middle, flattened toward the orbital plane.
      const u = next(), v = next() * TWO_PI, w = (next() - 0.5) * 2
      const r = spread * Math.cbrt(u)
      const off = new THREE.Vector3(r * Math.sqrt(1 - w * w * 0.9) * Math.cos(v), r * w * 0.35, r * Math.sqrt(1 - w * w * 0.9) * Math.sin(v))
      const radius = minR * Math.pow(maxR / minR, next() * next())
      // Keep rocks well apart: nothing within eight radii of another. Sparse is the point.
      let clear = true
      for (const o of f.rocks) if (o.offset.distanceTo(off) < 8 * (o.radius + radius)) { clear = false; break }
      if (!clear) continue
      const ice = next() < iceFraction
      const ax = new THREE.Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize()
      f.rocks.push({ id: nextId++, field: f, offset: off, radius, ice, hp: 1 + Math.floor(radius * ROCK_HP_PER_METRE), shape: Math.floor(next() * 3), spinAxis: ax, spinRate: (0.05 + 0.2 * next()) * (next() < 0.5 ? -1 : 1) })
    }
    fields.push(f)
    return f
  }
  for (const b of SYSTEM) {
    if (!b.orbit || b.parent !== 'sun' || b.kind !== 'terrestrial') continue
    // Trojans: 60° ahead (L4, "leading") and behind (L5, "trailing") on the planet's own orbit.
    add(`${b.id}-l4`, `${b.name} Leading`, 'trojan', b.orbit.a, b.orbit.period, b.orbit.phase0 + Math.PI / 3, 40_000, 70, b.id === 'home' ? 0.22 : 0.3, 15, 220)
    add(`${b.id}-l5`, `${b.name} Trailing`, 'trojan', b.orbit.a, b.orbit.period, b.orbit.phase0 - Math.PI / 3, 40_000, 70, b.id === 'home' ? 0.22 : 0.3, 15, 220)
  }
  // The main belt: clumps between 2.1 and 3.2 of home's distance, where the real one is. Richer in ice.
  const home = body('home')
  const next = rng(seed ^ 0x42454c54)
  for (let k = 0; k < 8; k++) {
    const a = home.orbit!.a * (2.1 + 1.1 * (k + next()) / 8)
    const period = TWO_PI * Math.sqrt((a * a * a) / sun.mu)
    add(`belt-${k + 1}`, `Belt ${k + 1}`, 'belt', a, period, next() * TWO_PI, 60_000, 150, 0.45, 20, 400)
  }
  return fields
}

export const FIELDS: readonly Field[] = buildFields()
export const ROCKS: readonly Rock[] = FIELDS.flatMap((f) => f.rocks)
const BY_ID = new Map(ROCKS.map((r) => [r.id, r]))
export function rock(id: number): Rock { const r = BY_ID.get(id); if (!r) throw new Error(`no rock ${id}`); return r }

const tmpC = new THREE.Vector3()

/** Heliocentric position of a field's centre at time t. */
export function fieldPosition(f: Field, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const th = f.phase0 + (TWO_PI * t) / f.period
  return out.set(Math.cos(th) * f.a, 0, Math.sin(th) * f.a)
}

/** Heliocentric velocity of a field's centre (and, near enough, of every rock in it). */
export function fieldVelocity(f: Field, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const th = f.phase0 + (TWO_PI * t) / f.period
  const w = (TWO_PI * f.a) / f.period
  return out.set(-Math.sin(th) * w, 0, Math.cos(th) * w)
}

/** Heliocentric position of a rock at time t: the field's centre plus the offset in the orbiting frame. */
export function rockPosition(r: Rock, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const f = r.field
  const th = f.phase0 + (TWO_PI * t) / f.period
  const c = Math.cos(th), s = Math.sin(th)
  // radial (c, 0, s), normal (0, 1, 0), tangential (-s, 0, c)
  const o = r.offset
  return out.set(c * f.a + o.x * c - o.z * s, o.y, s * f.a + o.x * s + o.z * c)
}

export type Nearest = { rock: Rock | null; dist: number; pos: THREE.Vector3 }

/**
 * The nearest surviving rock to heliocentric point p at time t: surface distance
 * (centre distance minus radius), and its position. Whole fields are skipped when
 * even their nearest edge is further than the best so far.
 */
export function nearestRock(p: THREE.Vector3, t: number, out: Nearest): Nearest {
  out.rock = null; out.dist = Infinity
  for (const f of FIELDS) {
    const dc = fieldPosition(f, t, tmpC).distanceTo(p)
    if (dc - f.spread > out.dist) continue
    for (const r of f.rocks) {
      if (r.hp <= 0) continue
      const d = rockPosition(r, t, tmpC).distanceTo(p) - r.radius
      if (d < out.dist) { out.dist = d; out.rock = r; out.pos.copy(tmpC) }
    }
  }
  return out
}

export type Hit = { rock: Rock; dist: number; point: THREE.Vector3 }

/** First surviving rock along the ray from p in unit direction d within range, at time t. */
export function castRay(p: THREE.Vector3, d: THREE.Vector3, range: number, t: number): Hit | null {
  let best: Hit | null = null
  for (const f of FIELDS) {
    const dc = fieldPosition(f, t, tmpC).distanceTo(p)
    if (dc - f.spread > range) continue
    for (const r of f.rocks) {
      if (r.hp <= 0) continue
      rockPosition(r, t, tmpC).sub(p)
      const along = tmpC.dot(d)
      if (along < 0 || along - r.radius > range) continue
      const perp2 = tmpC.lengthSq() - along * along
      if (perp2 > r.radius * r.radius) continue
      const dist = along - Math.sqrt(r.radius * r.radius - perp2)
      if (dist < 0 || dist > range) continue
      if (!best || dist < best.dist) best = { rock: r, dist, point: new THREE.Vector3().copy(p).addScaledVector(d, dist) }
    }
  }
  return best
}

/** Units of fuel an ice rock gives up when it breaks. Stone gives nothing (ore, later). */
export function fuelYield(r: Rock): number {
  return r.ice ? Math.min(ICE_FUEL_MAX, r.radius * ICE_FUEL_PER_METRE) : 0
}

/** Everything back to unbroken. The harness uses it between tests. */
export function resetRocks(): void {
  for (const r of ROCKS) r.hp = 1 + Math.floor(r.radius * ROCK_HP_PER_METRE)
}

export function fieldOf(id: string): Field { const f = FIELDS.find((x) => x.id === id); if (!f) throw new Error(`no field ${id}`); return f }
