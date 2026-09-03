#!/usr/bin/env node
// Solar-system instrument. The laws DESIGN.md §5b promises, checked.
import * as THREE from 'three'
import { SYSTEM, body, bodyPosition, bodyVelocity, bodySpin, buildSystem } from '../src/world/system.ts'
import { FIELDS, ROCKS, buildFields, fieldPosition, fieldVelocity, rockPosition, nearestRock, castRay, fuelYield, resetRocks } from '../src/world/asteroids.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }
const TWO_PI = Math.PI * 2
const km = (m) => (m / 1000).toFixed(0)

// 1. Every mass is g·R²; every period is Kepler III against the parent.
{
  let muOk = true, keplerOk = true, worst = 0
  for (const b of SYSTEM) {
    if (Math.abs(b.mu - b.surfaceGravity * b.radius * b.radius) > 1e-6 * b.mu) muOk = false
    if (b.orbit) { const T = TWO_PI * Math.sqrt(b.orbit.a ** 3 / body(b.parent).mu); worst = Math.max(worst, Math.abs(T - b.orbit.period) / T); if (worst > 1e-12) keplerOk = false }
  }
  check('GM = g·R² for every body', muOk)
  check('every period obeys Kepler III', keplerOk, `worst relative error ${worst.toExponential(1)}`)
}
// 2. Moons sit inside a third of their planet's Hill radius; planets' Hill spheres do not overlap.
{
  let inside = true, detail = []
  for (const m of SYSTEM.filter((b) => b.kind === 'moon')) {
    const p = body(m.parent)
    if (m.orbit.a > p.hill / 3) { inside = false; detail.push(`${m.name} at ${km(m.orbit.a)} km vs Hill/3 ${km(p.hill / 3)} km`) }
  }
  check("every moon is inside a third of its planet's Hill sphere", inside, detail.join("; "))
  const planets = SYSTEM.filter((b) => b.parent === 'sun').sort((x, y) => x.orbit.a - y.orbit.a)
  let clear = true; detail = []
  for (let i = 1; i < planets.length; i++) {
    const lo = planets[i - 1], hi = planets[i]
    if (lo.orbit.a + lo.hill > hi.orbit.a - hi.hill) { clear = false; detail.push(`${lo.name}/${hi.name}`) }
  }
  check("planets' spheres of influence never overlap", clear, detail.join(", "))
}
// 3. Moons are tidally locked.
check('moons are tidally locked', SYSTEM.filter((b) => b.kind === 'moon').every((m) => m.spinPeriod === m.orbit.period))
// 4. No body ever sits inside another, sampled through a long stretch of time.
{
  let ok = true, closest = Infinity, pair = ''
  const pa = new THREE.Vector3(), pb = new THREE.Vector3()
  for (let t = 0; t < 200_000; t += 250) for (let i = 0; i < SYSTEM.length; i++) for (let j = i + 1; j < SYSTEM.length; j++) {
    const d = bodyPosition(SYSTEM[i], t, pa).distanceTo(bodyPosition(SYSTEM[j], t, pb)) - SYSTEM[i].radius - SYSTEM[j].radius
    if (d < closest) { closest = d; pair = `${SYSTEM[i].name}/${SYSTEM[j].name}` }
    if (d < 0) ok = false
  }
  check('no body ever overlaps another', ok, `closest surfaces ${km(closest)} km (${pair})`)
}
// 5. Deterministic and periodic.
{
  const a = bodyPosition(body('giant'), 12345.678), b = bodyPosition(body('giant'), 12345.678)
  check('positions are bit-identical', a.x === b.x && a.y === b.y && a.z === b.z)
  const s2 = buildSystem()
  check('the system rebuilds identically from the seed', s2.every((b, i) => b.orbit?.phase0 === SYSTEM[i].orbit?.phase0 && b.spinPhase0 === SYSTEM[i].spinPhase0))
  const m = body('home-1'), T = m.orbit.period
  const p0 = bodyPosition(m, 100).sub(bodyPosition(body('home'), 100)), p1 = bodyPosition(m, 100 + T).sub(bodyPosition(body('home'), 100 + T))
  check('a moon returns after one period', p0.distanceTo(p1) < 1e-3, `${p0.distanceTo(p1).toExponential(1)} m off`)
  const q0 = bodySpin(m, 100), q1 = bodySpin(m, 100 + T)
  check('a tidally locked moon returns to the same face', Math.abs(q0.dot(q1)) > 1 - 1e-9)
}
// 6. Velocity is the derivative of position.
{
  const b = body('home'), t = 777, h = 1e-3
  const v = bodyVelocity(b, t)
  const fd = bodyPosition(b, t + h).sub(bodyPosition(b, t - h)).divideScalar(2 * h)
  check('bodyVelocity matches finite-difference position', v.distanceTo(fd) < 1e-4 * v.length(), `${v.length().toFixed(1)} m/s`)
}

