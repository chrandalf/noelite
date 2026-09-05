// The ship. Six facets, two colours, no assets. Zarch's dart, more or less.
// Winding is fixed up automatically against the centroid so every face points out.
import * as THREE from 'three'
import { GUN_MUZZLE } from '../world/config.ts'

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
type Kind = 'top' | 'bottom' | 'back'
/**
 * The jet's hull (DESIGN §10l-2, research/jet-stunts-2026-09-05.md): the same five points,
 * moved. The wide dart pinches to a needle 9 m long and 1.8 m across the tail. Built as a
 * morph target of the same triangle list, so Three lerps it, and the livery stays put.
 */
const JET_V: Record<'N' | 'TL' | 'TR' | 'T' | 'B', P> = { N: [0, 0, -5.4], TL: [-0.9, 0, 3.6], TR: [0.9, 0, 3.6], T: [0, 0.75, 0.4], B: [0, -0.55, 0.4] }
/** The six hull facets, hull frame, with their livery base colour: what a wreck breaks into. */
export const HULL_FACETS: [P, P, P, P, Kind][] = [
  [N, TR, T, CREAM, 'top'], [N, T, TL, WHITE, 'top'],
  [N, TL, B, RED, 'bottom'], [N, B, TR, RED, 'bottom'],
  [TR, TL, T, DARK, 'back'], [TL, TR, B, DARK, 'back'],
]

export function buildCraftGeometry(): THREE.BufferGeometry {
  const faces = HULL_FACETS
  const centroid = new THREE.Vector3()
  for (const p of [N, TL, TR, T, B]) centroid.add(new THREE.Vector3(...p))
  centroid.divideScalar(5)
  // The jet's points, keyed by the dart's, so a facet built on the dart can be rebuilt on the jet triangle for triangle.
  const jetOf = new Map<P, P>([[N, JET_V.N], [TL, JET_V.TL], [TR, JET_V.TR], [T, JET_V.T], [B, JET_V.B]])
  const jetCentroid = new THREE.Vector3()
  for (const p of Object.values(JET_V)) jetCentroid.add(new THREE.Vector3(...p))
  jetCentroid.divideScalar(5)

  const pos: number[] = [], nor: number[] = [], col: number[] = []
  const jpos: number[] = [], jnor: number[] = []
  const n = new THREE.Vector3(), mid = new THREE.Vector3(), jn = new THREE.Vector3()
  // The dart decides the winding and the colour; the jet's triangle takes the same order, so the morph never twists a face.
  const emit = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: P, ja: THREE.Vector3, jb: THREE.Vector3, jc: THREE.Vector3) => {
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centroid)
    const flip = n.dot(mid) < 0
    const order = flip ? [a, c, b] : [a, b, c]
    const jorder = flip ? [ja, jc, jb] : [ja, jb, jc]
    if (flip) n.negate()
    jn.crossVectors(jorder[1].clone().sub(jorder[0]), jorder[2].clone().sub(jorder[0])).normalize()
    if (jn.dot(mid.copy(ja).add(jb).add(jc).divideScalar(3).sub(jetCentroid)) < 0) jn.negate()
    for (let i = 0; i < 3; i++) { const v = order[i], jv = jorder[i]; pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(...colour); jpos.push(jv.x, jv.y, jv.z); jnor.push(jn.x, jn.y, jn.z) }
  }
  const paint = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, base: P, kind: Kind, ja: THREE.Vector3, jb: THREE.Vector3, jc: THREE.Vector3) => {
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3
    let colour: P = base
    if (kind === 'top' && cz < -1.9 && Math.abs(cx) < 0.7) colour = GLASS
    else if (kind === 'top' && Math.abs(cx) < 0.3) colour = NAVY
    else if (kind === 'bottom' && Math.abs(cx) < 0.3) colour = STRIPE
    const k = 1 + 0.05 * jitter(cx, cy, cz)
    emit(a, b, c, [colour[0] * k, colour[1] * k, colour[2] * k], ja, jb, jc)
  }
  const split = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, level: number, base: P, kind: Kind, ja: THREE.Vector3, jb: THREE.Vector3, jc: THREE.Vector3) => {
    if (level === 0) { paint(a, b, c, base, kind, ja, jb, jc); return }
    const ab = a.clone().lerp(b, 0.5), bc = b.clone().lerp(c, 0.5), ca = c.clone().lerp(a, 0.5)
    const jab = ja.clone().lerp(jb, 0.5), jbc = jb.clone().lerp(jc, 0.5), jca = jc.clone().lerp(ja, 0.5)
    split(a, ab, ca, level - 1, base, kind, ja, jab, jca); split(ab, b, bc, level - 1, base, kind, jab, jb, jbc)
    split(ca, bc, c, level - 1, base, kind, jca, jbc, jc); split(ab, bc, ca, level - 1, base, kind, jab, jbc, jca)
  }
  for (const [pa, pb, pc, colour, kind] of faces) split(new THREE.Vector3(...pa), new THREE.Vector3(...pb), new THREE.Vector3(...pc), 2, colour, kind, new THREE.Vector3(...jetOf.get(pa)!), new THREE.Vector3(...jetOf.get(pb)!), new THREE.Vector3(...jetOf.get(pc)!))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(jpos, 3)]
  g.morphAttributes.normal = [new THREE.Float32BufferAttribute(jnor, 3)]
  return g
}

