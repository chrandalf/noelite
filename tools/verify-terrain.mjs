#!/usr/bin/env node
// Terrain instrument. Imports the TypeScript directly; Node 24 strips the types.
//
// Asserts the things DESIGN.md §6 promises about height() and the cube-sphere
// mapping, and reports the numbers a person would otherwise eyeball.
import { height, HOME } from '../src/world/height.ts'
import { FACES, faceToUnit, faceToCube, cubeToUnit, cubeToFace } from '../src/world/cubesphere.ts'
import { TERRAIN_AMPLITUDE, PLANET_RADIUS, MASTER_SEED } from '../src/world/config.ts'
import { rng } from '../src/world/noise.ts'

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
  check('height() stays within 1.1 × amplitude', Math.max(-lo, hi) <= 1.1 * TERRAIN_AMPLITUDE, `range ${lo.toFixed(1)} .. ${hi.toFixed(1)} m`)
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
// 6. Seams: height is continuous across every face edge. This is the guard
//    against anyone ever evaluating height in face space. A real seam break is
//    a step of metres over centimetres of arc, so the test is relative: the
//    steepest gradient found on an edge must match the steepest found anywhere.
{
  const eps = 2e-4 // ~0.4 m of arc at 2 km
  const gradient = (edge, dir) => {
    const l = Math.hypot(dir.x, dir.y, dir.z)
    const a = cubeToUnit(edge.x + eps * dir.x / l, edge.y + eps * dir.y / l, edge.z + eps * dir.z / l)
    const b = cubeToUnit(edge.x - eps * dir.x / l, edge.y - eps * dir.y / l, edge.z - eps * dir.z / l)
    return Math.abs(height(a, SEED) - height(b, SEED)) / (dist(a, b) * PLANET_RADIUS)
  }
  let seamWorst = 0
  for (const f of FACES) {
    const centre = faceToUnit(f, 0, 0)
    for (const side of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 0; i <= 200; i++) {
      const t = -1 + 2 * i / 200
      const u = side[0] !== 0 ? side[0] : t, v = side[1] !== 0 ? side[1] : t
      const [cx, cy, cz] = faceToCube(f, u, v)
      const edge = cubeToUnit(cx, cy, cz)
      // Straddle the edge along the great circle through the face centre.
      const g = gradient(edge, { x: centre.x - edge.x, y: centre.y - edge.y, z: centre.z - edge.z })
      if (g > seamWorst) seamWorst = g
    }
  }
  let interiorWorst = 0
  for (let i = 0; i < 4824; i++) {
    const p = randomUnit(), d = randomUnit()
    const g = gradient(p, d)
    if (g > interiorWorst) interiorWorst = g
  }
  check('height continuous across all 24 face edges', seamWorst <= 1.5 * interiorWorst,
    `seam worst ${seamWorst.toFixed(3)}, interior worst ${interiorWorst.toFixed(3)}`)
}
// 7. Landability survey. Not a pass/fail on the number so much as a promise
//    that plains exist: DESIGN.md says you need somewhere to put it down.
{
  const step = 1 / PLANET_RADIUS // 1 m of arc
  let landable = 0, N = 20000, maxSlope = 0
  for (let i = 0; i < N; i++) {
    const p = randomUnit()
    const q = cubeToUnit(p.x + step, p.y, p.z)
    const slope = Math.abs(height(p, SEED) - height(q, SEED)) / (dist(p, q) * PLANET_RADIUS)
    if (slope < Math.tan(15 * Math.PI / 180)) landable++
    if (slope > maxSlope) maxSlope = slope
  }
  const frac = landable / N
  check('at least 30% of the surface is under 15°', frac >= 0.3, `${(100 * frac).toFixed(1)}% landable, steepest ${(Math.atan(maxSlope) * 180 / Math.PI).toFixed(1)}°`)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
