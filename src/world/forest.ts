// Forests: seeded low-poly trees on the chunks, in big clumps. Chris, 2026-09-02: "trees,
// forests ... like big bunches". A chunk at a fine LOD level gets one InstancedMesh of a
// shared cone-and-trunk, placed by a seed hashed from the chunk key, only where the
// height band is forest, the slope is gentle and the clump mask says so. It hangs off
// the chunk mesh so it appears and retires with it. Only erasable TypeScript.
import * as THREE from 'three'
import { faceToUnit, type Face } from './cubesphere.ts'
import { height, clump, CLUMP_EDGE, nearPad, PAD_RADIUS, PAD_BLEND, type Terrain } from './height.ts'
import { chunkBounds } from './chunk.ts'
import { rng } from './noise.ts'

/** Trees appear on chunks at this LOD level and finer; the coarsest level is sparse and large. */
export const FOREST_LEVEL = 7
/** Trees per square metre inside a clump. */
const DENSITY = 1 / 30
const MAX_TREES = 1400
/** Metres from the camera over which a tree shrinks into the ground. Chris, 2026-09-02: "fade out slowly and merge into the colour". */
export const TREE_FADE_NEAR = 500, TREE_FADE_FAR = 1500
/** Height band, in amplitudes above the sea. */
const BAND_LO = 0.04, BAND_HI = 0.85
const MAX_SLOPE = Math.tan((22 * Math.PI) / 180)

let shared: THREE.BufferGeometry | null = null
/** One tree, base at the origin, +Y up: a six-sided cone on a stubby trunk, coloured by vertex. */
export function treeGeometry(): THREE.BufferGeometry {
  if (shared) return shared
  const canopy = new THREE.ConeGeometry(2.4, 7, 6, 1, false).translate(0, 2.2 + 3.5, 0).toNonIndexed()
  const trunk = new THREE.CylinderGeometry(0.3, 0.42, 2.4, 5, 1, false).translate(0, 1.2, 0).toNonIndexed()
  const paint = (g: THREE.BufferGeometry, r: number, gg: number, b: number) => {
    const n = g.getAttribute('position').count, c = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  }
  paint(canopy, 0.20, 0.46, 0.22)
  paint(trunk, 0.36, 0.26, 0.16)
  const pos = new Float32Array([...canopy.getAttribute('position').array as Float32Array, ...trunk.getAttribute('position').array as Float32Array])
  const col = new Float32Array([...canopy.getAttribute('color').array as Float32Array, ...trunk.getAttribute('color').array as Float32Array])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  shared = g
  return g
}

export { clump, CLUMP_EDGE }

/** Is there forest at p? Band, slope and clump. */
export function forestAt(p: THREE.Vector3, t: Terrain, out?: { h: number }): boolean {
  if (t.kind !== 'terrestrial' || !t.amplitude) return false
  if (nearPad(p, t, PAD_RADIUS + PAD_BLEND + 25)) return false
  const h = height(p, t)
  if (out) out.h = h
  const above = (h - (t.sea ?? 0)) / t.amplitude
  if (above < BAND_LO || above > BAND_HI) return false
  if (clump(p, t) < CLUMP_EDGE) return false
  // Slope from two metres along a tangent.
  const e = 2 / t.radius
  const ax = Math.abs(p.x) < 0.9 ? 1 : 0
  const tx = ax ? 0 : 1, ty = ax ? 1 : 0 // cheap tangent: cross of an axis with p, unnormalised is fine at this scale
  const qx = p.x + e * (ty * p.z - 0 * p.y), qy = p.y + e * (0 * p.x - tx * p.z), qz = p.z + e * (tx * p.y - ty * p.x)
  const l = Math.hypot(qx, qy, qz)
  const h2 = height({ x: qx / l, y: qy / l, z: qz / l }, t)
  return Math.abs(h2 - h) / 2 < MAX_SLOPE
}

const treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
treeMaterial.name = 'tree'
// Each tree scales about its own base by its distance to the camera, so a forest sinks
// into the ground colour as you leave it rather than switching off with its chunk.
treeMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `vec3 transformed = vec3(position);
    #ifdef USE_INSTANCING
      vec4 treeBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float treeDist = length(treeBase.xyz - cameraPosition);
      transformed *= smoothstep(${TREE_FADE_FAR.toFixed(1)}, ${TREE_FADE_NEAR.toFixed(1)}, treeDist);
    #endif`,
  )
}

const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(), yaw = new THREE.Quaternion()
const Y = new THREE.Vector3(0, 1, 0)
/** The trees of one chunk, or null if none. Deterministic in the chunk key and the seed. */
export function buildForest(f: Face, level: number, ix: number, iy: number, t: Terrain): THREE.InstancedMesh | null {
  if (t.kind !== 'terrestrial' || t.water || level < FOREST_LEVEL || !t.amplitude) return null
  const { u0, v0, s } = chunkBounds(level, ix, iy)
  const side = s * 0.8 * t.radius
  // The coarsest forest level is a third as dense and half again as big: it is only ever seen shrunk.
  const coarse = level === FOREST_LEVEL
  const wanted = Math.min(MAX_TREES, Math.round(side * side * DENSITY * (coarse ? 1 / 3 : 1)))
  const next = rng((t.seed ^ Math.imul((f as number) + 1, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b) ^ Math.imul(ix + 1, 0xc2b2ae35) ^ Math.imul(iy + 7, 0x27d4eb2f)) >>> 0)
  const mats: THREE.Matrix4[] = []
  const probe = { h: 0 }
  for (let i = 0; i < wanted; i++) {
    const u = u0 + s * next(), v = v0 + s * next()
    const p = faceToUnit(f, u, v)
    up.set(p.x, p.y, p.z)
    if (!forestAt(up, t, probe)) continue
    pos.copy(up).multiplyScalar(t.radius + probe.h)
    q.setFromUnitVectors(Y, up)
    yaw.setFromAxisAngle(Y, next() * Math.PI * 2)
    q.multiply(yaw)
    const k = (0.7 + 0.6 * next()) * (coarse ? 1.5 : 1)
    sc.set(k, k * (0.85 + 0.3 * next()), k)
    mats.push(m.clone().compose(pos, q, sc))
  }
  if (!mats.length) return null
  const mesh = new THREE.InstancedMesh(treeGeometry(), treeMaterial, mats.length)
  for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i])
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false // the parent chunk is culled; instances stay inside it
  return mesh
}
