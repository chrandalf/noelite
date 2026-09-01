#!/usr/bin/env node
// Flight instrument. Drives the physics directly, no browser: Craft has no DOM
// dependency by design. It cannot tell you the handling is fun. It will tell
// you the moment it stops being a flight model.
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { findLandable } from '../src/world/terrain.ts'
import { FIXED_DT, GRAVITY, DRAG, LAND_MAX_VSPEED, MASTER_SEED, GROUND_EFFECT_HEIGHT, ATMOSPHERE_HEIGHT } from '../src/world/config.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
const T = (thrust, pitch = 0, roll = 0, yaw = 0, boost = 0) => ({ pitch, roll, yaw, thrust, boost })

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
// 9. Boost lifts harder.
{
  const a = fresh(), b = fresh()
  until(a, () => false, 3, () => T(1))
  until(b, () => false, 3, () => T(1, 0, 0, 0, 1))
  check('shift boost climbs faster than plain thrust', b.altitude() > 1.8 * a.altitude(), `${a.altitude().toFixed(1)} m vs ${b.altitude().toFixed(1)} m in 3 s`)
}
// 10. The ground answers back: a drop from just above the cushion arrives slower than free fall.
{
  const c = fresh()
  const h = GROUND_EFFECT_HEIGHT + 4
  until(c, (c) => c.altitude() > h, 10, () => T(1))
  until(c, (c) => c.vUp() <= 0, 10, () => IDLE) // let it top out
  const top = c.altitude()
  until(c, (c) => c.state !== 'flying', 20, () => IDLE)
  const freeFall = Math.sqrt(2 * GRAVITY * top)
  check('ground effect softens a dead drop', c.lastContact.vUp > -freeFall * 0.9, `from ${top.toFixed(1)} m: touched at ${c.lastContact.vUp.toFixed(1)} m/s, free fall would be ${(-freeFall).toFixed(1)}`)
}
// 11. You can escape, and the retro assist can bring you back from it.
{
  const c = fresh()
  until(c, () => false, 15, () => T(1, 0, 0, 0, 1))
  const escaping = c.altitude() > ATMOSPHERE_HEIGHT && c.speed() > c.escapeSpeed()
  check('15 s of boost escapes the planet', escaping, `alt ${c.altitude().toFixed(0)} m, ${c.speed().toFixed(0)} m/s vs escape ${c.escapeSpeed().toFixed(0)}`)
  const v0 = c.speed()
  let minV = v0, aligned = 0
  const retro = new THREE.Vector3(), bodyUp = new THREE.Vector3()
  const t = until(c, (c) => c.speed() < 10, 60, (t, c) => {
    retro.copy(c.vel).normalize().negate()
    bodyUp.set(0, 1, 0).applyQuaternion(c.quat)
    const a = c.aimControls(retro)
    const ok = bodyUp.dot(retro) > 0.98
    if (ok) aligned++
    minV = Math.min(minV, c.speed())
    return { ...T(ok ? 1 : 0, a.pitch, a.roll, 0, 1) }
  })
  check('retro assist + boost kills escape velocity', c.speed() < 10, `${v0.toFixed(0)} → ${c.speed().toFixed(1)} m/s in ${t.toFixed(1)} s, aligned ${(aligned * FIXED_DT).toFixed(1)} s of it`)
  // 12. Nadir assist points the thrust axis at the planet.
  const nadir = new THREE.Vector3()
  until(c, () => false, 6, (t, c) => { nadir.copy(c.pos).normalize().negate(); const a = c.aimControls(nadir); return T(0, a.pitch, a.roll) })
  bodyUp.set(0, 1, 0).applyQuaternion(c.quat)
  check('nadir assist points thrust at the planet', bodyUp.dot(nadir) > 0.95, `dot ${bodyUp.dot(nadir).toFixed(3)}`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
