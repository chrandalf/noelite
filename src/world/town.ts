// Towns (DESIGN §10e-2): every outpost and station is a settlement that builds itself
// from what you deliver. A works list of projects, each with a bill of materials and a
// labour cost; a stock; a population that is the workforce, growing on water and salt
// and shrinking without. You never place anything: you feed a town and it grows. Pure,
// so the town harness can run a town for a day in a millisecond; the game draws it.
import type { Terrain, UnitVector } from './height.ts'
import { outpostsOf, stationOf, terrainOf } from './height.ts'
import { SYSTEM, SETTLED, body } from './system.ts'
import { rng } from './noise.ts'
import type { Good } from './seams.ts'
import { GOOD_PRICE, UNWANTED_SHARE, CYCLE } from './config.ts'

export type Bill = Partial<Record<Good, number>>
export type Project = {
  id: string; name: string
  /** Tonnes of each good the job needs, delivered before it can finish. */
  bill: Bill
  /** Worker-seconds of labour. */
  labour: number
  /** Worker-seconds done so far. */
  progress: number
  /** What the town has used from its stock toward the bill so far. */
  used: Bill
}
export type Town = {
  id: string; name: string; body: string
  /** Where it is: a unit direction and the pad's height. */
  dir: { x: number; y: number; z: number }; h: number
  population: number
  stock: Partial<Record<Good, number>>
  works: Project[]
  built: string[]
  /** Fractional population growth carried between ticks. */
  growth: number
}

/** The works list every town starts with, in order. Guessed numbers: a pod is 4 t, so a warehouse is two runs. */
export const WORKS: { id: string; name: string; bill: Bill; labour: number }[] = [
  { id: 'warehouse', name: 'a warehouse', bill: { timber: 8, salt: 4 }, labour: 60 * 20 },
  { id: 'water', name: 'a water plant', bill: { ore: 8, timber: 4 }, labour: 60 * 30 },
  { id: 'pad', name: 'a bigger pad', bill: { ore: 12, salt: 4 }, labour: 60 * 40 },
  { id: 'workshop', name: 'a workshop', bill: { ore: 12, timber: 12, crystal: 2 }, labour: 60 * 60 },
  { id: 'rail', name: 'a rail spur to the nearest town', bill: { ore: 24, timber: 16 }, labour: 60 * 120 },
]
/** Tonnes of water a worker drinks per cycle, and of salt; short of either the town shrinks. */
export const WATER_PER_WORKER = 0.02
export const SALT_PER_WORKER = 0.004
/** Population change per cycle: fed and watered it grows, thirsty it shrinks. A floor so a town never dies out. */
export const GROWTH_PER_CYCLE = 0.04
export const SHRINK_PER_CYCLE = 0.06
export const POP_FLOOR = 4

const towns = new Map<string, Town>()

function make(id: string, name: string, bodyId: string, dir: { x: number; y: number; z: number }, h: number, seed: number): Town {
  const next = rng(seed >>> 0)
  return {
    id, name, body: bodyId, dir, h,
    population: 10 + Math.floor(next() * 20),
    stock: { water: 2 + Math.floor(next() * 4) },
    works: WORKS.map((w) => ({ id: w.id, name: w.name, bill: { ...w.bill }, labour: w.labour, progress: 0, used: {} })),
    built: [], growth: 0,
  }
}

/** Every town in the system: one per outpost and one per station on each settled body. Built once. */
export function allTowns(): Town[] {
  if (towns.size === 0) {
    for (const b of SYSTEM) {
      if (!SETTLED.has(b.kind)) continue
      const t = terrainOf(b)
      const st = stationOf(t)
      if (st) towns.set(`${b.id}:station`, make(`${b.id}:station`, st.name, b.id, st.site.dir, st.site.h, b.seed ^ 0x544f574e))
      for (const o of outpostsOf(t)) towns.set(`${b.id}:${o.n}`, make(`${b.id}:${o.n}`, o.name, b.id, o.site.dir, o.site.h, b.seed ^ Math.imul(o.n + 1, 0x9e3779b1)))
    }
  }
  return [...towns.values()]
}
export function townsOn(t: Terrain): Town[] { return allTowns().filter((x) => x.body === t.id) }
export function townById(id: string): Town | undefined { allTowns(); return towns.get(id) }

/** The project a town is working on: the first unfinished one. */
export function current(town: Town): Project | null { return town.works.find((p) => p.progress < p.labour) ?? null }

/** What the current project still needs delivered, by good. */
export function shortfall(town: Town): Bill {
  const p = current(town); if (!p) return {}
  const out: Bill = {}
  for (const g of Object.keys(p.bill) as Good[]) {
    const need = (p.bill[g] ?? 0) - (p.used[g] ?? 0) - (town.stock[g] ?? 0)
    if (need > 1e-9) out[g] = need
  }
  return out
}

