// Towns, cargo and the dig (DESIGN §10e-2, §10g), headless: a town builds only with materials
// and workers, grows watered and shrinks thirsty; a pod has mass the ship feels; a dig fills a
// pod from a seam and the seam remembers; a sale pays more when the town is short; all of it
// round-trips the save. Run: node tools/verify-town.mjs
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { Bank } from '../src/world/economy.ts'
import { snapshot, restore } from '../src/world/save.ts'
import { allTowns, townById, townsOn, current, shortfall, priceAt, sell, tick, WORKS, POP_FLOOR } from '../src/world/town.ts'
import { seamsOf } from '../src/world/seams.ts'
import { HOME, padOf } from '../src/world/height.ts'
import { body } from '../src/world/system.ts'
import { FIXED_DT, CYCLE, POD_TONNES, CARGO_PODS, GOOD_PRICE, UNWANTED_SHARE, SHIP_TONNES } from '../src/world/config.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol
const T = (thrust) => ({ ...IDLE, thrust });

// 1. Towns exist where the pads are.
{
  const all = allTowns(), home = townsOn(HOME)
  check('every settled body has a town per outpost and one at the station', home.length === 7 && all.length >= 7 * 4, `${home.length} on home, ${all.length} in all`)
  check('a town starts with a works list and a few people', home.every((t) => t.works.length === WORKS.length && t.population >= 10 && current(t)?.id === 'warehouse'))
}
// 2. Building needs materials and workers; the store gates the rate.
{
  const t = townById('home:1')
  const p = current(t)
  const before = p.progress
  for (let s = 0; s < CYCLE; s += FIXED_DT) tick(t, FIXED_DT)
  check('with an empty store nothing gets built', p.progress === before, `progress ${p.progress}`)
  const sf = shortfall(t)
  check('the shortfall is the whole bill', sf.timber === 8 && sf.salt === 4)
  t.stock.timber = 8; t.stock.salt = 4; t.stock.water = 50   // the workers lick the salt too: the job will stall short of it
  let s0 = 0; while (current(t)?.id === 'warehouse' && s0 < 20 * CYCLE) { tick(t, FIXED_DT); s0 += CYCLE / 10 * 0 + FIXED_DT }
  check('a job stalls when the workers have eaten part of its bill', current(t)?.id === 'warehouse' && p.progress > 0 && p.progress < p.labour, `progress ${(100 * p.progress / p.labour).toFixed(0)}%`)
  t.stock.salt = (t.stock.salt ?? 0) + 2
  const pop = t.population
  let s = 0; while (current(t)?.id === 'warehouse' && s < 20 * CYCLE) { tick(t, FIXED_DT); s += FIXED_DT }
  check('topped up, the warehouse gets built', t.built[0] === 'warehouse', `${(s + s0).toFixed(0)} s with ${pop} workers, labour ${p.labour}`)
  check('the job used its bill from the stock', near(p.used.timber, 8, 1e-6) && near(p.used.salt, 4, 1e-6) && (t.stock.timber ?? 0) < 1e-6)
  check('and moved on to the next job', current(t)?.id === 'water')
}
// 3. Population: watered it grows, thirsty it shrinks to the floor.
{
  const a = townById('home:2'); a.stock.water = 1000; a.stock.salt = 100
  const p0 = a.population
  for (let s = 0; s < 10 * CYCLE; s += FIXED_DT) tick(a, FIXED_DT)
  check('watered and salted, a town grows', a.population > p0 * 1.3, `${p0} → ${a.population} in ten cycles`)
  const b = townById('home:3'); b.stock.water = 0
  for (let s = 0; s < 40 * CYCLE; s += FIXED_DT) tick(b, FIXED_DT)
  check('thirsty, it shrinks to the floor and no further', b.population === POP_FLOOR, `${b.population}`)
}
// 4. Prices and sales.
{
  const t = townById('home:4')
  check('a town short of a good pays 60% over base', near(priceAt(t, 'timber'), GOOD_PRICE.timber * 1.6, 1e-9) && near(priceAt(t, 'salt'), GOOD_PRICE.salt * 1.6, 1e-9))
  check('and half for what it has no use for', near(priceAt(t, 'crystal'), GOOD_PRICE.crystal * UNWANTED_SHARE, 1e-9))
  const paid = sell(t, 'timber', POD_TONNES)
  check('a sale pays and stocks', near(paid, GOOD_PRICE.timber * 1.6 * POD_TONNES, 1e-9) && t.stock.timber === POD_TONNES, `${paid.toFixed(0)} cr`)
  check('the price eases as the town fills up', priceAt(t, 'timber') < GOOD_PRICE.timber * 1.6 && priceAt(t, 'timber') >= GOOD_PRICE.timber)
}
// 5. Cargo has mass: a loaded ship climbs and turns slower and can only carry so much.
{
  const site = padOf(HOME), pad = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  const e = new Craft(HOME); e.windy = false; e.assist = false; e.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial')
  const l = new Craft(HOME); l.windy = false; l.assist = false; l.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial')
  check('three pods fit and a fourth does not', l.load('ore') && l.load('ore') && l.load('ore') && !l.load('ore') && l.cargo.length === CARGO_PODS)
  check('the mass factor is one plus the cargo over the dry ship', near(l.massFactor(), 1 + (3 * POD_TONNES) / SHIP_TONNES, 1e-9) && e.massFactor() === 1)
  for (let s = 0; s < 4; s += FIXED_DT) { e.substep(FIXED_DT, T(1)); l.substep(FIXED_DT, T(1)) }
  check('loaded, four seconds of thrust climbs less', l.altitude() < e.altitude() * 0.7 && l.altitude() > 0, `${l.altitude().toFixed(1)} m vs ${e.altitude().toFixed(1)} m empty`)
  const e2 = new Craft(HOME); e2.windy = false; e2.placeAbove(body('home'), pad, 300)
  const l2 = new Craft(HOME); l2.windy = false; l2.placeAbove(body('home'), pad, 300); l2.load('ore'); l2.load('ore'); l2.load('ore')
  for (let s = 0; s < 2; s += FIXED_DT) { e2.substep(FIXED_DT, { ...IDLE, thrust: 1, roll: 1 }); l2.substep(FIXED_DT, { ...IDLE, thrust: 1, roll: 1 }) }
  check('loaded, it rolls slower', l2.angVel.length() < e2.angVel.length() * 0.8, `${l2.angVel.length().toFixed(2)} vs ${e2.angVel.length().toFixed(2)} rad/s`)
}
// 6. The dig: landed inside a seam, a pod fills and the seam remembers.
{
  const seam = seamsOf(HOME).find((s) => s.good === 'ore') ?? seamsOf(HOME)[0]
  const d = new THREE.Vector3(seam.dir.x, seam.dir.y, seam.dir.z)
  const c = new Craft(HOME); c.windy = false; c.spawnOn(d, new THREE.Vector3(1, 0, 0), 'surface', body('home'))
  check('landed on a seam the ship knows it', c.seamHere() === seam, `${seam.good}, ${seam.richness} t`)
  const off = new Craft(HOME); off.windy = false; off.spawnOn(new THREE.Vector3(site0().x, site0().y, site0().z), new THREE.Vector3(1, 0, 0), 'surface', body('home'))
  check('and on the pad it does not', off.seamHere() === null)
  const r0 = seam.richness
  const took = Math.min(POD_TONNES, seam.richness); seam.richness -= took; seam.dug = true; c.load(seam.good, took)
  check('a dig moves a pod from the ground to the hull', c.cargo.length === 1 && c.cargo[0].good === seam.good && seam.richness === r0 - POD_TONNES)
  // The save keeps the dug seam, the town's progress and the cargo.
  const t = townById('home:1')
  const snap = snapshot(c, new Bank(), [], 'a seam')
  const j = JSON.parse(JSON.stringify(snap))
  check('the save carries the town, the seam and the cargo', j.towns.some((x) => x.id === 'home:1' && x.built[0] === 'warehouse') && j.seams.some((x) => x.body === 'home' && x.richness === r0 - POD_TONNES) && j.cargo.length === 1)
  seam.richness = r0; t.built.length = 0; t.works[0].progress = 0
  const c2 = new Craft(HOME); restore(c2, j)
  check('and puts them back', seam.richness === r0 - POD_TONNES && townById('home:1').built[0] === 'warehouse' && c2.cargo.length === 1 && c2.cargo[0].good === seam.good)
  function site0() { return padOf(HOME).dir }
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
