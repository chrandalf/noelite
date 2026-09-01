#!/usr/bin/env node
// Flight instrument. Drives the physics directly, no browser: Craft has no DOM
// dependency by design. It cannot tell you the handling is fun. It will tell
// you the moment it stops being a flight model.
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { findLandable } from '../src/world/terrain.ts'
import { FIXED_DT, GRAVITY, DRAG, LAND_MAX_VSPEED, MASTER_SEED } from '../src/world/config.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
const T = (thrust, pitch = 0, roll = 0, yaw = 0) => ({ pitch, roll, yaw, thrust })

const pad = findLandable(new THREE.Vector3(0, 0, 1), MASTER_SEED)
// Level spawn: thrust is then exactly radial, so a no-steer autopilot comes back
// down on the pad it left. The game spawns aligned to the slope, on purpose.
const fresh = () => { const c = new Craft(MASTER_SEED); c.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial'); return c }
/** Run until pred(craft) or maxSeconds. controller(t, craft) → Controls. Returns seconds elapsed. */
function until(craft, pred, maxSeconds, controller) {
  let t = 0
  while (t < maxSeconds && !pred(craft)) {
    craft.substep(FIXED_DT, controller(t, craft)); t += FIXED_DT
    if (!finite(craft.pos) || !finite(craft.vel)) throw new Error(`NaN at t=${t.toFixed(2)}`)
  }
  return t
}

// 1. It rests.
{
  const c = fresh(); const p0 = c.pos.clone()
  until(c, () => false, 5, () => IDLE)
  check('sits on the pad with no thrust', c.state === 'landed' && c.pos.equals(p0), `state ${c.state}`)
}
// 2. It lifts.
const c2 = fresh()
{
  until(c2, () => false, 3, () => T(1))
  check('three seconds of thrust lifts it', c2.state === 'flying' && c2.altitude() > 15, `alt ${c2.altitude().toFixed(1)} m, v↑ ${c2.vUp().toFixed(1)}`)
}
// 3. It falls, and falling is fatal.
{
  const t = until(c2, (c) => c.state !== 'flying', 60, () => IDLE)
  check('cutting thrust ends in a crash', c2.state === 'crashed' && c2.lastContact.vUp < -LAND_MAX_VSPEED, `after ${t.toFixed(1)} s at v↑ ${c2.lastContact.vUp.toFixed(1)} m/s`)
}
// 4. Drag caps the fall.
{
  const c = fresh()
  until(c, (c) => c.altitude() > 400, 40, () => T(1))
  let minV = 0
  until(c, (c) => c.state !== 'flying', 120, (t, c) => { minV = Math.min(minV, c.vUp()); return IDLE })
  const vt = Math.sqrt(GRAVITY / DRAG)
  check('terminal velocity is roughly √(g/DRAG)', minV < -0.7 * vt && minV > -1.3 * vt, `fastest fall ${minV.toFixed(1)} m/s, √(g/DRAG) = ${vt.toFixed(1)}`)
}
// 5. A bang-bang autopilot can land it. If this fails the game is not landable.
const land = () => {
  const c = fresh()
  until(c, (c) => c.altitude() > 80, 20, () => T(1))
  const t = until(c, (c) => c.state !== 'flying', 90, (t, c) => T(c.vUp() < -2 ? 1 : 0))
  return { c, t }
}
const L1 = land()
{
  const lc = L1.c.lastContact
  check('autopilot lands from 80 m', L1.c.state === 'landed' && L1.c.landings === 1 && L1.c.crashes === 0, `${L1.t.toFixed(1)} s, touched at v↑ ${lc.vUp.toFixed(2)}, drift ${lc.vH.toFixed(2)}, tilt ${lc.tilt.toFixed(1)}°, slope ${lc.slope.toFixed(1)}°`)
}
// 6. Same tape, same bits.
{
  const L2 = land()
  check('the same run is bit-identical', L1.c.pos.x === L2.c.pos.x && L1.c.pos.y === L2.c.pos.y && L1.c.pos.z === L2.c.pos.z && L1.t === L2.t)
}
// 7. Tilt to move: nose down and burn, and you go somewhere.
{
  const c = fresh()
  until(c, () => false, 2, () => T(1))
  until(c, () => false, 0.4, () => T(1, 1))
  until(c, () => false, 3, () => T(1))
  const up = c.pos.clone().normalize(), vUp = c.vel.dot(up)
  const vH = Math.sqrt(Math.max(0, c.vel.lengthSq() - vUp * vUp))
  check('nose down + thrust builds horizontal speed', c.state === 'flying' && vH > 3, `drift ${vH.toFixed(1)} m/s, tilt ${c.tilt().toFixed(0)}°`)
}
// 8. Let go of the stick and the rotation stops.
{
  const c = fresh()
  until(c, () => false, 2, () => T(1))
  until(c, () => false, 0.3, () => T(1, 0, 1))
  const spinning = c.angVel.length()
  until(c, () => false, 2, () => T(1))
  check('angular velocity decays after a pulse', spinning > 0.5 && c.angVel.length() < 0.05, `${spinning.toFixed(2)} → ${c.angVel.length().toFixed(3)} rad/s`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
