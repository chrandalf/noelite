#!/usr/bin/env node
// Flight instrument. Drives the physics directly, no browser: Craft has no DOM
// dependency by design. It cannot tell you the handling is fun. It will tell
// you the moment it stops being a flight model.
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { OrbitAutopilot } from '../src/engine/Autopilot.ts'
import { findLandable, groundRadius } from '../src/world/terrain.ts'
import { HOME, height, padOf, stationOf, terrainOf } from '../src/world/height.ts'
import { Wreck } from '../src/engine/Wreck.ts'
import { isDry } from '../src/world/terrain.ts'
import { rng } from '../src/world/noise.ts'
import { body, bodyVelocity, bodyPosition, bodySpin } from '../src/world/system.ts'
import { wind } from '../src/world/weather.ts'
import { FIELDS, resetRocks } from '../src/world/asteroids.ts'
import { FIXED_DT, DRAG, LAND_MAX_VSPEED, GROUND_EFFECT_HEIGHT, CRUISE_MAX, CRUISE_DECEL, CRUISE_SECONDS, THRUST_ACCEL, BOOST_MULT, FUEL_TANK, FUEL_HOVER_BURN, FUEL_CRUISE_BURN, FUEL_PAD_REFILL, FUEL_SOLAR_TRICKLE, FUEL_RELIGHT, GUN_RANGE, GUN_COOLDOWN, BOLT_SPEED, HULL_LIMIT, HOVER_MAX_SPEED, CRUISE_FLOOR, CRUISE_FLOOR_SPEED } from '../src/world/config.ts'
const GRAVITY = HOME.g, ATMOSPHERE_HEIGHT = HOME.air
const BODY_UP = new THREE.Vector3(0, 1, 0), BODY_FWD = new THREE.Vector3(0, 0, -1)

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
const T = (thrust, pitch = 0, roll = 0, yaw = 0, boost = 0, lateral = 0, vertical = 0, fore = 0) => ({ pitch, roll, yaw, thrust, boost, lateral, vertical, fore })

const site = padOf(HOME)
const pad = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
// Level spawn: thrust is then exactly radial, so a no-steer autopilot comes back
// down on the pad it left. The game spawns aligned to the slope, on purpose.
// Weather off: these are flight tests. Test 22 turns it on.
const fresh = () => { const c = new Craft(HOME); c.windy = false; c.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial'); return c }
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
// 3. It falls, and falling is fatal (with the landing assist off; the assist has its own tests, 27).
{
  c2.assist = false
  const t = until(c2, (c) => c.state !== 'flying', 60, () => IDLE)
  check('cutting thrust ends in a crash', c2.state === 'crashed' && c2.lastContact.vUp < -LAND_MAX_VSPEED, `after ${t.toFixed(1)} s at v↑ ${c2.lastContact.vUp.toFixed(1)} m/s`)
}
// 4. Drag caps the fall.
{
  const c = fresh(); c.assist = false
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
  const tOut = until(c, (c) => c.cruise, 90, () => T(1, 0, 0, 0, 1))
  check('boost straight up leaves the atmosphere', c.cruise && c.altitude() > ATMOSPHERE_HEIGHT * 0.9, `${tOut.toFixed(1)} s to ${c.altitude().toFixed(0)} m, ${c.speed().toFixed(0)} m/s`)
  // Keep the burn on in cruise until nothing brings you back.
  const tEsc = until(c, (c) => c.speed() > c.escapeSpeed(), 120, () => T(1, 0, 0, 0, 1))
  const v0 = c.speed(), vEsc = c.escapeSpeed()
  check('and keeps boosting past escape speed', v0 > vEsc, `${v0.toFixed(0)} m/s vs escape ${vEsc.toFixed(0)} at ${(c.altitude() / 1000).toFixed(1)} km, ${tEsc.toFixed(1)} s more`)
  // In cruise the assist steers the nose, and the nose is where the engine points.
  let aligned = 0
  const retro = new THREE.Vector3(), nose = new THREE.Vector3()
  const t = until(c, (c) => c.speed() < 10, 120, (t, c) => {
    retro.copy(c.vel).normalize().negate()
    nose.set(0, 0, -1).applyQuaternion(c.quat)
    const a = c.aimControls(retro)
    const ok = nose.dot(retro) > 0.98
    if (ok) aligned++
    return T(ok ? 1 : 0, a.pitch, a.roll, a.yaw, 1)
  })
  check('retro assist + boost kills escape velocity', c.speed() < 10, `${v0.toFixed(0)} → ${c.speed().toFixed(1)} m/s in ${t.toFixed(1)} s, aligned ${(aligned * FIXED_DT).toFixed(1)} s of it`)
  // 12. Nadir assist points the engine at the planet: the nose in cruise, the thrust axis in air.
  const nadir = new THREE.Vector3(), axis = new THREE.Vector3()
  until(c, () => false, 6, (t, c) => { nadir.copy(c.pos).normalize().negate(); const a = c.aimControls(nadir); return T(0, a.pitch, a.roll, a.yaw) })
  axis.copy(c.cruise ? BODY_FWD : BODY_UP).applyQuaternion(c.quat)
  check('nadir assist points the engine at the planet', axis.dot(nadir) > 0.95, `dot ${axis.dot(nadir).toFixed(3)}, ${c.cruise ? 'cruise' : 'air'}`)
}
// 13. RCS translates without tilting, and the top thruster brakes a climb.
{
  const c = fresh()
  until(c, () => false, 2, () => T(1))
  const tilt0 = c.tilt()
  until(c, () => false, 3, () => T(1, 0, 0, 0, 0, 1))
  const up = c.pos.clone().normalize(), vUp = c.vel.dot(up)
  const vH = Math.sqrt(Math.max(0, c.vel.lengthSq() - vUp * vUp))
  check('side thruster builds drift with no tilt', vH > 6 && Math.abs(c.tilt() - tilt0) < 1, `drift ${vH.toFixed(1)} m/s, tilt ${c.tilt().toFixed(1)}°`)
  const v1 = c.vUp()
  until(c, () => false, 2, () => T(0, 0, 0, 0, 0, 0, -1))
  check('top thruster brakes a climb harder than gravity alone', c.vUp() < v1 - 2 * GRAVITY - 4, `v↑ ${v1.toFixed(1)} → ${c.vUp().toFixed(1)} in 2 s`)
}
// 14. Cruise: out of the air the engine fires along the nose and speed follows the nose.
{
  const c = fresh()
  until(c, (c) => c.cruise, 40, () => T(1, 0, 0, 0, 1))
  check('leaving the atmosphere switches to cruise', c.cruise, `at ${c.altitude().toFixed(0)} m`)
  // Coast, then thrust: velocity should end up along the nose, not along the old radial.
  until(c, () => false, 1, () => IDLE)
  until(c, () => false, 6, () => T(1))
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat)
  const along = c.vel.clone().normalize().dot(nose)
  check('in cruise, thrust builds speed along the nose', along > 0.97, `cos ${along.toFixed(3)}, ${c.speed().toFixed(0)} m/s`)
  // Turn 60 degrees with the stick; the velocity should come round with the nose.
  until(c, () => false, 0.45, () => T(0, 0, 0, 1))
  until(c, () => false, 4, () => T(0))
  const nose2 = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat)
  const turned = Math.acos(Math.min(1, nose.dot(nose2))) * 180 / Math.PI
  const along2 = c.vel.clone().normalize().dot(nose2)
  check('turning carries the velocity with the nose', turned > 20 && along2 > 0.97, `turned ${turned.toFixed(0)}°, cos ${along2.toFixed(3)}`)
  // Boost for a long time: the cap holds, and out here the cap is big.
  until(c, () => false, 40, () => T(1, 0, 0, 0, 1))
  const cap = c.cruiseCap(c.altitude())
  check('the cruise speed cap holds under sustained boost', c.speed() < cap * 1.05 && c.speed() > CRUISE_MAX, `${c.speed().toFixed(0)} m/s vs cap ${cap.toFixed(0)} at ${(c.altitude() / 1000).toFixed(0)} km`)
  const v0 = c.speed()
  until(c, () => false, 5, () => T(0, 0, 0, 0, 0, 0, -1))
  check('/ brakes in cruise', c.speed() < v0 - 30, `${v0.toFixed(0)} → ${c.speed().toFixed(0)} m/s in 5 s`)
  // Aim the nose at something: T-style assist in cruise.
  const target = new THREE.Vector3(0.3, 0.9, -0.2).normalize()
  until(c, () => false, 6, (t, c) => { const a = c.aimControls(target); return T(0, a.pitch, a.roll, a.yaw) })
  const nose3 = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat)
  check('cruise aim points the nose at the target', nose3.dot(target) > 0.98, `cos ${nose3.dot(target).toFixed(3)}`)
}
// 15. Diving at the planet at cruise speed: the cap reels you in all the way down.
{
  const c = fresh()
  until(c, (c) => c.altitude() > 60_000, 120, () => T(1, 0, 0, 0, 1))
  const nadir = new THREE.Vector3(), nose = new THREE.Vector3()
  let worst = 0
  const top = c.altitude()
  until(c, (c) => c.state !== 'flying' || !c.cruise, 400, (t, c) => {
    nadir.copy(c.pos).normalize().negate()
    const a = c.aimControls(nadir)
    // Along the nose: that is what the cap clamps. Across it, the velocity left over from
    // the climb bleeds away in CRUISE_ALIGN_TAU while the assist swings the nose to nadir.
    nose.set(0, 0, -1).applyQuaternion(c.quat)
    worst = Math.max(worst, c.vel.dot(nose) / c.cap())
    return T(1, a.pitch, a.roll, a.yaw, 1)
  })
  check('diving at full boost never exceeds the cap along the nose, and hands you to hover gently at the floor', worst < 1.02 && c.state === 'flying' && !c.cruise && c.speed() < CRUISE_FLOOR_SPEED * 1.3 && Math.abs(c.altitude() - CRUISE_FLOOR) < 300, `from ${(top / 1000).toFixed(0)} km: worst ${(worst * 100).toFixed(0)}% of cap, hover at ${c.altitude().toFixed(0)} m doing ${c.speed().toFixed(0)} m/s`)
}