console.log('\n  body                  a km    period    v m/s    Hill km    R km      g   air m   day min')
for (const b of SYSTEM) {
  const o = b.orbit
  const v = o ? (TWO_PI * o.a / o.period).toFixed(0) : '-'
  const T = o ? (o.period < 3600 ? (o.period / 60).toFixed(0) + ' min' : o.period < 86400 * 2 ? (o.period / 3600).toFixed(1) + ' h' : (o.period / 86400).toFixed(1) + ' d') : '-'
  console.log(`  ${(b.name + (b.kind === 'moon' ? '' : ' (' + b.kind + ')')).padEnd(18)}${o ? km(o.a).padStart(9) : '        -'}  ${T.padStart(8)}  ${String(v).padStart(7)}  ${b.hill ? km(b.hill).padStart(9) : '        -'}  ${(b.radius / 1000).toFixed(1).padStart(6)}  ${b.surfaceGravity.toFixed(1).padStart(5)}  ${String(b.atmosphereHeight).padStart(6)}  ${(b.spinPeriod / 60).toFixed(0).padStart(7)}`)
}

// 8. Asteroids: fields are a function of the seed, Trojans hold their 60°, rocks are apart, ice is a minority, nothing sits in a body.
{
  const home = body('home'), sun = body('sun')
  check('there are fields and rocks', FIELDS.length >= 10 && ROCKS.length > 500, `${FIELDS.length} fields, ${ROCKS.length} rocks`)
  const again = buildFields()
  let same = again.length === FIELDS.length
  for (let i = 0; same && i < FIELDS.length; i++) {
    const a = FIELDS[i], b = again[i]
    same = a.rocks.length === b.rocks.length && a.phase0 === b.phase0 && a.rocks.every((r, k) => r.offset.equals(b.rocks[k].offset) && r.radius === b.rocks[k].radius && r.ice === b.rocks[k].ice)
  }
  check('the fields rebuild identically from the seed', same)
  // Trojans: the angle from home stays 60° through a year and a half.
  const l4 = FIELDS.find((f) => f.id === 'home-l4'), l5 = FIELDS.find((f) => f.id === 'home-l5')
  let worst = 0
  const ph = new THREE.Vector3(), pf = new THREE.Vector3()
  for (let t = 0; t < home.orbit.period * 1.5; t += home.orbit.period / 37) {
    bodyPosition(home, t, ph)
    for (const f of [l4, l5]) worst = Math.max(worst, Math.abs(ph.angleTo(fieldPosition(f, t, pf)) - Math.PI / 3))
  }
  check("home's Trojans stay 60° from home", worst < 1e-9, `worst ${(worst * 180 / Math.PI).toExponential(1)}°`)
  // A field's velocity matches finite-difference position.
  {
    const f = FIELDS.find((x) => x.kind === 'belt')
    const t = 12345, h = 0.5
    const v = fieldVelocity(f, t), fd = fieldPosition(f, t + h).sub(fieldPosition(f, t - h)).divideScalar(2 * h)
    check('fieldVelocity matches finite-difference position', v.distanceTo(fd) < 1e-3 * v.length(), `${v.length().toFixed(1)} m/s`)
  }
  // Rocks stay in their field's spread and apart from each other, forever (rigid frame, so one time is every time).
  let inside = true, apart = true, minGap = Infinity
  for (const f of FIELDS) {
    for (const r of f.rocks) {
      if (r.offset.length() > f.spread) inside = false
      for (const o of f.rocks) if (o !== r) { const gap = o.offset.distanceTo(r.offset) - o.radius - r.radius; minGap = Math.min(minGap, gap); if (gap < 6 * Math.max(o.radius, r.radius)) apart = false }
    }
  }
  check('every rock lies within its field', inside)
  check('rocks never touch, and are sparse', apart, `smallest surface gap ${km(minGap)} km`)
  const iceHome = l4.rocks.filter((r) => r.ice).length / l4.rocks.length
  const belt = FIELDS.filter((f) => f.kind === 'belt')
  const iceBelt = belt.reduce((n, f) => n + f.rocks.filter((r) => r.ice).length, 0) / belt.reduce((n, f) => n + f.rocks.length, 0)
  check("ice is a minority at home's Trojans and richer in the belt", iceHome > 0.1 && iceHome < 0.4 && iceBelt > iceHome, `home L4 ${(iceHome * 100).toFixed(0)}%, belt ${(iceBelt * 100).toFixed(0)}%`)
  // No field ever comes inside a body's Hill sphere (or the sun), sampled through a year.
  let clear = true, detail = []
  const pb = new THREE.Vector3()
  for (const f of FIELDS) for (let t = 0; t < home.orbit.period; t += home.orbit.period / 61) {
    fieldPosition(f, t, pf)
    for (const b of SYSTEM) {
      const limit = b.kind === 'sun' ? b.radius * 3 : b.hill
      if (bodyPosition(b, t, pb).distanceTo(pf) - f.spread < limit) { clear = false; detail.push(`${f.id} in ${b.name}`) }
    }
  }
  check('no field ever enters a body\'s sphere of influence', clear, detail.slice(0, 3).join(', '))
  // The Trojans are the first rung: reachable, far, and not too far.
  const dL4 = bodyPosition(home, 0).distanceTo(fieldPosition(l4, 0))
  check("home's Trojans are as far as the sun (that is what L4 means)", Math.abs(dL4 - home.orbit.a) < 1e-6 * home.orbit.a, `${km(dL4)} km`)
  // Nearest and the ray.
  resetRocks()
  const r0 = l4.rocks[0]
  const p0 = rockPosition(r0, 777)
  const away = new THREE.Vector3(1, 0.2, 0.3).normalize()
  const from = p0.clone().addScaledVector(away, r0.radius + 1500)
  const near = nearestRock(from, 777, { rock: null, dist: Infinity, pos: new THREE.Vector3() })
  check('nearestRock finds the rock you are next to', near.rock === r0 && Math.abs(near.dist - 1500) < 1e-3, `${near.dist.toFixed(1)} m`)
  const hit = castRay(from, away.clone().negate(), 3000, 777)
  const miss = castRay(from, away, 3000, 777)
  check('a ray at a rock hits its near surface, a ray away misses', hit && hit.rock === r0 && Math.abs(hit.dist - 1500) < 1e-3 && miss === null, `hit at ${hit?.dist.toFixed(1)} m`)
  const ice = ROCKS.find((r) => r.ice), stone = ROCKS.find((r) => !r.ice)
  check('ice yields fuel, stone yields nothing', fuelYield(ice) > 0 && fuelYield(stone) === 0, `${fuelYield(ice).toFixed(1)} units from a ${ice.radius.toFixed(0)} m ice rock`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
