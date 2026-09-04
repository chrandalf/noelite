// The money (DESIGN §10e), headless: the bank's shape, and the ship buying fuel and repairs
// at pads only while the credit lasts. Run: node tools/verify-economy.mjs
import * as THREE from 'three'
import { Bank } from '../src/world/economy.ts'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { HOME, padOf, stationOf } from '../src/world/height.ts'
import { START_CASH, START_LOAN, LOAN_MAX, LOAN_RATE_PER_DAY, DAY_LENGTH, FUEL_TANK, FUEL_PAD_REFILL, FUEL_PRICE, REPAIR_PRICE, FIXED_DT } from '../src/world/config.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol

// 1. The bank.
{
  const b = new Bank()
  check('you start with the cash and the loan', b.balance === START_CASH && b.loan === START_LOAN, `${b.balance} cash, ${b.loan} loan`)
  check('you cannot spend what you have not got', !b.spend(0, 'TEST', START_CASH + 1) && b.balance === START_CASH)
  check('you can spend what you have, and it is booked', b.spend(0, 'FUEL', 200) && b.balance === START_CASH - 200 && b.ledger.at(-1).what === 'FUEL' && b.ledger.at(-1).amount === -200)
  b.earn(10, 'DELIVERY', 500)
  check('earnings add and are booked', b.balance === START_CASH + 300 && b.ledger.at(-1).amount === 500)
  const before = b.balance
  b.accrue(DAY_LENGTH, 100)
  check('a day of interest costs LOAN_RATE_PER_DAY of the loan', near(before - b.balance, START_LOAN * LOAN_RATE_PER_DAY, 1e-6) && b.ledger.at(-1).what === 'INTEREST', `${(before - b.balance).toFixed(2)} credits`)
  const got = b.borrow(200, LOAN_MAX)
  check('borrowing is capped at LOAN_MAX', b.loan === LOAN_MAX && got === LOAN_MAX - START_LOAN)
  const paid = b.repay(300, 1e9)
  check('repaying is capped by the balance and the loan', paid === Math.min(LOAN_MAX, b.balance + paid) && b.balance >= 0 && b.loan >= 0, `repaid ${paid.toFixed(0)}, loan now ${b.loan.toFixed(0)}`)
  const j = JSON.parse(JSON.stringify(b)), b2 = Bank.fromJSON(j)
  check('the bank survives a save and load', b2.balance === b.balance && b2.loan === b.loan && b2.ledger.length === b.ledger.length)
  const b3 = new Bank(0, 0); b3.accrue(DAY_LENGTH, 0)
  check('no loan, no interest', b3.balance === 0 && b3.ledger.length === 0)
}

// 2. The ship at a pad: fuel for credit, and only for credit.
{
  const site = padOf(HOME), pad = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  const c = new Craft(HOME); c.windy = false; c.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial')
  c.fuel = 10; c.credit = 10
  for (let t = 0; t < 30; t += FIXED_DT) c.substep(FIXED_DT, IDLE)
  check('with 10 credits at 2 a unit the pad sells 5 units and stops', near(c.bought.fuel, 5, 0.01) && c.credit < 0.01 && c.fuel < 10 + 5 + 3.1, `bought ${c.bought.fuel.toFixed(2)}, fuel ${c.fuel.toFixed(1)}, credit left ${c.credit.toFixed(2)}`)
  const d = new Craft(HOME); d.windy = false; d.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial')
  d.fuel = 0; d.credit = Infinity
  for (let t = 0; t < 30; t += FIXED_DT) d.substep(FIXED_DT, IDLE)
  check('with credit the pad fills the tank, the sun giving a couple of units free', d.fuel === FUEL_TANK && d.bought.fuel > FUEL_TANK - 4 && d.bought.fuel < FUEL_TANK && FUEL_PAD_REFILL * 30 >= FUEL_TANK, `bought ${d.bought.fuel.toFixed(1)} of ${FUEL_TANK} in 30 s`)
  const e = new Craft(HOME); e.windy = false; e.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial')
  e.fuel = 0; e.credit = 0
  for (let t = 0; t < 30; t += FIXED_DT) e.substep(FIXED_DT, IDLE)
  check('broke, the pad sells nothing and only the sun trickles', e.bought.fuel === 0 && e.fuel > 0 && e.fuel < 5, `fuel ${e.fuel.toFixed(2)} after 30 s`)
}

// 3. Repairs at the station cost REPAIR_PRICE a hull, and stop when the credit does.
{
  const st = stationOf(HOME), p = st.pads[0].dir
  const r = new Craft(HOME); r.windy = false; r.spawnOn(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(1, 0, 0), 'radial')
  r.damage = 0.5; r.gearBent = true; r.credit = REPAIR_PRICE * 0.2; r.fuel = FUEL_TANK
  for (let t = 0; t < 30; t += FIXED_DT) r.substep(FIXED_DT, IDLE)
  check('a fifth of the repair price buys a fifth of a hull', near(r.bought.repair, 0.2, 0.01) && near(r.damage, 0.3, 0.01) && r.gearBent, `repaired ${r.bought.repair.toFixed(2)}, damage ${r.damage.toFixed(2)}`)
  r.credit = Infinity
  for (let t = 0; t < 30; t += FIXED_DT) r.substep(FIXED_DT, IDLE)
  check('with credit the rest is fixed and the gear straightened', r.damage === 0 && !r.gearBent && near(r.bought.repair, 0.5, 0.01), `bought ${r.bought.repair.toFixed(2)} of a hull`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