// 16. Stage C: the moon is a real place. Hang over it, fall, land, ride it, lift off with it.
{
  const moon = body('home-1')
  const c = new Craft(HOME); c.windy = false; c.time = 5000
  c.placeAbove(moon, new THREE.Vector3(0.2, 1, 0.3), 120)
  c.substep(FIXED_DT, IDLE)
  check('over the moon, the moon is the reference body', c.ref === moon && Math.abs(c.altitude() - 120) < 2, `${c.ref.name}, alt ${c.altitude().toFixed(1)} m`)
  const v0 = c.vUp(); until(c, () => false, 1, () => IDLE); const gM = -(c.vUp() - v0)
  check("gravity over the moon is the moon's", Math.abs(gM - moon.surfaceGravity) < 0.05, `${gM.toFixed(2)} m/s² vs ${moon.surfaceGravity}`)
  check('an airless body still gets hover mode near the ground', !c.cruise)
  const t = until(c, (c) => c.state !== 'flying', 120, (t, c) => T(c.vUp() < -2 ? 1 : 0))
  const lc = c.lastContact
  check('autopilot lands on the moon', c.state === 'landed' && c.landings === 1, `${t.toFixed(1)} s, v↑ ${lc.vUp.toFixed(2)}, drift ${lc.vH.toFixed(2)}, tilt ${lc.tilt.toFixed(1)}°, slope ${lc.slope.toFixed(1)}°`)
  const p0 = c.pos.clone()
  until(c, () => false, 30, () => IDLE)
  const vMoon = bodyVelocity(moon, c.time).length()
  check('landed, the craft rides the moon', c.pos.distanceTo(p0) < 1e-6 && Math.abs(c.hvel.length() - vMoon) < 3 && c.speed() < 1e-6, `moved ${c.pos.distanceTo(p0).toExponential(1)} m in its frame; heliocentric ${c.hvel.length().toFixed(0)} m/s vs the moon's ${vMoon.toFixed(0)}`)
  until(c, () => false, 2, () => T(1))
  const dv = c.hvel.clone().sub(bodyVelocity(moon, c.time)).length()
  const vExpect = 2 * (18 - moon.surfaceGravity)
  check('lifting off inherits the surface velocity', c.state === 'flying' && Math.abs(c.speed() - vExpect) < 3 && Math.abs(dv - c.speed()) < 1, `ground-relative ${c.speed().toFixed(1)} m/s (expect ~${vExpect.toFixed(0)}), relative to the moon ${dv.toFixed(1)} m/s`)
}
// 17. The reference body follows the sphere of influence.
{
  const c = new Craft(HOME); c.windy = false; c.time = 5000
  const dir = new THREE.Vector3(0, 0, 1)
  c.placeAbove(body('home'), dir, 4_000_000); c.substep(FIXED_DT, IDLE)
  const a = c.ref.name
  c.placeAbove(body('home'), dir, 20_000_000); c.substep(FIXED_DT, IDLE)
  const b = c.ref.name
  check('4,000 km up is still home; 20,000 km up is the sun', a === 'Vale' && b === 'Sol', `${a}, then ${b}`)
}

