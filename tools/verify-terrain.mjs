#!/usr/bin/env node
// Terrain instrument. Imports the TypeScript directly; Node 24 strips the types.
//
// Asserts the things DESIGN.md §6 promises about height() and the cube-sphere
// mapping, and reports the numbers a person would otherwise eyeball.
import * as THREE from 'three'
import { height, HOME } from '../src/world/height.ts'
import { FACES, faceToUnit, faceToCube, cubeToUnit, cubeToFace } from '../src/world/cubesphere.ts'
import { TERRAIN_AMPLITUDE, PLANET_RADIUS, MASTER_SEED } from '../src/world/config.ts'
import { rng } from '../src/world/noise.ts'
import { wind, front, tide, WIND_CALM, WIND_STORM, TIDE_AMPLITUDE } from '../src/world/weather.ts'
import { terrainOf, padOf } from '../src/world/height.ts'
import { slopeDeg } from '../src/world/terrain.ts'
import { forestAt } from '../src/world/forest.ts'
import { body } from '../src/world/system.ts'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) }
  else      { fail++; console.log(`  FAIL ${name}  ${detail}`) }
}
const next = rng(0xC0FFEE)
function randomUnit() {
  let x, y, s
  do { x = next() * 2 - 1; y = next() * 2 - 1; s = x * x + y * y } while (s >= 1 || s === 0)
  const f = 2 * Math.sqrt(1 - s)
  return { x: x * f, y: y * f, z: 1 - 2 * s }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const SEED = HOME
const OTHER = { ...HOME, seed: MASTER_SEED + 1 }

// 1. Deterministic, bit for bit.
{
  let same = true
  for (let i = 0; i < 2000 && same; i++) { const p = randomUnit(); same = height(p, SEED) === height(p, SEED) }
  check('height() is deterministic', same)
}
// 2. Different seeds are different planets.
{
  let diff = 0
  for (let i = 0; i < 200; i++) { const p = randomUnit(); diff += Math.abs(height(p, SEED) - height(p, OTHER)) }
  check('different seeds give different terrain', diff > 200 * 1, `mean |Δh| ${(diff / 200).toFixed(1)} m`)
}
// 3. Finite and bounded everywhere sampled.
{
  let finite = true, lo = Infinity, hi = -Infinity
  for (let i = 0; i < 40000; i++) {
    const h = height(randomUnit(), SEED)
    if (!Number.isFinite(h)) { finite = false; break }
    if (h < lo) lo = h; if (h > hi) hi = h
  }
  check('height() is finite over 40k samples', finite)
  check('height() stays within its declared bounds', lo >= HOME.bottom * 1.05 && hi <= HOME.top * 1.05, `range ${lo.toFixed(1)} .. ${hi.toFixed(1)} m, declared ${HOME.bottom.toFixed(0)} .. ${HOME.top.toFixed(0)}`)
  check('mountains stand well above the plains', hi > 2 * TERRAIN_AMPLITUDE, `highest ${hi.toFixed(0)} m vs amplitude ${TERRAIN_AMPLITUDE}`)
  {
    let sea = 0, N = 40000
    for (let i = 0; i < N; i++) if (height(randomUnit(), SEED) < HOME.sea) sea++
    check('between a third and two thirds of home is under the sea', sea / N > 0.33 && sea / N < 0.67, `${(100 * sea / N).toFixed(1)}% ocean`)
  }
  // Simplex boundaries lie where two noise coordinates are equal, which on the sphere is
  // p.x = p.y and friends. With a 0.6 kernel the field jumps there; the pad sat on one.
  let crack = 0
  const rr = rng(11)
  for (let s = 0; s < 3000; s++) {
    const a = rr() * 2 - 1, b = rr() * 2 - 1, e = 1e-9
    for (const [p, q] of [[[a, a, b], [a + e, a - e, b]], [[b, a, a], [b, a + e, a - e]], [[a, b, a], [a + e, b, a - e]]]) {
      const u = new THREE.Vector3(...p).normalize(), v = new THREE.Vector3(...q).normalize()
      crack = Math.max(crack, Math.abs(height(u, HOME) - height(v, HOME)))
    }
  }
  check('height() has no cracks on simplex boundaries', crack < 1e-3, `worst step ${crack.toExponential(1)} m`)
}
// 4. Cube-sphere round trip is exact, including on every edge and corner.
{
  let worst = 0
  const probe = (p) => { const f = cubeToFace(p.x, p.y, p.z); const q = faceToUnit(f.face, f.u, f.v); worst = Math.max(worst, dist(p, q)) }
  for (let i = 0; i < 50000; i++) probe(randomUnit())
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) probe(cubeToUnit(x, y, z))
  for (const f of FACES) for (const t of [-1, -0.5, 0, 0.5, 1]) {
    probe(faceToUnit(f, t, 1)); probe(faceToUnit(f, t, -1)); probe(faceToUnit(f, 1, t)); probe(faceToUnit(f, -1, t))
  }
  check('cube↔sphere round trip exact', worst < 1e-12, `worst ${worst.toExponential(2)}`)
}
// 5. Every face winds outward, so meshes built on it face the right way.
{
  let ok = true
  for (const f of FACES) {
    const [ox, oy, oz] = faceToCube(f, 0, 0)
    const [ax, ay, az] = faceToCube(f, 1e-3, 0)
    const [bx, by, bz] = faceToCube(f, 0, 1e-3)
    const du = [ax - ox, ay - oy, az - oz], dv = [bx - ox, by - oy, bz - oz]
    const n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]
    if (n[0] * ox + n[1] * oy + n[2] * oz <= 0) ok = false
  }
  check('all six faces wind outward', ok)
}
// 6. Seams: height is continuous across every face edge. This is the guard against
//    anyone ever evaluating height in face space: a nanoradian either side of the edge
//    must give the same ground to a millimetre.
{
  const eps = 1e-9
  let seamWorst = 0
  for (const f of FACES) {
    const centre = faceToUnit(f, 0, 0)
    for (const side of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 0; i <= 200; i++) {
      const t = -1 + 2 * i / 200
      const u = side[0] !== 0 ? side[0] : t, v = side[1] !== 0 ? side[1] : t
      const [cx, cy, cz] = faceToCube(f, u, v)
      const edge = cubeToUnit(cx, cy, cz)
      const dir = { x: centre.x - edge.x, y: centre.y - edge.y, z: centre.z - edge.z }
      const l = Math.hypot(dir.x, dir.y, dir.z)
      const a = cubeToUnit(edge.x + eps * dir.x / l, edge.y + eps * dir.y / l, edge.z + eps * dir.z / l)
      const b = cubeToUnit(edge.x - eps * dir.x / l, edge.y - eps * dir.y / l, edge.z - eps * dir.z / l)
      seamWorst = Math.max(seamWorst, Math.abs(height(a, SEED) - height(b, SEED)))
    }
  }
  check('height continuous across all 24 face edges', seamWorst < 1e-3, `worst step ${seamWorst.toExponential(1)} m`)
}
// 7. Landability survey. Not a pass/fail on the number so much as a promise
//    that plains exist: DESIGN.md says you need somewhere to put it down.
{
  const step = 1 / PLANET_RADIUS // 1 m of arc
  let landable = 0, N = 0, maxSlope = 0
  for (let i = 0; i < 40000; i++) {
    const p = randomUnit()
    if (height(p, SEED) < HOME.sea + 3) continue // dry land only; the sea is flat and you can put down on it anyway
    N++
    const q = cubeToUnit(p.x + step, p.y, p.z)
    const slope = Math.abs(height(p, SEED) - height(q, SEED)) / (dist(p, q) * PLANET_RADIUS)
    if (slope < Math.tan(15 * Math.PI / 180)) landable++
    if (slope > maxSlope) maxSlope = slope
  }
  const frac = landable / N
  check('at least 30% of the surface is under 15°', frac >= 0.3, `${(100 * frac).toFixed(1)}% landable, steepest ${(Math.atan(maxSlope) * 180 / Math.PI).toFixed(1)}°`)
}

