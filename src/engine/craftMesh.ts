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

const NAVY: P = [0.10, 0.16, 0.34]    // the stripe down the spine
const GLASS: P = [0.10, 0.20, 0.30]   // canopy
const STRIPE: P = [0.96, 0.96, 0.98]  // underside stripe

/** Deterministic [-1, 1] from a point, for panel shading. */
function jitter(x: number, y: number, z: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return (v - Math.floor(v)) * 2 - 1
}

/**
 * Livery, not textures: the game is flat polygons and no assets. Each hull face is
 * split into sixteen panels shaded a few percent apart so the surface reads as plate,
 * a navy stripe runs down the spine, the nose has a tinted canopy, the belly a white
 * stripe. Chris, 2026-09-02: "put some textures on the ship make it look snazzy".
 */
export function buildCraftGeometry(): THREE.BufferGeometry {
  type Kind = 'top' | 'bottom' | 'back'
  const faces: [P, P, P, P, Kind][] = [
    [N, TR, T, CREAM, 'top'], [N, T, TL, WHITE, 'top'],
    [N, TL, B, RED, 'bottom'], [N, B, TR, RED, 'bottom'],
    [TR, TL, T, DARK, 'back'], [TL, TR, B, DARK, 'back'],
  ]
  const centroid = new THREE.Vector3()
  for (const p of [N, TL, TR, T, B]) centroid.add(new THREE.Vector3(...p))
  centroid.divideScalar(5)

  const pos: number[] = [], nor: number[] = [], col: number[] = []
  const n = new THREE.Vector3(), mid = new THREE.Vector3()
  const emit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: P) => {
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centroid)
    const order = n.dot(mid) >= 0 ? [a, b, c] : [a, c, b]
    if (n.dot(mid) < 0) n.negate()
    for (const v of order) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(...colour) }
  }
  const paint = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, base: P, kind: Kind) => {
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3
    let colour: P = base
    if (kind === 'top' && cz < -1.9 && Math.abs(cx) < 0.7) colour = GLASS
    else if (kind === 'top' && Math.abs(cx) < 0.3) colour = NAVY
    else if (kind === 'bottom' && Math.abs(cx) < 0.3) colour = STRIPE
    const k = 1 + 0.05 * jitter(cx, cy, cz)
    emit(a, b, c, [colour[0] * k, colour[1] * k, colour[2] * k])
  }
  const split = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, level: number, base: P, kind: Kind) => {
    if (level === 0) { paint(a, b, c, base, kind); return }
    const ab = a.clone().lerp(b, 0.5), bc = b.clone().lerp(c, 0.5), ca = c.clone().lerp(a, 0.5)
    split(a, ab, ca, level - 1, base, kind); split(ab, b, bc, level - 1, base, kind)
    split(ca, bc, c, level - 1, base, kind); split(ab, bc, ca, level - 1, base, kind)
  }
  for (const [pa, pb, pc, colour, kind] of faces) split(new THREE.Vector3(...pa), new THREE.Vector3(...pb), new THREE.Vector3(...pc), 2, colour, kind)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

export type Rcs = { left: THREE.Mesh; right: THREE.Mesh; top: THREE.Mesh; rear: THREE.Mesh }
/** Three landing legs, each a group hinged at the hull; scale.y is how far down it is (1 down, ~0 up). */
export type Gear = THREE.Group[]

/** Ship plus an engine flame that shows while thrusting, and four small RCS puffs. */
export function buildCraftMesh(material: THREE.Material): { root: THREE.Group; flame: THREE.Mesh; rcs: Rcs; gear: Gear } {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(buildCraftGeometry(), material))
  // Trim: two engine nozzles on the back face and the navigation lights on the wingtips.
  const metal = new THREE.MeshLambertMaterial({ color: 0x2c2f36 })
  metal.name = 'nozzle'
  for (const x of [-1.0, 1.0]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 6), metal)
    noz.position.set(x, 0.2, 2.55); noz.rotation.x = Math.PI / 2
    root.add(noz)
  }
  // Landing skids: the craft's centre sits HULL_CLEARANCE (1.6 m) above the ground and the
  // keel is only 0.75 m down, so without legs it hangs in the air over its own shadow
  // (Chris, 2026-09-02: "looks like it's not quite on the ground"). Three legs to -1.6.
  // They retract above 100 m over the ground (Chris, 2026-09-02): each leg is a group hinged
  // at the hull and main drives its scale.y from 1 (down) toward 0 (up).
  const legMat = new THREE.MeshLambertMaterial({ color: 0x3a3d44 })
  legMat.name = 'leg'
  const gear: Gear = []
  const leg = (x: number, z: number, top: number) => {
    const h = top + 1.6
    const g = new THREE.Group()
    g.position.set(x, top, z)
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, h, 5), legMat)
    l.position.y = -h / 2
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 6), legMat)
    foot.position.y = -h + 0.05
    g.add(l, foot)
    root.add(g)
    gear.push(g)
  }
  leg(0, -2.6, -0.35); leg(-2.2, 1.9, -0.25); leg(2.2, 1.9, -0.25)
  const lamp = (x: number, colour: number) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 4), new THREE.MeshBasicMaterial({ color: colour }))
    ;(m.material as THREE.Material).name = 'lamp'
    m.position.set(x, 0.12, 2.4)
    root.add(m)
  }
  lamp(-3.2, 0xff2a2a); lamp(3.2, 0x2aff55)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 })
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 6), flameMat)
  flame.position.set(0, -2.3, 0.9)
  flame.rotation.x = Math.PI
  flame.visible = false
  root.add(flame)
  // A puff points AWAY from the direction it pushes: the left thruster fires out of the left side to push you right.
  const puff = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.2, 5), flameMat)
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.visible = false
    root.add(m); return m
  }
  const rcs: Rcs = {
    left: puff(-3.6, 0, 2.2, 0, 0, Math.PI / 2),    // fires out to the left, pushes right
    right: puff(3.6, 0, 2.2, 0, 0, -Math.PI / 2),   // fires out to the right, pushes left
    top: puff(0, 1.8, 0.9, 0, 0, 0),                // fires up, pushes down
    rear: puff(0, 0, 3.3, Math.PI / 2, 0, 0),       // fires backward, pushes forward
  }
  return { root, flame, rcs, gear }
}