// 18. Supercruise: far from anything the cap is distance over CRUISE_SECONDS, thrust spools to it, a target ahead reels you in.
{
  const c = new Craft(HOME); c.windy = false; c.time = 5000
  c.placeAbove(body('home'), new THREE.Vector3(0, 0, 1), 5_000_000)
  const t = until(c, () => false, 20, () => T(1, 0, 0, 0, 1))
  const capFar = c.cap()
  check('5,000 km out, 20 s of boost reaches the far-field cap', c.cruise && c.speed() > capFar * 0.95 && c.speed() <= capFar * 1.01, `${(c.speed() / 1000).toFixed(0)} km/s vs cap ${(capFar / 1000).toFixed(0)} km/s (d/${CRUISE_SECONDS} s) after ${t.toFixed(0)} s`)
  c.arrive = 100_000
  until(c, () => false, 3, () => T(1, 0, 0, 0, 1))
  check('a target 100 km ahead caps the speed within 3 s', c.speed() <= c.bodyCap(100_000) * 1.01, `${(c.speed() / 1000).toFixed(1)} km/s vs ${(c.bodyCap(100_000) / 1000).toFixed(1)} km/s`)
}
// 19. The transfer: from 100 km over home, aim at the moon and boost. Pace is a design requirement.
{
  const moon = body('home-1')
  const c = new Craft(HOME); c.windy = false; c.time = 5000
  const toward = bodyPosition(moon, c.time).sub(bodyPosition(body('home'), c.time)).applyQuaternion(bodySpin(body('home'), c.time).invert()).normalize()
  c.placeAbove(body('home'), toward, 100_000)
  const q = new THREE.Quaternion(), tgt = new THREE.Vector3()
  const toMoon = (c) => { bodyPosition(moon, c.time, tgt).sub(bodyPosition(c.ref, c.time)).applyQuaternion(bodySpin(c.ref, c.time, q).invert()); return tgt.sub(c.pos) }
  let peak = 0
  const t = until(c, (c) => c.ref === moon && c.altitude() < 60_000, 600, (t, c) => {
    const d = toMoon(c); c.arrive = d.length() - moon.radius
    peak = Math.max(peak, c.speed())
    const a = c.aimControls(d.normalize())
    return T(1, a.pitch, a.roll, a.yaw, 1)
  })
  check('home to 60 km over the moon in under four minutes', c.ref === moon && t < 240, `${t.toFixed(0)} s, peak ${(peak / 1000).toFixed(0)} km/s, arrived doing ${(c.speed() / 1000).toFixed(1)} km/s at ${(c.altitude() / 1000).toFixed(0)} km`)
  const t2 = until(c, (c) => !c.cruise || c.state !== 'flying', 120, (t, c) => { const d = toMoon(c); c.arrive = d.length() - moon.radius; const a = c.aimControls(d.normalize()); return T(1, a.pitch, a.roll, a.yaw, 1) })
  check('and the cap hands it to hover at the moon gently, at the floor', c.state === 'flying' && !c.cruise && c.speed() < CRUISE_FLOOR_SPEED * 1.3 && c.ref === moon && Math.abs(c.altitude() - CRUISE_FLOOR) < 300, `${t2.toFixed(0)} s more, ${c.speed().toFixed(0)} m/s at ${c.altitude().toFixed(0)} m, ${c.cruise ? 'cruise' : 'hover'}`)
  // From hover at the floor a landing is routine: kill the fall, come down, touch.
  // Tilt against the drift, then hold a descent rate. A pilot's landing, in eight lines.
  const t3 = until(c, (c) => c.state !== 'flying', 240, (t, c) => {
    const up = c.pos.clone().normalize()
    const vH = c.vel.clone().addScaledVector(up, -c.vel.dot(up))
    const lean = Math.min(0.7, vH.length() * 0.02)
    const aim = vH.lengthSq() > 0 ? up.clone().addScaledVector(vH.clone().normalize(), -lean).normalize() : up
    const a = c.aimControls(aim)
    const want = c.altitude() > 100 ? -25 : -3
    return T(vH.length() > 4 || c.vUp() < want ? 1 : 0, a.pitch, a.roll, a.yaw)
  })
  check('and from there a plain descent lands on the moon', c.state === 'landed' && c.ref === moon, `${c.state} after ${t3.toFixed(0)} s at v↑ ${c.lastContact.vUp.toFixed(1)}`)
}

// 20. The sea is ground: put down on deep water and you float, level, at sea level.
{
  let sea = null
  for (let k = 0; k < 4000 && !sea; k++) { // golden spiral over the sphere until deep water
    const y = 1 - 2 * (k + 0.5) / 4000, r = Math.sqrt(1 - y * y), a = k * 2.399963
    const d = new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))
    if (height(d, HOME) < HOME.sea - 40) sea = d
  }
  check('home has deep water somewhere', sea !== null)
  if (sea) {
    const c = new Craft(HOME); c.windy = false; c.time = 5000
    c.placeAbove(body('home'), sea, 60)
    const t = until(c, (c) => c.state !== 'flying', 120, (t, c) => T(c.vUp() < -2 ? 1 : 0))
    const lc = c.lastContact
    const surface = groundRadius(sea, HOME) - HOME.radius // sea level plus the tide at the craft's clock
    check('autopilot puts down on the sea and floats on the tide', c.state === 'landed' && Math.abs(c.pos.length() - (HOME.radius + surface + 1.6)) < 0.01 && lc.slope < 0.5 && surface !== HOME.sea, `${t.toFixed(1)} s, floating at ${(c.pos.length() - HOME.radius - 1.6).toFixed(2)} m above datum, the tide there ${(surface - HOME.sea).toFixed(2)} m, ${(surface - height(sea, HOME)).toFixed(0)} m of water under it`)
  }
}

