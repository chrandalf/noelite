// The save (DESIGN §10e), headless: a landed ship, its books and its wrecks round-trip
// through JSON and come back on the same pad with the same tank, hull, clock and debris.
// Run: node tools/verify-save.mjs
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { Wreck } from '../src/engine/Wreck.ts'
import { Bank } from '../src/world/economy.ts'
import { snapshot, restore, isSave } from '../src/world/save.ts'
import { HOME, outpostsOf, terrainOf } from '../src/world/height.ts'
import { body } from '../src/world/system.ts'
import { FIXED_DT } from '../src/world/config.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }

const o = outpostsOf(HOME)[2], dir = new THREE.Vector3(o.site.dir.x, o.site.dir.y, o.site.dir.z)
const c = new Craft(HOME); c.windy = false
c.spawnOn(dir, new THREE.Vector3(0, 1, 0), 'surface', body('home'))
c.time = 1234.5; c.fuel = 37; c.damage = 0.2; c.gearBent = true; c.landings = 4; c.crashes = 1
const bank = new Bank(1500, 2500); bank.earn(1000, 'DELIVERY', 300)
// A wreck on Marram, settled.
const marram = terrainOf(body('terra-a'))
const w = new Wreck(marram, new THREE.Vector3(0, 0, marram.radius + 40), new THREE.Quaternion(), new THREE.Vector3(3, 0, -8), 5)
for (let t = 0; t < 20 && !w.settled(); t += FIXED_DT) w.step(FIXED_DT)
const snap = snapshot(c, bank, [{ body: 'terra-a', wreck: w }], 'Moor Outpost', 1_700_000_000_000)
check('a landed ship gives a snapshot', snap !== null && isSave(snap))
const f = new Craft(HOME); f.windy = false; f.spawnOn(dir, new THREE.Vector3(1, 0, 0), 'radial'); for (let t = 0; t < 3; t += FIXED_DT) f.substep(FIXED_DT, { ...IDLE, thrust: 1 })
check('a flying ship gives none', f.state === 'flying' && snapshot(f, bank, [], 'air') === null)
const json = JSON.stringify(snap)
const back = JSON.parse(json)
check('the JSON is a save', isSave(back) && back.v === 1 && back.where === 'Moor Outpost' && back.savedAt === 1_700_000_000_000)
const c2 = new Craft(HOME); c2.windy = false
const r = restore(c2, back)
const d2 = c2.pos.clone().normalize()
check('the ship is back on the same pad, landed', c2.state === 'landed' && c2.ref.id === 'home' && d2.angleTo(dir) * HOME.radius < 0.01, `${(d2.angleTo(dir) * HOME.radius * 100).toFixed(2)} cm off`)
const h1 = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat), h2 = new THREE.Vector3(0, 0, -1).applyQuaternion(c2.quat)
check('facing the same way', h1.angleTo(h2) < 0.01, `${(h1.angleTo(h2) * 180 / Math.PI).toFixed(2)}°`)
check('with the same tank, hull, gear and clock', c2.fuel === 37 && c2.damage === 0.2 && c2.gearBent && c2.time === 1234.5 && c2.landings === 4 && c2.crashes === 1)
check('the books come back', r.bank.balance === bank.balance && r.bank.loan === 2500 && r.bank.ledger.at(-1).what === 'DELIVERY')
const w2 = r.wrecks[0].wreck
const same = w2.pieces.every((p, i) => p.pos.distanceTo(w.pieces[i].pos) < 1e-6 && p.quat.angleTo(w.pieces[i].quat) < 1e-6 && p.resting)
check('the wreck comes back on Marram, every piece where it lay', r.wrecks[0].body === 'terra-a' && w2.terrain.id === marram.id && w2.settled() && same)
for (let t = 0; t < 5; t += FIXED_DT) c2.substep(FIXED_DT, IDLE)
check('and the restored ship sits still on its pad', c2.state === 'landed' && c2.pos.clone().normalize().angleTo(dir) * HOME.radius < 0.01)
check('rubbish is not a save', !isSave(null) && !isSave({}) && !isSave({ v: 2, craft: {} }))

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
