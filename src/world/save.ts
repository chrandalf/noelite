// The save (Chris, 2026-09-04: "need a save function too"). The game saves itself every
// time you land, and on demand from the pause menu when landed; a landed ship is the
// only state worth writing, so loading always puts you on a pad. Pure: the harness
// round-trips it headless. The game layer owns localStorage.
import * as THREE from 'three'
import type { Craft } from '../engine/Craft.ts'
import { Wreck } from '../engine/Wreck.ts'
import { Bank } from './economy.ts'
import { body, SYSTEM } from './system.ts'
import { terrainOf } from './height.ts'
import { saveTowns, loadTowns, type TownSave } from './town.ts'
import { seamsOf, type Good } from './seams.ts'
import { saveBoob, loadBoob } from './boob.ts'

export type SaveV1 = {
  v: 1
  /** Game clock, seconds. */
  t: number
  /** Wall clock, ms, for the menu. */
  savedAt: number
  /** Where you were: a pad's name. */
  where: string
  bank: ReturnType<Bank['toJSON']>
  craft: { ref: string; dir: number[]; heading: number[]; fuel: number; damage: number; gearBent: boolean; landings: number; crashes: number }
  wrecks: { body: string; wreck: ReturnType<Wreck['toJSON']> }[]
  /** Towns that have changed from seed, and seams that have been dug; both optional for older saves. */
  towns?: TownSave[]
  seams?: { body: string; i: number; richness: number }[]
  cargo?: { good: Good; tonnes: number }[]
  /** The boob, once seen up close: the game time. */
  boob?: { found: number }
}

const FWD = new THREE.Vector3(0, 0, -1)

/** A snapshot, or null when the ship is not on the ground. */
export function snapshot(craft: Craft, bank: Bank, wrecks: { body: string; wreck: Wreck }[], where: string, savedAt = Date.now()): SaveV1 | null {
  if (craft.state !== 'landed') return null
  const dir = craft.pos.clone().normalize()
  const heading = FWD.clone().applyQuaternion(craft.quat)
  return {
    v: 1, t: craft.time, savedAt, where,
    bank: bank.toJSON(),
    craft: { ref: craft.ref.id, dir: dir.toArray(), heading: heading.toArray(), fuel: craft.fuel, damage: craft.damage, gearBent: craft.gearBent, landings: craft.landings, crashes: craft.crashes },
    wrecks: wrecks.map((w) => ({ body: w.body, wreck: w.wreck.toJSON() })),
    towns: saveTowns(),
    seams: dugSeams(),
    cargo: craft.cargo.map((c) => ({ ...c })),
    boob: saveBoob(),
  }
}

/**
 * The world back from the save: the bank and the wrecks for the game to place, and, unless
 * `craft` is null (a URL put the ship somewhere else), the craft on its pad with its tank,
 * hull and clock.
 */
export function restore(craft: Craft | null, s: SaveV1): { bank: Bank; wrecks: { body: string; wreck: Wreck }[] } {
  if (craft) {
    const on = body(s.craft.ref)
    craft.spawnOn(new THREE.Vector3().fromArray(s.craft.dir), new THREE.Vector3().fromArray(s.craft.heading), 'surface', on)
    craft.time = s.t
    craft.fuel = s.craft.fuel
    craft.damage = s.craft.damage
    craft.gearBent = s.craft.gearBent
    craft.landings = s.craft.landings
    craft.crashes = s.craft.crashes
    craft.cargo.length = 0
    for (const c of s.cargo ?? []) craft.cargo.push({ ...c })
  }
  loadTowns(s.towns)
  loadBoob(s.boob)
  for (const d of s.seams ?? []) { const list = seamsOf(terrainOf(body(d.body))); if (list[d.i]) list[d.i].richness = d.richness }
  const wrecks = s.wrecks.map((w) => ({ body: w.body, wreck: Wreck.restore(terrainOf(body(w.body)), w.wreck) }))
  return { bank: Bank.fromJSON(s.bank), wrecks }
}

export function isSave(j: unknown): j is SaveV1 {
  return typeof j === 'object' && j !== null && (j as { v?: unknown }).v === 1 && typeof (j as { craft?: unknown }).craft === 'object'
}

/** Every seam that is not what the seed made it: dug into. */
function dugSeams(): { body: string; i: number; richness: number }[] {
  const out: { body: string; i: number; richness: number }[] = []
  for (const b of SYSTEM) {
    if (b.kind === 'sun' || b.kind === 'giant') continue
    seamsOf(terrainOf(b)).forEach((s, i) => { if (s.dug) out.push({ body: b.id, i, richness: s.richness }) })
  }
  return out
}