// 21. The orbit autopilot: from 150 km over the moon, park in a circular orbit and stay there.
for (const [id, start] of [['home-1', 150_000], ['home', 400_000]]) {
  const b = body(id)
  const c = new Craft(HOME); c.windy = false; c.time = 5000
  c.placeAbove(b, new THREE.Vector3(0.3, 0.5, 0.8), start)
  const ap = new OrbitAutopilot()
  const rPark = ap.parkRadius(c), vCirc = ap.parkSpeed(c)
  const radial = () => c.vel.dot(c.pos.clone().normalize())
  const t = until(c, (c) => ap.phase === 'orbit', 500, () => ap.controls(c))
  const alt = c.pos.length() - rPark
  check(`autopilot parks over ${b.name} from ${start / 1000} km`, ap.phase === 'orbit' && Math.abs(alt) < 0.1 * (rPark - b.radius) && Math.abs(c.speed() - vCirc) < 0.05 * vCirc && Math.abs(radial()) < 5, `${t.toFixed(0)} s: ${(alt / 1000).toFixed(1)} km off the park radius, ${c.speed().toFixed(0)} m/s vs circular ${vCirc.toFixed(0)}, radial ${radial().toFixed(1)} m/s, ${ap.phase}`)
  const r0 = c.pos.length(), T = 2 * Math.PI * rPark / vCirc
  let worst = 0, flips = 0, wasOn = c.thrusting
  until(c, () => false, Math.min(600, T), (t, c) => { worst = Math.max(worst, Math.abs(c.pos.length() - r0)); if (c.thrusting !== wasOn) { flips++; wasOn = c.thrusting } return ap.controls(c) })
  check(`and holds the orbit for ${Math.min(600, T).toFixed(0)} s (${(T / 60).toFixed(0)} min period)`, worst < 0.05 * (rPark - b.radius) && c.state === 'flying', `radius wandered ${(worst / 1000).toFixed(2)} km, now ${c.speed().toFixed(0)} m/s at ${(c.altitude() / 1000).toFixed(1)} km`)
  check('without the throttle flickering', flips < 40, `${flips} thrust on/off flips in ${Math.min(600, T).toFixed(0)} s`)
}

// 22. Weather: a hovering craft is pushed by the wind, along the wind, and not without it.
{
  // The windiest spot on home at t = 5000, from a spiral of samples.
  let best = { s: 0, d: null }
  const w = new THREE.Vector3()
  for (let k = 0; k < 3000; k++) {
    const y = 1 - 2 * (k + 0.5) / 3000, r = Math.sqrt(1 - y * y), a = k * 2.399963
    const d = new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))
    if (height(d, HOME) < HOME.sea + 3) continue
    wind(d, HOME, 5000, w)
    if (w.length() > best.s) best = { s: w.length(), d }
  }
  check('somewhere on home it is blowing a gale', best.s > 20, `${best.s.toFixed(1)} m/s`)
  const run = (windy) => {
    const c = new Craft(HOME); c.windy = windy; c.time = 5000; c.assist = false
    c.placeAbove(body('home'), best.d, 40)
    until(c, () => false, 3, () => IDLE)
    const vUp = c.vUp(), drift = new THREE.Vector3().copy(c.vel).addScaledVector(c.pos.clone().normalize(), -vUp)
    return { c, drift }
  }
  const calm = run(false), gale = run(true)
  const along = gale.drift.clone().normalize().dot(gale.c.wind.clone().normalize())
  check('the wind pushes a falling craft downwind', gale.drift.length() > 1 && along > 0.9 && calm.drift.length() < 0.05, `drift ${gale.drift.length().toFixed(2)} m/s in 3 s (calm: ${calm.drift.length().toFixed(2)}), cos to wind ${along.toFixed(2)}, wind ${gale.c.wind.length().toFixed(1)} m/s`)
}


