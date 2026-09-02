#!/usr/bin/env node
// Flight instrument. Drives the physics directly, no browser: Craft has no DOM
// dependency by design. It cannot tell you the handling is fun. It will tell
// you the moment it stops being a flight model.
import * as THREE from 'three'
import { Craft, IDLE } from '../src/engine/Craft.ts'
import { OrbitAutopilot } from '../src/engine/Autopilot.ts'
import { findLandable, groundRadius } from '../src/world/terrain.ts'
import { HOME, height } from '../src/world/height.ts'
import { body, bodyVelocity, bodyPosition, bodySpin } from '../src/world/system.ts'
import { FIXED_DT, DRAG, LAND_MAX_VSPEED, GROUND_EFFECT_HEIGHT, CRUISE_MAX, CRUISE_DECEL, CRUISE_SECONDS } from '../src/world/config.ts'
const GRAVITY = HOME.g, ATMOSPHERE_HEIGHT = HOME.air
const BODY_UP = new THREE.Vector3(0, 1, 0), BODY_FWD = new THREE.Vector3(0, 0, -1)

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
const T = (thrust, pitch = 0, roll = 0, yaw = 0, boost = 0, lateral = 0, vertical = 0, fore = 0) => ({ pitch, roll, yaw, thrust, boost, lateral, vertical, fore })

const pad = findLandable(new THREE.Vector3(0, 0, 1), HOME)
// Level spawn: thrust is then exactly radial, so a no-steer autopilot comes back
// down on the pad it left. The game spawns aligned to the slope, on purpose.
const fresh = () => { const c = new Craft(HOME); c.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'radial'); return c }
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
    worst = Math.max(worst, c.vel.dot(nose) / c.cruiseCap(c.altitude()))
    return T(1, a.pitch, a.roll, a.yaw, 1)
  })
  check('diving at full boost never exceeds the cap along the nose', worst < 1.02 && !c.cruise && c.state === 'flying', `from ${(top / 1000).toFixed(0)} km: worst ${(worst * 100).toFixed(0)}% of cap, handed back to hover at ${c.altitude().toFixed(0)} m doing ${c.speed().toFixed(0)} m/s`)
}

// 16. Stage C: the moon is a real place. Hang over it, fall, land, ride it, lift off with it.
{
  const moon = body('home-1')
  const c = new Craft(HOME); c.time = 5000
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
  const c = new Craft(HOME); c.time = 5000
  const dir = new THREE.Vector3(0, 0, 1)
  c.placeAbove(body('home'), dir, 4_000_000); c.substep(FIXED_DT, IDLE)
  const a = c.ref.name
  c.placeAbove(body('home'), dir, 20_000_000); c.substep(FIXED_DT, IDLE)
  const b = c.ref.name
  check('4,000 km up is still home; 20,000 km up is the sun', a === 'Vale' && b === 'Sol', `${a}, then ${b}`)
}

// 18. Supercruise: far from anything the cap is distance over CRUISE_SECONDS, thrust spools to it, a target ahead reels you in.
{
  const c = new Craft(HOME); c.time = 5000
  c.placeAbove(body('home'), new THREE.Vector3(0, 0, 1), 5_000_000)
  const t = until(c, () => false, 20, () => T(1, 0, 0, 0, 1))
  const capFar = c.cruiseCap(c.proximity)
  check('5,000 km out, 20 s of boost reaches the far-field cap', c.cruise && c.speed() > capFar * 0.95 && c.speed() <= capFar * 1.01, `${(c.speed() / 1000).toFixed(0)} km/s vs cap ${(capFar / 1000).toFixed(0)} km/s (d/${CRUISE_SECONDS} s) after ${t.toFixed(0)} s`)
  c.arrive = 100_000
  until(c, () => false, 3, () => T(1, 0, 0, 0, 1))
  check('a target 100 km ahead caps the speed within 3 s', c.speed() <= c.cruiseCap(100_000) * 1.01, `${(c.speed() / 1000).toFixed(1)} km/s vs ${(c.cruiseCap(100_000) / 1000).toFixed(1)} km/s`)
}
// 19. The transfer: from 100 km over home, aim at the moon and boost. Pace is a design requirement.
{
  const moon = body('home-1')
  const c = new Craft(HOME); c.time = 5000
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
  check('and the cap hands it to hover at the moon under 1.6 km/s', c.state === 'flying' && !c.cruise && c.speed() < 1700 && c.ref === moon, `${t2.toFixed(0)} s more, ${c.speed().toFixed(0)} m/s at ${c.altitude().toFixed(0)} m, ${c.cruise ? 'cruise' : 'hover'}`)
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
    const c = new Craft(HOME); c.time = 5000
    c.placeAbove(body('home'), sea, 60)
    const t = until(c, (c) => c.state !== 'flying', 120, (t, c) => T(c.vUp() < -2 ? 1 : 0))
    const lc = c.lastContact
    check('autopilot puts down on the sea and floats', c.state === 'landed' && Math.abs(c.pos.length() - (HOME.radius + HOME.sea + 1.6)) < 0.01 && lc.slope < 0.5, `${t.toFixed(1)} s, at ${(c.pos.length() - HOME.radius).toFixed(2)} m above datum (sea ${HOME.sea}), slope ${lc.slope.toFixed(2)}°, ground below the water ${(groundRadius(sea, HOME) - HOME.radius - height(sea, HOME)).toFixed(0)} m up from the floor`)
  }
}

// 21. The orbit autopilot: from 150 km over the moon, park in a circular orbit and stay there.
for (const [id, start] of [['home-1', 150_000], ['home', 400_000]]) {
  const b = body(id)
  const c = new Craft(HOME); c.time = 5000
  c.placeAbove(b, new THREE.Vector3(0.3, 0.5, 0.8), start)
  const ap = new OrbitAutopilot()
  const rPark = ap.parkRadius(c), vCirc = ap.parkSpeed(c)
  const radial = () => c.vel.dot(c.pos.clone().normalize())
  const t = until(c, (c) => ap.phase === 'orbit', 500, () => ap.controls(c))
  const alt = c.pos.length() - rPark
  check(`autopilot parks over ${b.name} from ${start / 1000} km`, ap.phase === 'orbit' && Math.abs(alt) < 0.1 * (rPark - b.radius) && Math.abs(c.speed() - vCirc) < 0.05 * vCirc && Math.abs(radial()) < 5, `${t.toFixed(0)} s: ${(alt / 1000).toFixed(1)} km off the park radius, ${c.speed().toFixed(0)} m/s vs circular ${vCirc.toFixed(0)}, radial ${radial().toFixed(1)} m/s, ${ap.phase}`)
  const r0 = c.pos.length(), T = 2 * Math.PI * rPark / vCirc
  let worst = 0
  until(c, () => false, Math.min(600, T), (t, c) => { worst = Math.max(worst, Math.abs(c.pos.length() - r0)); return ap.controls(c) })
  check(`and holds the orbit for ${Math.min(600, T).toFixed(0)} s (${(T / 60).toFixed(0)} min period)`, worst < 0.05 * (rPark - b.radius) && c.state === 'flying', `radius wandered ${(worst / 1000).toFixed(2)} km, now ${c.speed().toFixed(0)} m/s at ${(c.altitude() / 1000).toFixed(1)} km`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
