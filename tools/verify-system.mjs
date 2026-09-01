#!/usr/bin/env node
// Solar-system instrument. The laws DESIGN.md §5b promises, checked.
import * as THREE from 'three'
import { SYSTEM, body, bodyPosition, bodyVelocity, bodySpin, buildSystem } from '../src/world/system.ts'

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
  const a = bodyPosition(body('giant-3'), 12345.678), b = bodyPosition(body('giant-3'), 12345.678)
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

console.log('\n  body            a km   period    v m/s   Hill km  R m    g     air m  day s')
for (const b of SYSTEM) {
  const o = b.orbit
  const v = o ? (TWO_PI * o.a / o.period).toFixed(0) : '-'
  const T = o ? (o.period < 3600 ? (o.period / 60).toFixed(0) + ' min' : (o.period / 3600).toFixed(1) + ' h') : '-'
  console.log(`  ${(b.name + (b.kind === 'moon' ? '' : ' (' + b.kind + ')')).padEnd(18)}${o ? km(o.a).padStart(5) : '    -'}  ${T.padStart(8)}  ${String(v).padStart(6)}  ${b.hill ? km(b.hill).padStart(7) : '      -'}  ${String(b.radius).padStart(5)}  ${b.surfaceGravity.toFixed(1).padStart(4)}  ${String(b.atmosphereHeight).padStart(5)}  ${b.spinPeriod.toFixed(0).padStart(5)}`)
}
console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