const near = (a, b, tol) => Math.abs(a - b) <= tol
// 23. Fuel: the tank is the first number that gates reach (DESIGN §10b). Burn, dry, refill, trickle, cruise, boost.
{
  // Sitting on the pad costs nothing.
  const c = fresh()
  until(c, () => false, 5, () => IDLE)
  check('a full tank on the pad stays full', c.fuel === FUEL_TANK && c.burn === 0, `${c.fuel.toFixed(2)} / ${FUEL_TANK}`)
  // Ten seconds of full thrust costs FUEL_HOVER_BURN a second.
  until(c, () => false, 10, () => T(1))
  check('ten seconds of full hover thrust burns the hover rate', near(c.fuel, FUEL_TANK - 10 * FUEL_HOVER_BURN, 0.02), `${c.fuel.toFixed(2)} left, burn ${c.burn.toFixed(3)}/s, endurance ${c.endurance().toFixed(0)} s`)
  // Boost multiplies burn the way it multiplies thrust.
  const f0 = c.fuel
  until(c, () => false, 2, () => T(1, 0, 0, 0, 1))
  check('boost burns BOOST_MULT times as fast', near(f0 - c.fuel, 2 * FUEL_HOVER_BURN * BOOST_MULT, 0.02), `${(f0 - c.fuel).toFixed(2)} in 2 s`)
  // A full tank hovers at home for over ten minutes: a design number, not a physics one.
  const hoverMinutes = FUEL_TANK / (FUEL_HOVER_BURN * HOME.g / THRUST_ACCEL) / 60
  check('a full tank hovers at home for over ten minutes', hoverMinutes > 10, `${hoverMinutes.toFixed(1)} min`)
  // Dry on the ground: the engine will not light until the sun has put FUEL_RELIGHT back.
  const awayDir = pad.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.03).normalize()
  const d = new Craft(HOME); d.windy = false
  d.spawnOn(awayDir, new THREE.Vector3(1, 0, 0), 'radial'); d.fuel = 0
  until(d, () => false, 3, () => T(1))
  check('a dry tank off the pad does not lift off', d.state === 'landed' && !d.thrusting && d.fuel > 0, `state ${d.state}, ${d.fuel.toFixed(2)} units after 3 s of holding the throttle`)
  const tLight = until(d, (c) => c.state === 'flying', 60, () => T(1))
  check('and lights again once the sun has put a relight in', d.state === 'flying' && near(3 + tLight, FUEL_RELIGHT / FUEL_SOLAR_TRICKLE, 0.1), `lit after ${(3 + tLight).toFixed(1)} s`)
  const dp = fresh(); dp.fuel = 0
  const tPad = until(dp, (c) => c.state === 'flying', 10, () => T(1))
  check('a dry tank on the pad is flying again within a second', dp.state === 'flying' && tPad < 1, `lit after ${tPad.toFixed(2)} s`)
  // Run dry in the air and the engine dies with the tank; hold the throttle and you still crash.
  const e = fresh(); e.fuel = 1.0
  until(e, () => false, 3, () => T(1))
  const tDry = until(e, (c) => c.fuel <= 0, 30, () => T(1))
  const tEnd = until(e, (c) => c.state !== 'flying', 90, () => T(1))
  check('the engine dies with the tank and the throttle cannot save you', e.fuel === 0 && !e.thrusting && e.state === 'crashed', `dry after ${(3 + tDry).toFixed(1)} s, ${e.state} ${tEnd.toFixed(1)} s later at v↑ ${e.lastContact.vUp.toFixed(1)}`)
  // Landed on the pad, the tank refills fast.
  const p = fresh(); p.fuel = 10
  until(p, () => false, 5, () => IDLE)
  check('the pad refuels', p.onPad() && near(p.fuel, 10 + 5 * (FUEL_PAD_REFILL + FUEL_SOLAR_TRICKLE), 0.05), `${p.fuel.toFixed(1)} after 5 s, pad and sun`)
  until(p, () => false, 30, () => IDLE)
  check('and never past the brim', p.fuel === FUEL_TANK, `${p.fuel}`)
  // Landed off the pad, the solar cells trickle.
  const off = new Craft(HOME); off.windy = false
  const away = pad.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.03).normalize()
  off.spawnOn(away, new THREE.Vector3(1, 0, 0), 'radial'); off.fuel = 0
  until(off, () => false, 10, () => IDLE)
  check('off the pad the ground trickles from sunlight, slowly', !off.onPad() && near(off.fuel, 10 * FUEL_SOLAR_TRICKLE, 0.05) && FUEL_SOLAR_TRICKLE < FUEL_PAD_REFILL / 10, `${off.fuel.toFixed(2)} after 10 s, ${((away.angleTo(pad)) * HOME.radius / 1000).toFixed(1)} km from the pad`)
  // Cruise burns its own rate while thrusting and nothing while coasting.
  const k = new Craft(HOME); k.windy = false
  k.placeAbove(body('home'), pad, 12000)
  until(k, (c) => c.cruise, 2, () => IDLE)
  const k0 = k.fuel
  until(k, () => false, 5, () => T(1))
  const burnt = k0 - k.fuel
  const k1 = k.fuel
  until(k, () => false, 5, () => IDLE)
  check('cruise burns the cruise rate under thrust and nothing coasting', k.cruise && near(burnt, 5 * FUEL_CRUISE_BURN, 0.02) && k.fuel === k1, `${burnt.toFixed(2)} in 5 s of thrust, ${(k1 - k.fuel).toFixed(3)} in 5 s of coasting`)
  // The moon trip from test 19 costs a fraction of the tank: reach is fuel, and home to the moon is the first rung.
  check('home to the moon at full boost costs under half a tank', 40 * FUEL_CRUISE_BURN * BOOST_MULT < FUEL_TANK / 2, `${(40 * FUEL_CRUISE_BURN * BOOST_MULT).toFixed(0)} units for 40 s at full boost`)
}


// 24. Asteroids: a rock caps cruise like a surface, flying into one is a crash, the gun breaks them, ice refuels you.
{
  resetRocks()
  const l4 = FIELDS.find((f) => f.id === 'home-l4')
  const ice = l4.rocks.find((r) => r.ice && r.radius > 30), stone = l4.rocks.find((r) => !r.ice)
  /** A craft in cruise `gap` metres from rock r's surface, nose on it, at rest relative to the field. */
  const beside = (r, gap) => {
    const c = new Craft(HOME); c.windy = false
    c.time = 5000
    c.placeNearRock(r, gap)
    c.substep(FIXED_DT, IDLE)
    return c
  }
  const c = beside(ice, 2000)
  const nearCap = c.cruiseCap(2000)
  check('a rock 2 km off the nose caps cruise like a surface would', c.rockNear.rock === ice && Math.abs(c.proximity - 2000) < 2 && Math.abs(c.cap() - nearCap) < 1, `proximity ${c.proximity.toFixed(0)} m, cap ${c.cap().toFixed(0)} m/s`)
  check('inside a field the field is the frame: at rest with the rocks reads as at rest', c.speed() < 0.5 && c.ref.kind === 'sun', `spd ${c.speed().toFixed(2)} m/s in ${c.ref.name}'s sphere`)
  until(c, () => false, 5, () => IDLE)
  check('and five seconds later the rock is still 2 km off the nose', Math.abs(c.rockNear.dist - 2000) < 2, `${c.rockNear.dist.toFixed(1)} m`)
  // The gun: a bolt flies, and takes a hit off the rock when it arrives; enough break it; the fuel arrives.
  const f0 = c.fuel = 20
  const hp0 = ice.hp
  const bolt = c.fire()
  check('firing launches a bolt from the wing at BOLT_SPEED along the nose', bolt && bolt.alive && Math.abs(bolt.vel.clone().sub(c.hvel).length() - BOLT_SPEED) < 1e-6, `${bolt ? bolt.vel.clone().sub(c.hvel).length().toFixed(0) : '-'} m/s`)
  check('the gun has a cooldown', c.fire() === null)
  const tFly = until(c, (c) => c.hits.length > 0, 10, () => IDLE)
  const first = c.hits[0]
  check('the bolt hits the rock about when it should, and the rock loses a hit', first && first.hit.rock === ice && ice.hp === hp0 - 1 && Math.abs(tFly - 2000 / BOLT_SPEED) < 0.1 && !bolt.alive, `hit after ${tFly.toFixed(2)} s (expected ${(2000 / BOLT_SPEED).toFixed(2)}), hp ${hp0} → ${ice.hp}`)
  c.hits.length = 0
  let shots = 1, broke = first.broke, gained = first.fuel
  while (!broke && shots < 20) {
    until(c, () => false, GUN_COOLDOWN + 0.01, () => IDLE)
    c.fire(); shots++
    until(c, (c) => c.hits.length > 0, 10, () => IDLE)
    for (const e of c.hits) { broke ||= e.broke; gained += e.fuel }
    c.hits.length = 0
  }
  check('enough bolts break an ice rock and the fuel comes to the tank', broke && ice.hp === 0 && gained > 0 && Math.abs(c.fuel - f0 - gained) < 1e-9, `${shots} shots, +${gained.toFixed(1)} units, tank ${c.fuel.toFixed(1)}`)
  c.substep(FIXED_DT, IDLE)
  check('a broken rock is gone from the sky', c.rockNear.rock !== ice, `nearest now ${c.rockNear.rock ? (c.rockNear.dist / 1000).toFixed(1) + ' km' : 'nothing'}`)
  // A bolt that misses dies at range.
  {
    const m = beside(stone, 1000)
    m.hquat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) // nose off to the side
    const b = m.fire()
    const tDie = until(m, () => !b.alive, 10, () => IDLE)
    check('a bolt that misses dies at GUN_RANGE', !b.alive && m.hits.length === 0 && Math.abs(tDie - GUN_RANGE / BOLT_SPEED) < 0.05, `after ${tDie.toFixed(2)} s`)
  }
  // Stone gives nothing.
  const d = beside(stone, 1000)
  d.fuel = 20
  let b = false, got = 0
  for (let i = 0; i < 20 && !b; i++) {
    d.fire()
    until(d, (c) => c.hits.length > 0, 10, () => IDLE)
    for (const e of d.hits) { b ||= e.broke; got += e.fuel }
    d.hits.length = 0
    until(d, () => false, GUN_COOLDOWN + 0.01, () => IDLE)
  }
  check('breaking stone gives no fuel', b && got === 0 && d.fuel === 20)
  // Flying into a rock is a crash.
  const e = beside(l4.rocks.find((r) => r.hp > 0 && r.radius > 50), 600)
  until(e, (c) => c.state !== 'flying', 30, () => T(1))
  check('flying into a rock is a crash', e.state === 'crashed' && e.hitRock !== null && e.lastContact.vUp < -LAND_MAX_VSPEED, `${e.state} at ${(-e.lastContact.vUp).toFixed(0)} m/s`)
  resetRocks()
}