/** Flat triangles from a vertex list, one colour, both sides lit: the jet's wings, fins and canopy. */
function plates(tris: P[][], colour: P): THREE.Mesh {
  const pos: number[] = []
  for (const [a, b, c] of tris) pos.push(...a, ...b, ...c)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour[0], colour[1], colour[2]), side: THREE.DoubleSide })
  m.name = 'jet-plate'
  return new THREE.Mesh(g, m)
}
const mirror = (tris: P[][]): P[][] => tris.map((t) => t.map(([x, y, z]) => [-x, y, z] as P))

export type Rcs = { left: THREE.Mesh; right: THREE.Mesh; top: THREE.Mesh; rear: THREE.Mesh }
/** Three landing legs, each a group hinged at the hull; scale.y is how far down it is (1 down, ~0 up). */
export type Gear = THREE.Group[]
/**
 * The TIE morph. Chris, 2026-09-03: "the ship should morph into a different shape when it
 * goes into space, more like a tie fighter." Four wing panels hinged at the wingtips (an
 * upper and a lower each side) lie folded into the wing in air and swing out to vertical
 * in cruise; two boosters slide out of the back and carry the cruise flame. main drives
 * `set(morph)` from the craft's cruise flag, 0 dart, 1 TIE.
 */
export type Morph = { set: (m: number) => void; /** The jet form, 0 dart to 1 jet: the hull's morph target, wings, fins, canopy, intake, the nozzles at the tail. */ jet: (k: number) => void; cruiseFlames: THREE.Mesh[]; flashes: THREE.Mesh[] }