// 8. Weather: wind is tangential and bounded, the front is bounded, the tide is two bulges of the right size.
{
  let tangential = true, lo = Infinity, hi = 0, fLo = 1, fHi = -1, tLo = Infinity, tHi = -Infinity
  const w = new THREE.Vector3()
  for (let i = 0; i < 2000; i++) {
    const p = randomUnit(), d = new THREE.Vector3(p.x, p.y, p.z), t = i * 37
    wind(d, HOME, t, w)
    if (Math.abs(w.dot(d)) > 1e-6 * w.length()) tangential = false
    lo = Math.min(lo, w.length()); hi = Math.max(hi, w.length())
    const f = front(d, HOME, t); fLo = Math.min(fLo, f); fHi = Math.max(fHi, f)
    const td = tide(d, HOME, t); tLo = Math.min(tLo, td); tHi = Math.max(tHi, td)
  }
  check('wind is tangential to the ground', tangential)
  check('wind stays between a breeze and a storm', lo >= WIND_CALM * 0.7 && hi <= WIND_STORM * 1.3, `${lo.toFixed(1)} .. ${hi.toFixed(1)} m/s`)
  check('the front stays in [-1, 1] and actually varies', fLo >= -1 && fHi <= 1 && fHi - fLo > 0.8, `${fLo.toFixed(2)} .. ${fHi.toFixed(2)}`)
  check('the tide runs from a trough to a bulge of TIDE_AMPLITUDE', tLo < -0.4 * TIDE_AMPLITUDE && tHi > 0.9 * TIDE_AMPLITUDE && tHi <= TIDE_AMPLITUDE + 1e-9, `${tLo.toFixed(2)} .. ${tHi.toFixed(2)} m`)
  check('an airless body has no wind', wind(new THREE.Vector3(0, 0, 1), terrainOf(body('home-1')), 100, w).length() === 0)
}