// 25. The station: land on a numbered pad and you are docked and refuelling; on the disc but off a pad, only the sun.
{
  const st = stationOf(HOME)
  const onPad = (n) => { const c = new Craft(HOME); c.windy = false; c.spawnOn(new THREE.Vector3(st.pads[n - 1].dir.x, st.pads[n - 1].dir.y, st.pads[n - 1].dir.z), new THREE.Vector3(1, 0, 0), 'radial'); return c }
  const c = onPad(3); c.fuel = 10
  until(c, () => false, 5, () => IDLE)
  const here = c.padHere()
  check('landed on station pad 3 reads as docked on pad 3', here && here.station === st && here.pad === 3, here ? `${here.station?.name} pad ${here.pad}` : 'no pad')
  check('and the pad refuels', near(c.fuel, 10 + 5 * (FUEL_PAD_REFILL + FUEL_SOLAR_TRICKLE), 0.05), `${c.fuel.toFixed(1)} after 5 s, pad and sun`)
  // Lift off pad 3 and set down on pad 1: 124 m across the disc.
  const d = new Craft(HOME); d.windy = false
  d.spawnOn(new THREE.Vector3(st.site.dir.x, st.site.dir.y, st.site.dir.z), new THREE.Vector3(1, 0, 0), 'radial'); d.fuel = 0
  until(d, () => false, 5, () => IDLE)
  check('on the disc but off a pad you are down, not docked, and only the sun feeds you', d.state === 'landed' && d.padHere() === null && near(d.fuel, 5 * FUEL_SOLAR_TRICKLE, 0.05), `${d.fuel.toFixed(2)} after 5 s`)
  // The station is level ground to land on: hover up off pad 2, drift, and set down again gently.
  const e = onPad(2)
  until(e, (c) => c.altitude() > 6, 10, () => T(1))
  const tDown = until(e, (c) => c.state !== 'flying', 60, (t, c) => T(c.vUp() > -1.5 ? 0 : 1))
  check('a hop off a station pad comes down landed on the disc', e.state === 'landed' && e.lastContact.vUp > -LAND_MAX_VSPEED, `${e.state} after ${tDown.toFixed(1)} s at v↑ ${e.lastContact.vUp.toFixed(1)}`)
}