/** Ship plus an engine flame that shows while thrusting, and four small RCS puffs. */
export function buildCraftMesh(material: THREE.Material): { root: THREE.Group; flame: THREE.Mesh; rcs: Rcs; gear: Gear; morph: Morph; strobe: THREE.Mesh; glowMats: THREE.MeshLambertMaterial[]; plasma: THREE.Mesh; haze: THREE.Mesh } {
  const root = new THREE.Group()
  const hull = new THREE.Mesh(buildCraftGeometry(), material)
  hull.updateMorphTargets()
  root.add(hull)
  // Trim: two engine nozzles on the back face and the navigation lights on the wingtips.
  const metal = new THREE.MeshLambertMaterial({ color: 0x2c2f36 })
  metal.name = 'nozzle'
  const nozzles: THREE.Mesh[] = []
  for (const x of [-1.0, 1.0]) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 6), metal)
    noz.position.set(x, 0.2, 2.55); noz.rotation.x = Math.PI / 2
    root.add(noz)
    nozzles.push(noz)
  }
  // The jet's parts (research/jet-stunts-2026-09-05.md): 45° swept wings, the LERX sliver, twin
  // canted fins, small stabilators, a five-point canopy and a chin intake. All folded flat
  // into the hull at k = 0 and out at k = 1.
  const wingL: P[][] = [[[-0.7, -0.05, -0.8], [-3.5, -0.05, 2.0], [-3.5, -0.05, 2.9]], [[-0.7, -0.05, -0.8], [-3.5, -0.05, 2.9], [-0.8, -0.05, 3.5]]]
  const lerxL: P[][] = [[[-0.7, -0.05, -0.8], [-0.34, -0.05, -3.6], [-0.5, -0.05, -0.8]]]
  const finL: P[][] = [[[-0.75, 0.35, 1.8], [-0.85, 0.35, 3.5], [-1.55, 2.05, 3.1]]]
  const stabL: P[][] = [[[-0.9, 0.0, 2.9], [-2.2, 0.0, 3.9], [-0.95, 0.0, 3.6]]]
  const cF: P = [0, 0.42, -3.4], cT: P = [0, 0.95, -1.9], cR: P = [0, 0.62, -0.4], cL: P = [-0.42, 0.55, -1.6], cRt: P = [0.42, 0.55, -1.6]
  const canopyTris: P[][] = [[cF, cL, cT], [cF, cT, cRt], [cT, cL, cR], [cT, cR, cRt], [cF, cRt, cL], [cR, cL, cRt]]
  const intakeTris: P[][] = [[[-0.55, -0.45, -2.6], [0.55, -0.45, -2.6], [0.55, -0.45, -1.6]], [[-0.55, -0.45, -2.6], [0.55, -0.45, -1.6], [-0.55, -0.45, -1.6]]]
  const wings = plates([...wingL, ...mirror(wingL)], WHITE)
  const lerx = plates([...lerxL, ...mirror(lerxL)], DARK)
  const fins = plates([...finL, ...mirror(finL)], CREAM)
  const stabs = plates([...stabL, ...mirror(stabL)], WHITE)
  const canopy = plates(canopyTris, GLASS)
  const intake = plates(intakeTris, DARK)
  const jetParts = [wings, lerx, fins, stabs, canopy, intake]
  for (const p of jetParts) { p.visible = false; root.add(p) }
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
  // A white anti-collision strobe on the spine, flashed by main.
  const strobe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  ;(strobe.material as THREE.Material).name = 'strobe'
  strobe.position.set(0, 1.22, 1.0)
  strobe.visible = false
  root.add(strobe)
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
  // Wing panels. Each is a hexagonal plate on a hinge at the wingtip, extending along
  // its own +y (upper) or -y (lower). Folded, it is rotated flat into the wing and scaled
  // to a stub so the dart stays a dart; unfolded, it stands vertical and full size.
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x23262d })
  panelMat.name = 'panel'
  const sparMat = new THREE.MeshLambertMaterial({ color: 0x5a5e68 })
  sparMat.name = 'spar'
  const panels: { g: THREE.Group; fold: number }[] = []
  const panel = (x: number, dir: 1 | -1) => {
    const g = new THREE.Group()
    g.position.set(x, 0.05, 1.7)
    const hex = new THREE.CylinderGeometry(1.55, 1.55, 0.12, 6)
    hex.rotateZ(Math.PI / 2)                             // hexagon in the y-z plane, thin along x
    hex.rotateX(Math.PI / 6)                             // a point up and down, flats fore and aft
    const plate = new THREE.Mesh(hex, panelMat)
    plate.position.y = dir * 1.75
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.3, 5), sparMat)
    spar.position.set(dir * 0.0, dir * 1.65, 0)
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.9), sparMat)
    rib.position.y = dir * 1.75
    g.add(plate, spar, rib)
    root.add(g)
    // Fold: swing the panel's own axis (±y) inward to lie along the wing (toward x = 0).
    const inward = x < 0 ? 1 : -1                       // +x for the left tip, -x for the right
    const fold = -dir * inward * Math.PI / 2
    panels.push({ g, fold })
  }
  panel(-3.3, 1); panel(-3.3, -1); panel(3.3, 1); panel(3.3, -1)
  // Boosters: two drums that live inside the tail and slide out the back in cruise.
  const boosters: THREE.Mesh[] = []
  const cruiseFlames: THREE.Mesh[] = []
  for (const x of [-1.0, 1.0]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.5, 6), metal)
    b.position.set(x, 0.2, 1.85); b.rotation.x = Math.PI / 2
    root.add(b); boosters.push(b)
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.2, 6), flameMat)
    f.rotation.x = Math.PI / 2                           // apex backwards, out of the nozzle
    f.visible = false
    root.add(f); cruiseFlames.push(f)
  }
  // Cannons: two barrels under the wings that slide forward out of the hull with the morph,
  // muzzles at GUN_MUZZLE (Craft fires from the same points), a flash cone at each.
  // Chris, 2026-09-03: "can they actually be seen from guns that come out and look like
  // they're firing, this should also only be possible in tie fighter mode."
  const barrels: THREE.Group[] = []
  const flashes: THREE.Mesh[] = []
  for (const x of [-GUN_MUZZLE.x, GUN_MUZZLE.x]) {
    const g = new THREE.Group()
    g.position.set(x, GUN_MUZZLE.y, 0.4)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.2, 6), metal)
    barrel.rotation.x = Math.PI / 2
    barrel.position.z = -1.6
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.5, 6), sparMat)
    muzzle.rotation.x = Math.PI / 2
    muzzle.position.z = -3.0
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.9), sparMat)
    mount.position.set(0, 0.3, 0.1)
    g.add(barrel, muzzle, mount)
    root.add(g)
    barrels.push(g)
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 6), flameMat)
    fl.rotation.x = -Math.PI / 2       // apex forward
    fl.position.set(x, GUN_MUZZLE.y, GUN_MUZZLE.z - 0.7)
    fl.visible = false
    root.add(fl)
    flashes.push(fl)
  }
  let jetK = 0
  const morph: Morph = {
    cruiseFlames,
    flashes,
    jet: (k: number) => {
      const t = Math.min(1, Math.max(0, k))
      jetK = t
      if (hull.morphTargetInfluences) hull.morphTargetInfluences[0] = t
      const on = t > 0.05
      for (const p of jetParts) p.visible = on
      wings.scale.x = 0.04 + 0.96 * t
      lerx.scale.x = wings.scale.x
      fins.scale.y = 0.02 + 0.98 * t
      stabs.scale.x = 0.05 + 0.95 * t
      canopy.scale.y = t
      intake.scale.z = 0.1 + 0.9 * t
      // The nozzles walk back to the tail and grow; in the jet the cruise flames come out of them.
      for (let i = 0; i < nozzles.length; i++) {
        const x = (i === 0 ? -1 : 1) * (1.0 - 0.5 * t)
        nozzles[i].position.set(x, 0.2 - 0.15 * t, 2.55 + 1.15 * t)
        nozzles[i].scale.setScalar(1 + 0.6 * t)
        if (t > 0.5) cruiseFlames[i].position.set(x, 0.05, 3.7 + 0.75)
      }
    },
    set: (m: number) => {
      const t = Math.min(1, Math.max(0, m))
      for (const { g, fold } of panels) {
        g.rotation.z = fold * (1 - t)
        g.scale.y = 0.05 + 0.95 * t
        g.scale.z = 0.25 + 0.75 * t
      }
      for (let i = 0; i < boosters.length; i++) {
        boosters[i].position.z = 1.85 + 1.55 * t
        if (jetK <= 0.5) cruiseFlames[i].position.set(boosters[i].position.x, 0.2, boosters[i].position.z + 0.75 + 1.6)
      }
      // Barrels slide forward out of the wing: stowed they sit inside the hull, scaled to a stub.
      for (const b of barrels) { b.position.z = 2.4 - 2.0 * t; b.scale.z = 0.12 + 0.88 * t; b.visible = t > 0.05 }
    },
  }
  morph.set(0)
  // Re-entry: the hull glow spreads to the panels, spars, nozzles and legs (main drives
  // emissive on all of these), and a plasma streak trails behind the ship.
  const glowMats = [panelMat, sparMat, metal, legMat]
  const plasmaGeo = new THREE.ConeGeometry(1, 1, 8, 1, true)
  plasmaGeo.rotateX(Math.PI / 2)      // apex backwards (+z); base at the hull
  plasmaGeo.translate(0, 0, 0.5)
  const plasmaMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  plasmaMat.name = 'plasma'
  const plasma = new THREE.Mesh(plasmaGeo, plasmaMat)
  plasma.position.set(0, 0.2, 2.2)
  plasma.visible = false
  root.add(plasma)
  // Hot exhaust under the hover engine: a faint additive cone that flickers. Not a true
  // shimmer (that needs a distortion pass), but it reads as hot air.
  const hazeGeo = new THREE.ConeGeometry(2.4, 9, 8, 1, true)
  hazeGeo.translate(0, -4.5, 0)       // apex at the nozzle, opening downward
  const hazeMat = new THREE.MeshBasicMaterial({ color: 0xffc890, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  hazeMat.name = 'haze'
  const haze = new THREE.Mesh(hazeGeo, hazeMat)
  haze.position.set(0, -0.9, 0.9)
  haze.visible = false
  root.add(haze)
  return { root, flame, rcs, gear, morph, strobe, glowMats, plasma, haze }
}