/** Credits per tonne the town pays for a good right now: base, up to 60% over when the current job is short of it, half for what it has no use for. */
export function priceAt(town: Town, good: Good): number {
  const p = current(town)
  const need = p ? p.bill[good] ?? 0 : 0
  if (need <= 0) return GOOD_PRICE[good] * UNWANTED_SHARE
  const short = Math.max(0, need - (p!.used[good] ?? 0) - (town.stock[good] ?? 0))
  return GOOD_PRICE[good] * (1 + 0.6 * Math.min(1, short / need))
}

/** Sell a pod to the town: it goes into the stock, the credits come back. */
export function sell(town: Town, good: Good, tonnes: number): number {
  const paid = priceAt(town, good) * tonnes
  town.stock[good] = (town.stock[good] ?? 0) + tonnes
  return paid
}

/**
 * Run the town for `dt` seconds. Workers drink; the population grows watered and salted,
 * shrinks thirsty, never below the floor. The current project draws its bill from the
 * stock as it goes and advances by workers × the share of its materials on hand, so an
 * empty store builds nothing and a full one builds at the full rate.
 */
export function tick(town: Town, dt: number): void {
  const cycles = dt / CYCLE
  const water = town.stock.water ?? 0, salt = town.stock.salt ?? 0
  const drink = WATER_PER_WORKER * town.population * cycles, lick = SALT_PER_WORKER * town.population * cycles
  const watered = water >= drink, salted = salt >= lick
  town.stock.water = Math.max(0, water - drink)
  town.stock.salt = Math.max(0, salt - lick)
  town.growth += town.population * (watered ? (salted ? GROWTH_PER_CYCLE : GROWTH_PER_CYCLE * 0.4) : -SHRINK_PER_CYCLE) * cycles
  const whole = Math.trunc(town.growth)
  if (whole !== 0) { town.population = Math.max(POP_FLOOR, town.population + whole); town.growth -= whole }
  const p = current(town)
  if (!p) return
  // The share of the bill on hand (delivered so far, used or in the store) gates both the
  // rate and how far the work can get; a hair of tolerance so rounding never stalls a job.
  let share = 1
  for (const g of Object.keys(p.bill) as Good[]) {
    const need = p.bill[g] ?? 0
    if (need <= 0) continue
    const have = (p.used[g] ?? 0) + (town.stock[g] ?? 0)
    share = Math.min(share, have > 0 ? (have + 1e-6) / need : 0)
  }
  if (share <= 0) return
  const done = Math.max(0, Math.min(p.labour - p.progress, town.population * dt * share, share * p.labour - p.progress))
  if (done <= 0) return
  p.progress += done
  if (p.progress >= p.labour - 1e-6) p.progress = p.labour
  // Materials go into the job as it goes; at the end whatever is left of the bill goes in.
  const frac = p.progress / p.labour
  for (const g of Object.keys(p.bill) as Good[]) {
    const want = Math.min(p.bill[g] ?? 0, (p.bill[g] ?? 0) * (frac >= 1 ? 1 : frac)) - (p.used[g] ?? 0)
    const take = Math.min(want, town.stock[g] ?? 0)
    if (take > 0) { town.stock[g] = (town.stock[g] ?? 0) - take; p.used[g] = (p.used[g] ?? 0) + take }
  }
  if (p.progress >= p.labour) town.built.push(p.id)
}

export type TownSave = { id: string; population: number; stock: Partial<Record<Good, number>>; built: string[]; works: { id: string; progress: number; used: Bill }[] }
export function saveTowns(): TownSave[] {
  return allTowns().filter((t) => t.built.length || t.works.some((p) => p.progress > 0) || Object.values(t.stock).some((v) => v && v > 6))
    .map((t) => ({ id: t.id, population: t.population, stock: { ...t.stock }, built: t.built.slice(), works: t.works.map((p) => ({ id: p.id, progress: p.progress, used: { ...p.used } })) }))
}
export function loadTowns(saved: TownSave[] | undefined): void {
  if (!saved) return
  for (const s of saved) {
    const t = townById(s.id); if (!t) continue
    t.population = s.population; t.stock = { ...s.stock }; t.built = s.built.slice()
    for (const w of s.works) { const p = t.works.find((x) => x.id === w.id); if (p) { p.progress = w.progress; p.used = { ...w.used } } }
  }
}

/**
 * Where to put down to trade with a town: a station's town sits on the dome in the middle of
 * the disc, which is not a pad, so the ship lands on the nearest of its four pads instead
 * (Chris, 2026-09-05: the demo "goes straight for the middle and just sinks under the big
 * white nobble ... landed and taken off now 5 times"). `from` is a unit direction to pick
 * the nearest pad; an outpost has one pad and it is the town.
 */
export function landingFor(town: Town, from?: UnitVector): { dir: UnitVector; h: number } {
  if (town.id.endsWith(':station')) {
    const st = stationOf(terrainOf(body(town.body)))
    if (st) {
      let best = st.pads[0], bestC = -2
      if (from) for (const p of st.pads) { const c = from.x * p.dir.x + from.y * p.dir.y + from.z * p.dir.z; if (c > bestC) { bestC = c; best = p } }
      return { dir: best.dir, h: st.site.h }
    }
  }
  return { dir: town.dir, h: town.h }
}