// 26. Re-entry: the hull model's shape, a cold hull in ordinary flight, a braked entry that lives, a dive that does not, hover's speed gate, repair when docked.
{
  // Shape: Sutton-Graves, √ρ·v³, with XRVessels' thick-air ramp.
  const t1 = Craft.heatTarget(0.04, 500), t2 = Craft.heatTarget(0.16, 500), t8 = Craft.heatTarget(0.04, 1000)
  check('heat goes as the square root of density', Math.abs(t2 / t1 - 2 * (1 - 0.905 * (0.16 - 0.07) / 0.83)) < 0.02, `×${(t2 / t1).toFixed(2)} for 4× the air`)
  check('and as the cube of speed', Math.abs(t8 / t1 - 8) < 1e-9, `×${(t8 / t1).toFixed(2)} for 2× the speed`)
  check('fast flight in thick air warms the hull without cooking it', Craft.heatTarget(1, 300) < 0.15 * HULL_LIMIT, `${(100 * Craft.heatTarget(1, 300) / HULL_LIMIT).toFixed(0)}% at 300 m/s on the deck`)
  // Ordinary flight is cold.
  const c = fresh()
  until(c, () => false, 30, (t) => T(t < 4 ? 1 : 0.55, t < 4 ? 0 : 0.3))
  check('a hover dash near the ground leaves the hull cold', c.hull < 0.05 * HULL_LIMIT, `${(100 * c.hull / HULL_LIMIT).toFixed(1)}% at ${c.speed().toFixed(0)} m/s`)
  // Home's air (2 km) lies under the hover floor (2.5 km), so coming home is benign. Marram's air is 4 km deep:
  // the last 1.5 km of cruise is in air, and that is where re-entry lives (the heat shield is the gate to Venus, §10b).
  const marram = body('terra-a'), mPad = padOf(terrainOf(marram)), mDir = new THREE.Vector3(mPad.dir.x, mPad.dir.y, mPad.dir.z)
  const dv = new Craft(HOME); dv.windy = false
  dv.placeAbove(marram, mDir, 60_000)
  until(dv, (c) => c.cruise, 2, () => IDLE)
  const nadir0 = new THREE.Vector3()
  until(dv, (c) => c.state !== 'flying' || !c.cruise, 300, (t, c) => { nadir0.copy(c.pos).normalize().negate(); const a = c.aimControls(nadir0); return T(1, a.pitch, a.roll, a.yaw, 1) })
  check("a full-boost dive into Marram's air burns the hull through before the floor", dv.state === 'crashed' && dv.burned, `${dv.burned ? 'burned' : dv.state} at ${dv.altitude().toFixed(0)} m doing ${(-dv.lastContact.vUp).toFixed(0)} m/s`)
  // A braked entry: from rest at 60 km (where the autopilot would leave you), nose at nadir, 300 m/s through the air, then the floor. Lives, with a warm hull.
  const e = new Craft(HOME); e.windy = false
  e.placeAbove(marram, mDir, 60_000)
  until(e, (c) => c.cruise, 2, () => IDLE)
  const nadir = new THREE.Vector3()
  let peak = 0, handedAt = -1, everCruiseInAir = false
  until(e, (c) => c.state !== 'flying' || !c.cruise, 400, (t, c) => {
    nadir.copy(c.pos).normalize().negate()
    const a = c.aimControls(nadir)
    peak = Math.max(peak, c.hull)
    if (c.atmosphere() > 0) everCruiseInAir = true
    // Fly down at a held speed: thrust under it, brake over it. 300 m/s through the upper air, then let the cap hand over at the floor.
    const want = 300
    return T(c.speed() < want - 30 ? 1 : 0, a.pitch, a.roll, a.yaw, 0, 0, c.speed() > want ? -1 : 0)
  })
  handedAt = e.speed()
  check('a braked entry into Marram comes through to hover with a warm hull and no damage', e.state === 'flying' && !e.cruise && e.damage === 0 && peak > 0.1 * HULL_LIMIT && peak < HULL_LIMIT && everCruiseInAir, `peak hull ${(100 * peak / HULL_LIMIT).toFixed(0)}%, hover at ${handedAt.toFixed(0)} m/s, ${e.altitude().toFixed(0)} m`)
  check('hover only engages under HOVER_MAX_SPEED', handedAt < HOVER_MAX_SPEED, `${handedAt.toFixed(0)} m/s`)
  until(e, () => false, 20, () => IDLE)
  check('and the hull cools once the speed is off, slowly', e.hull < peak * 0.8, `${(100 * e.hull / HULL_LIMIT).toFixed(0)}% twenty seconds later, from ${(100 * peak / HULL_LIMIT).toFixed(0)}%`)
  // Repair: docked at a station, damage comes off.
  const st = stationOf(HOME)
  const r = new Craft(HOME); r.windy = false
  r.spawnOn(new THREE.Vector3(st.pads[0].dir.x, st.pads[0].dir.y, st.pads[0].dir.z), new THREE.Vector3(1, 0, 0), 'radial'); r.damage = 0.5
  until(r, () => false, 6, () => IDLE)
  check('docked at a station the hull is repaired', r.damage < 0.25 && r.damage >= 0, `damage ${r.damage.toFixed(2)} after 6 s`)
  const o = fresh(); o.damage = 0.5
  until(o, () => false, 6, () => IDLE)
  check('on the outpost pad it is not', o.damage === 0.5)
}


// 27. The landing assist: cut the throttle and it lands; dive and it saves you; a respawn takes off clean.
{
  const a = fresh()
  until(a, (c) => c.altitude() > 300, 60, () => T(1))
  const tA = until(a, (c) => c.state !== 'flying', 120, () => IDLE)
  check('hands off at 300 m, the assist lands the ship', a.state === 'landed' && a.lastContact.vUp > -LAND_MAX_VSPEED, `${a.state} after ${tA.toFixed(0)} s at v↑ ${a.lastContact.vUp.toFixed(1)}, drift ${a.lastContact.vH.toFixed(1)}`)
  const d = new Craft(HOME); d.windy = false
  d.placeAbove(body('home'), pad, 1500)
  until(d, () => false, 4, () => T(1, 1))
  const vDive = -d.vUp()
  const tD = until(d, (c) => c.state !== 'flying', 120, () => IDLE)
  check('a head-first dive with hands off ends landed, not crashed', d.state === 'landed', `dived at ${vDive.toFixed(0)} m/s down, ${d.state} after ${tD.toFixed(0)} s at v↑ ${d.lastContact.vUp.toFixed(1)}`)
  const e = new Craft(HOME); e.windy = false
  e.placeAbove(body('home'), pad, 400)
  const tE = until(e, (c) => c.state !== 'flying', 120, () => T(0, 1))
  check('holding full pitch into the ground, the floor still catches you', e.state === 'landed', `${e.state} after ${tE.toFixed(0)} s at v↑ ${e.lastContact.vUp.toFixed(1)}, tilt ${e.lastContact.tilt.toFixed(0)}°`)
  const f = new Craft(HOME); f.windy = false; f.assist = false
  f.placeAbove(body('home'), pad, 1500)
  until(f, () => false, 4, () => T(1, 1))
  until(f, (c) => c.state !== 'flying', 120, () => IDLE)
  check('and without the assist that dive is a crash', f.state === 'crashed')
  const g = fresh(); g.assist = false
  until(g, (c) => c.altitude() > 60, 30, () => T(1))
  until(g, (c) => c.state !== 'flying', 60, () => IDLE)
  check('the set-up crash happened', g.state === 'crashed')
  g.assist = true
  g.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'surface')
  until(g, () => false, 3, () => T(1))
  check('after a crash and respawn, three seconds of thrust lifts it straight', g.state === 'flying' && g.altitude() > 15 && g.tilt() < 6, `alt ${g.altitude().toFixed(1)} m, tilt ${g.tilt().toFixed(1)}°`)
}

