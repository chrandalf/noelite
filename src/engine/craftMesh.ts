// The ship. Six facets, two colours, no assets. Zarch's dart, more or less.
// Winding is fixed up automatically against the centroid so every face points out.
import * as THREE from 'three'

type P = [number, number, number]
const N: P = [0, 0, -4.6]        // nose
const TL: P = [-3.3, 0, 2.6]     // tail left
const TR: P = [3.3, 0, 2.6]      // tail right
const T: P = [0, 1.15, 0.9]      // spine
const B: P = [0, -0.75, 0.9]     // keel

const WHITE: P = [0.94, 0.94, 0.97]
const CREAM: P = [0.86, 0.86, 0.88]   // starboard top a shade off, so the spine reads
const RED: P = [0.86, 0.16, 0.13]
const DARK: P = [0.40, 0.42, 0.48]    // engine face; mid grey, never black in shadow

export function buildCraftGeometry(): THREE.BufferGeometry {
  const faces: [P, P, P, P][] = [
    [N, TR, T, CREAM], [N, T, TL, WHITE],   // top
    [N, TL, B, RED], [N, B, TR, RED],       // bottom
    [TR, TL, T, DARK], [TL, TR, B, DARK],   // back
  ]
  const centroid = new THREE.Vector3()
  for (const p of [N, TL, TR, T, B]) centroid.add(new THREE.Vector3(...p))
  centroid.divideScalar(5)

  const pos: number[] = [], nor: number[] = [], col: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3()
  for (const [pa, pb, pc, colour] of faces) {
    a.set(...pa); b.set(...pb); c.set(...pc)
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centroid)
    const order = n.dot(mid) >= 0 ? [a, b, c] : [a, c, b]
    if (n.dot(mid) < 0) n.negate()
    for (const v of order) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(...colour) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

/** Ship plus an engine flame that shows while thrusting. */
export function buildCraftMesh(material: THREE.Material): { root: THREE.Group; flame: THREE.Mesh } {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(buildCraftGeometry(), material))
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 2.6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffa040 }),
  )
  flame.position.set(0, -1.9, 0.9)
  flame.rotation.x = Math.PI
  flame.visible = false
  root.add(flame)
  return { root, flame }
}
