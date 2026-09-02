// One LOD chunk: a G×G grid of quads on a sub-square of one cube face, lifted
// by height(), expanded to non-indexed triangles so every facet keeps its own
// normal and colour. Skirts hang off all four edges to hide LOD cracks; with
// flat shading and no textures they are invisible unless you are underneath.
import * as THREE from 'three'
import { faceToUnit, type Face } from './cubesphere.ts'
import { height, type Terrain } from './height.ts'
import { terrainColour, facetJitter } from './palette.ts'

export const CHUNK_GRID = 16

export type ChunkKey = string
export function chunkKey(f: Face, level: number, ix: number, iy: number): ChunkKey {
  return `${f}:${level}:${ix}:${iy}`
}

/** Sub-square of the face in (u, v): origin and side. */
export function chunkBounds(level: number, ix: number, iy: number): { u0: number; v0: number; s: number } {
  const s = 2 / 2 ** level
  return { u0: -1 + ix * s, v0: -1 + iy * s, s }
}

/** `skirts`: true, false, or 'red' to paint them for debugging. */
export type SkirtMode = boolean | 'red'
/** Null for a water chunk whose ground is entirely above the sea: nothing to draw there. */
export function buildChunk(f: Face, level: number, ix: number, iy: number, terrain: Terrain, skirts: SkirtMode = true): THREE.BufferGeometry | null {
  const R = terrain.radius
  const G = CHUNK_GRID
  const { u0, v0, s } = chunkBounds(level, ix, iy)
  const W = G + 1

  // Vertex grid in planet-local metres. Float64 here; it only becomes Float32
  // once it is in a buffer, and at 2 km that costs nothing.
  const vx = new Float64Array(W * W * 3)
  const vh = new Float64Array(W * W)
  let lowestLand = Infinity
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const p = faceToUnit(f, u0 + (s * i) / G, v0 + (s * j) / G)
      const h = height(p, terrain)
      if (terrain.water && terrain.land) lowestLand = Math.min(lowestLand, height(p, terrain.land))
      const r = R + h
      const k = j * W + i
      vx[k * 3] = p.x * r
      vx[k * 3 + 1] = p.y * r
      vx[k * 3 + 2] = p.z * r
      vh[k] = h
    }
  }

  // A water chunk over dry land is nothing. A generous margin: the land grid is coarse.
  if (terrain.water && lowestLand > (terrain.sea ?? 0) + 2) return null

  // Skirt depth has to beat the worst gap between this chunk's edge and a
  // coarser neighbour's straight line across it. Generous; it is invisible anyway.
  const chunkMetres = s * 0.8 * R
  const skirtDepth = Math.max(4, 0.06 * chunkMetres)

  const triCount = G * G * 2 + (skirts ? 4 * G * 2 : 0)
  const pos = new Float32Array(triCount * 9)
  const nor = new Float32Array(triCount * 9)
  const col = new Float32Array(triCount * 9)
  let t = 0

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3()

  // Emit one triangle from three planet-local points. `hAvg` colours it.
  function tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, hAvg: number, isSkirt: boolean) {
    a.set(ax, ay, az); b.set(bx, by, bz); c.set(cx, cy, cz)
    ab.subVectors(b, a); ac.subVectors(c, a)
    n.crossVectors(ab, ac).normalize()
    up.addVectors(a, b).add(c).normalize()
    // A skirt lights and colours as the ground it hangs from, not as the
    // vertical face it actually is; otherwise every seam shows as a rock line.
    if (isSkirt) n.copy(up)
    const slope = isSkirt ? 0 : (Math.acos(Math.min(1, Math.max(-1, n.dot(up)))) * 180) / Math.PI
    const jitter = facetJitter(up.x * 977, up.y * 977, up.z * 977)
    const lat = up.x * terrain.axis.x + up.y * terrain.axis.y + up.z * terrain.axis.z
    const hNorm = terrain.amplitude ? hAvg / terrain.amplitude : 0
    const [r, g, bl] = terrainColour(terrain.kind, hNorm, slope, jitter, lat, terrain.sea === null || !terrain.amplitude ? hNorm : (hAvg - terrain.sea) / terrain.amplitude)
    const o = t * 9
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az
    pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz
    pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz
    for (let q = 0; q < 3; q++) {
      nor[o + q * 3] = n.x; nor[o + q * 3 + 1] = n.y; nor[o + q * 3 + 2] = n.z
      col[o + q * 3] = r; col[o + q * 3 + 1] = g; col[o + q * 3 + 2] = bl
    }
    return t++
  }
  const P = (k: number) => [vx[k * 3], vx[k * 3 + 1], vx[k * 3 + 2]] as const
  // Which surface triangle owns each boundary edge segment, so the skirt under
  // it can borrow that triangle's normal and colour and disappear into it.
  const edgeOwner = new Map<number, number>()
  const edgeKey = (kA: number, kB: number) => Math.min(kA, kB) * 65536 + Math.max(kA, kB)

  // Surface. Diagonal alternates per quad for the checkerboard facet rhythm.
  // Winding is (i, j) → (i+1, j) → (i+1, j+1): du × dv, outward on every face.
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k00 = j * W + i, k10 = k00 + 1, k01 = k00 + W, k11 = k01 + 1
      const [p00, p10, p01, p11] = [P(k00), P(k10), P(k01), P(k11)]
      let t1: number, t2: number
      if ((i + j) % 2 === 0) {
        t1 = tri(...p00, ...p10, ...p11, (vh[k00] + vh[k10] + vh[k11]) / 3, false)
        t2 = tri(...p00, ...p11, ...p01, (vh[k00] + vh[k11] + vh[k01]) / 3, false)
        if (i === 0) edgeOwner.set(edgeKey(k00, k01), t2)
        if (i === G - 1) edgeOwner.set(edgeKey(k10, k11), t1)
      } else {
        t1 = tri(...p00, ...p10, ...p01, (vh[k00] + vh[k10] + vh[k01]) / 3, false)
        t2 = tri(...p10, ...p11, ...p01, (vh[k10] + vh[k11] + vh[k01]) / 3, false)
        if (i === 0) edgeOwner.set(edgeKey(k00, k01), t1)
        if (i === G - 1) edgeOwner.set(edgeKey(k10, k11), t2)
      }
      if (j === 0) edgeOwner.set(edgeKey(k00, k10), t1)
      if (j === G - 1) edgeOwner.set(edgeKey(k01, k11), t2)
    }
  }

  // Skirts. Walk each edge so that (B−A) × (down) faces away from the chunk.
  function skirt(indices: number[]) {
    for (let e = 0; e + 1 < indices.length; e++) {
      const kA = indices[e], kB = indices[e + 1]
      const [ax, ay, az] = P(kA), [bx, by, bz] = P(kB)
      const ra = Math.hypot(ax, ay, az), rb = Math.hypot(bx, by, bz)
      const fa = (ra - skirtDepth) / ra, fb = (rb - skirtDepth) / rb
      const hAvg = (vh[kA] + vh[kB]) / 2
      const s1 = tri(ax, ay, az, bx, by, bz, ax * fa, ay * fa, az * fa, hAvg, true)
      const s2 = tri(bx, by, bz, bx * fb, by * fb, bz * fb, ax * fa, ay * fa, az * fa, hAvg, true)
      const owner = edgeOwner.get(edgeKey(kA, kB))
      if (owner !== undefined) for (const st of [s1, s2]) {
        for (let q = 0; q < 9; q++) { nor[st * 9 + q] = nor[owner * 9 + (q % 3)]; col[st * 9 + q] = col[owner * 9 + (q % 3)] }
      }
      if (skirts === 'red') for (const st of [s1, s2]) for (let q = 0; q < 3; q++) { col[st * 9 + q * 3] = 1; col[st * 9 + q * 3 + 1] = 0; col[st * 9 + q * 3 + 2] = 0 }
    }
  }
  const left: number[] = [], right: number[] = [], bottom: number[] = [], top: number[] = []
  for (let j = 0; j < W; j++) { left.push(j * W); right.push((W - 1 - j) * W + G) }
  for (let i = 0; i < W; i++) { bottom.push(G - i); top.push(G * W + i) }
  if (skirts) { skirt(left); skirt(right); skirt(bottom); skirt(top) }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geom.computeBoundingSphere()
  return geom
}