// 27b. The dive: / from 2 km gets you down fast, and the assist still lands it.
{
  const d = new Craft(HOME); d.windy = false
  d.placeAbove(body('home'), pad, 2000)
  until(d, () => false, 8, () => ({ ...IDLE, vertical: -1 }))
  const vDive = -d.vUp()
  check('holding / from 2 km reaches a proper dive inside 8 s', vDive > 60, `${vDive.toFixed(0)} m/s down at ${d.altitude().toFixed(0)} m`)
  const tD = until(d, (c) => c.state !== 'flying', 120, () => ({ ...IDLE, vertical: -1 }))
  check('and held all the way down the assist still lands it', d.state === 'landed', `${d.state} after ${(8 + tD).toFixed(0)} s at v↑ ${d.lastContact.vUp.toFixed(1)}`)
}

// 28. Crashes (DESIGN §10): contact damage from speed, a hard landing short of a whole hull,
// a wreck at one, debris that comes to rest on the ground near the site, water that sinks.
{
  const D = Craft.contactDamage
  check('inside the limits there is no contact damage', D(-3.9, 2.9, 14, 14) === 0)
  check('a breach of tilt alone costs the minimum', D(-1, 0, 16, 0) === 0.1 && D(-1, 0, 0, 16) === 0.1)
  check('damage grows with the square of the speed over the limit', D(-6, 0, 0, 0) > 0.3 && D(-6, 0, 0, 0) < 0.32 && D(-8, 0, 0, 0) === 0.75 && D(-9, 0, 0, 0) === 1, `6 m/s ${D(-6, 0, 0, 0).toFixed(2)}, 8 m/s ${D(-8, 0, 0, 0).toFixed(2)}, 9 m/s ${D(-9, 0, 0, 0).toFixed(2)}`)
  check('drift counts the same way against its own limit', D(0, 5, 0, 0) > 0.43 && D(0, 5, 0, 0) < 0.45, `5 m/s drift ${D(0, 5, 0, 0).toFixed(2)}`)
  // A short drop with the assist off: a hard landing, gear bent, still a ship.
  const h = new Craft(HOME); h.windy = false; h.assist = false
  h.placeAbove(body('home'), pad, 3.5)
  until(h, (c) => c.state !== 'flying', 10, () => IDLE)
  check('a 3.5 m drop is a hard landing, not a wreck', h.state === 'landed' && h.gearBent && h.damage > 0.15 && h.damage < 0.5, `${h.state} at v↑ ${h.lastContact.vUp.toFixed(1)}, damage ${h.damage.toFixed(2)}, gear ${h.gearBent ? 'bent' : 'fine'}`)
  until(h, () => false, 3, () => T(1))
  check('a bent gear still flies', h.state === 'flying' && h.altitude() > 10, `alt ${h.altitude().toFixed(1)} m`)
  // Two hard landings in a row add up.
  const h2 = new Craft(HOME); h2.windy = false; h2.assist = false
  h2.placeAbove(body('home'), pad, 3.5); until(h2, (c) => c.state !== 'flying', 10, () => IDLE)
  const d1 = h2.damage
  h2.placeAbove(body('home'), pad, 3.5); h2.damage = d1; until(h2, (c) => c.state !== 'flying', 10, () => IDLE)
  check('a second hard landing adds to the first', h2.damage > d1 * 1.8 && h2.state === 'landed', `${d1.toFixed(2)} then ${h2.damage.toFixed(2)}`)
  // A 6 m drop is a wreck, on dry ground, and the debris comes to rest near the site.
  const w = new Craft(HOME); w.windy = false; w.assist = false
  w.placeAbove(body('home'), pad, 12)
  until(w, (c) => c.state !== 'flying', 10, () => IDLE)
  check('a 12 m drop is a wreck', w.state === 'crashed' && w.damage === 1 && !w.sunk, `${w.state} at v↑ ${w.lastContact.vUp.toFixed(1)}, damage ${w.damage.toFixed(2)}`)
  const wreck = new Wreck(HOME, w.pos, w.quat, w.contactVel, 7)
  check('the wreck is six facets', wreck.pieces.length === 6)
  let tW = 0; while (tW < 20 && !wreck.settled()) { wreck.step(FIXED_DT); tW += FIXED_DT }
  const far = Math.max(...wreck.pieces.map((p) => p.pos.distanceTo(w.pos)))
  const buried = wreck.pieces.some((p) => p.pos.length() < groundRadius(p.pos.clone().normalize(), HOME) - 0.5)
  const flew = wreck.pieces.every((p) => p.pos.distanceTo(w.pos) > 1)
  check('every piece comes to rest inside 20 s', wreck.settled(), `${tW.toFixed(1)} s`)
  check('the pieces scatter but stay near the site', flew && far < 40, `furthest ${far.toFixed(1)} m`)
  check('no piece ends up under the ground', !buried)
  // Water: find the sea, a hard contact sinks, a gentle one floats.
  let sea = null
  { const r = rng(11); for (let k = 0; k < 4000 && !sea; k++) { const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(); if (height(d, HOME) < HOME.sea - 30) sea = d } }
  check('home has a sea to fall into', sea !== null && !isDry(sea, HOME))
  const s1 = new Craft(HOME); s1.windy = false; s1.assist = false
  s1.placeAbove(body('home'), sea, 12)
  until(s1, (c) => c.state !== 'flying', 10, () => IDLE)
  check('a hard contact with water is a wreck that sinks', s1.state === 'crashed' && s1.sunk, `${s1.state}${s1.sunk ? ', sunk' : ''} at v↑ ${s1.lastContact.vUp.toFixed(1)}`)
  const s2 = new Craft(HOME); s2.windy = false
  s2.placeAbove(body('home'), sea, 60)
  until(s2, (c) => c.state !== 'flying', 120, () => IDLE)
  check('a gentle touchdown on water floats', s2.state === 'landed' && !s2.sunk && s2.damage === 0, `${s2.state} at v↑ ${s2.lastContact.vUp.toFixed(1)}`)
  // A hull already scarred by heat wrecks on a landing a fresh one survives.
  const sc = new Craft(HOME); sc.windy = false; sc.assist = false; sc.damage = 0.85
  sc.placeAbove(body('home'), pad, 3.5)
  until(sc, (c) => c.state !== 'flying', 10, () => IDLE)
  check('a heat-scarred hull wrecks on a 3.5 m drop', sc.state === 'crashed' && sc.damage === 1, `${sc.state}, damage ${sc.damage.toFixed(2)}`)
  const rs = fresh()
  check('a respawn straightens the gear and clears the damage', !rs.gearBent && rs.damage === 0 && !rs.sunk)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