// 9. The landing pad: dry, flat, at a reasonable height, clear of forest, and the ground blends back smoothly.
{
  const site = padOf(HOME)
  const d = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  const above = height(d, HOME) - HOME.sea
  check('the pad sits at a reasonable height above the sea', above >= 25 && above <= 140, `${above.toFixed(0)} m`)
  check('the pad is flat', slopeDeg(d, HOME) < 0.2, `${slopeDeg(d, HOME).toFixed(2)}°`)
  const ax = new THREE.Vector3(1, 0, 0).cross(d).normalize(), ay = d.clone().cross(ax)
  let flat = true, treeFree = true, worstStep = 0
  for (let i = 0; i < 64; i++) {
    const a = i * 0.098
    const q = d.clone().addScaledVector(ax, Math.cos(a) * 18 / HOME.radius).addScaledVector(ay, Math.sin(a) * 18 / HOME.radius).normalize()
    if (Math.abs(height(q, HOME) - height(d, HOME)) > 0.01) flat = false
    const f = d.clone().addScaledVector(ax, Math.cos(a) * 60 / HOME.radius).addScaledVector(ay, Math.sin(a) * 60 / HOME.radius).normalize()
    if (forestAt(f, HOME)) treeFree = false
    // Walk out along the ramp: no step bigger than a metre between neighbours 2 m apart.
    let prev = height(d, HOME)
    for (let r = 2; r <= 60; r += 2) { const w = d.clone().addScaledVector(ax, Math.cos(a) * r / HOME.radius).addScaledVector(ay, Math.sin(a) * r / HOME.radius).normalize(); const h = height(w, HOME); worstStep = Math.max(worstStep, Math.abs(h - prev)); prev = h }
  }
  check('the pad is dead level for 18 m all round', flat)
  check('no tree within 60 m of the pad', treeFree)
  check('the ground ramps back smoothly from the pad', worstStep < 1.5, `worst 2 m step ${worstStep.toFixed(2)} m`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
