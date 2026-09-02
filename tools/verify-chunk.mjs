#!/usr/bin/env node
import * as THREE from 'three'
// Chunk instrument: the geometry promises the LOD makes.
import { buildChunk, CHUNK_GRID } from '../src/world/chunk.ts'
import { HOME, waterOf } from '../src/world/height.ts'
import { buildForest, FOREST_LEVEL } from '../src/world/forest.ts'
import { FACES } from '../src/world/cubesphere.ts'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }

const G = CHUNK_GRID
const surfaceTris = G * G * 2, skirtTris = 4 * G * 2
for (const [f, L, ix, iy] of [[4, 3, 3, 3], [0, 0, 0, 0], [2, 6, 17, 40]]) {
  const geom = buildChunk(f, L, ix, iy, HOME)
  const pos = geom.getAttribute('position').array, nor = geom.getAttribute('normal').array, col = geom.getAttribute('color').array
  const tris = pos.length / 9
  check(`chunk ${f}:${L}:${ix}:${iy} has ${surfaceTris} surface + ${skirtTris} skirt triangles`, tris === surfaceTris + skirtTris, `${tris}`)

  // Every skirt triangle's top edge is an edge of exactly one surface triangle,
  // and it carries that triangle's normal and colour bit for bit.
  const v = (t, k) => [pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 1], pos[t * 9 + k * 3 + 2]]
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
  // A skirt vertex is "top" if it is bit-identical to some surface vertex.
  const surface = new Set()
  for (let t = 0; t < surfaceTris; t++) for (let k = 0; k < 3; k++) surface.add(v(t, k).join(','))
  let orphan = 0, mismatch = 0, radial = 0
  // Skirt quads come in pairs: the first triangle holds the top edge, the second
  // shares one top vertex and must match its sibling exactly.
  for (let st = surfaceTris; st < tris; st += 2) {
    const verts = [v(st, 0), v(st, 1), v(st, 2)]
    const top = [0, 1, 2].filter((k) => surface.has(verts[k].join(',')))
    if (top.length !== 2) { orphan++; continue }
    for (let q = 0; q < 9; q++) if (nor[(st + 1) * 9 + q] !== nor[st * 9 + q] || col[(st + 1) * 9 + q] !== col[st * 9 + q]) { mismatch++; break }
    const [A, B] = [verts[top[0]], verts[top[1]]]
    let owner = -1
    for (let t = 0; t < surfaceTris && owner < 0; t++) {
      const w = [v(t, 0), v(t, 1), v(t, 2)]
      const hasA = w.some((p) => same(p, A)), hasB = w.some((p) => same(p, B))
      if (hasA && hasB) owner = t
    }
    if (owner < 0) { orphan++; continue }
    for (let q = 0; q < 9; q++) if (nor[st * 9 + q] !== nor[owner * 9 + (q % 3)] || col[st * 9 + q] !== col[owner * 9 + (q % 3)]) { mismatch++; break }
    const n = [nor[st * 9], nor[st * 9 + 1], nor[st * 9 + 2]], c = verts[0].map((x, i) => (verts[0][i] + verts[1][i] + verts[2][i]) / 3)
    const cl = Math.hypot(...c)
    if (Math.abs((n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) / cl) > 0.99999) radial++
  }
  check(`every skirt quad hangs from a surface edge`, orphan === 0, `${orphan} orphans of ${skirtTris / 2}`)
  check(`every skirt triangle carries its owner's normal and colour`, mismatch === 0, `${mismatch} mismatched`)
  check(`skirt normals are the surface's, not the radial`, radial < skirtTris / 4, `${radial} of ${skirtTris} exactly radial`)
}
// Forests: some chunk at the forest level has trees, the same chunk gives the same trees, and a water chunk never does.
{
  let found = null
  outer: for (const f of FACES) for (let ix = 0; ix < 256 && !found; ix += 7) for (let iy = 0; iy < 256; iy += 11) {
    const m = buildForest(f, FOREST_LEVEL, ix, iy, HOME)
    if (m && m.count > 50) { found = { f, ix, iy, m }; break outer }
  }
  check('a forest-level chunk somewhere on home carries more than 50 trees', found !== null, found ? `${found.f}:${found.ix}:${found.iy} has ${found.m.count}` : 'none in the sample')
  if (found) {
    const again = buildForest(found.f, FOREST_LEVEL, found.ix, found.iy, HOME)
    let same = again.count === found.m.count
    const a = found.m.instanceMatrix.array, b = again.instanceMatrix.array
    for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false
    check('the same chunk grows the same trees', same)
    // Every tree stands in the band, on land.
    const p = new THREE.Vector3(), mm = new THREE.Matrix4()
    let inBand = true
    for (let i = 0; i < found.m.count; i++) {
      found.m.getMatrixAt(i, mm); p.setFromMatrixPosition(mm)
      const h = p.length() - HOME.radius, above = (h - HOME.sea) / HOME.amplitude
      if (above < 0.03 || above > 0.9) inBand = false
    }
    check('every tree stands in the forest band above the sea', inBand)
  }
  check('a water chunk grows nothing', buildForest(FACES[0], FOREST_LEVEL, 100, 100, waterOf(HOME)) === null)
  check('a coarse chunk grows nothing', buildForest(FACES[0], FOREST_LEVEL - 1, 3, 3, HOME) === null)
}

console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
