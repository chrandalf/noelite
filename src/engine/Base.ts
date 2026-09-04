// The outpost: a settlement round the starting pad, seeded, built from boxes, drums and
// domes at the ship's scale (the dart is 9 m long, 6.6 m across). An apron, a ring road,
// hangars whose doors take the ship, habitat blocks stacked two and three high, domes,
// fuel tanks, a comms tower with a warning light, lamp masts and windows that come on at
// night, crates and walkways. No assets, same as the ship. Chris, 2026-09-03: "put a
// base around the starting landing pad, make it look quite densely populated and to
// scale based on the size of the ship."
import * as THREE from 'three'
import { padOf, PAD_RADIUS, type PadSite, type Terrain } from '../world/height.ts'
import { rng } from '../world/noise.ts'

export type BaseView = { group: THREE.Group; lamps: THREE.MeshBasicMaterial; windows: THREE.MeshBasicMaterial; warn: THREE.MeshBasicMaterial; dish: THREE.Object3D }

const LAMP_DAY = new THREE.Color(0x4a4638), LAMP_NIGHT = new THREE.Color(0xffe9b8)
const WIN_DAY = new THREE.Color(0x2a3440), WIN_NIGHT = new THREE.Color(0xd8e8ff)

/**
 * The base at `site` (the starting pad by default). `salt` varies the layout between
 * outposts on one body; `density` scales the building counts, so an outpost is the same
 * settlement at half the population. The apron fills the site's own flattened radius.
 */
export function buildBase(t: Terrain, site: PadSite | null = padOf(t), salt = 0, density = 1): BaseView | null {
  if (!site) return null
  const BASE_RADIUS = site.radius
  const count = (n: number) => Math.max(1, Math.round(n * density))
  const next = rng((t.seed ^ 0x42415345 ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0)
  const g = new THREE.Group()
  const mat = (colour: number, name: string) => { const m = new THREE.MeshLambertMaterial({ color: colour }); m.name = name; return m }
  const concrete = mat(0x8e9296, 'base-apron'), road = mat(0x5c6066, 'base-road'), wall = mat(0xb9bcc0, 'base-wall'), panel = mat(0x6b7078, 'base-panel')
  const accent = mat(0xd08a3a, 'base-accent'), roof = mat(0x7d8288, 'base-roof'), drum = mat(0xc9cdd1, 'base-drum'), dark = mat(0x3a3d44, 'base-dark')
  const lamps = new THREE.MeshBasicMaterial({ color: LAMP_DAY }); lamps.name = 'base-lamp'
  const windows = new THREE.MeshBasicMaterial({ color: WIN_DAY }); windows.name = 'base-window'
  const warn = new THREE.MeshBasicMaterial({ color: 0xff3030 }); warn.name = 'base-warn'

  // Apron and ring road, flush with the flattened ground; radial paths to the pad.
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(BASE_RADIUS - 8, BASE_RADIUS - 3, 0.5, 24), concrete)
  apron.position.y = -0.24
  g.add(apron)
  const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_RADIUS + 12, PAD_RADIUS + 20, 24), road)
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03
  g.add(ring)
  const outer = new THREE.Mesh(new THREE.RingGeometry(BASE_RADIUS - 34, BASE_RADIUS - 27, 32), road)
  outer.rotation.x = -Math.PI / 2; outer.position.y = 0.03
  g.add(outer)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    const path = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, BASE_RADIUS - 60), road)
    path.position.set(Math.cos(a) * (PAD_RADIUS + 16 + (BASE_RADIUS - 60) / 2), 0.04, Math.sin(a) * (PAD_RADIUS + 16 + (BASE_RADIUS - 60) / 2))
    path.rotation.y = -a
    g.add(path)
  }

  // Placement: an annulus from just outside the ring road to the apron's edge, nothing overlapping.
  const placed: { x: number; z: number; r: number }[] = []
  const place = (r: number, rMin = PAD_RADIUS + 24, rMax = BASE_RADIUS - 16): { x: number; z: number; a: number } | null => {
    for (let k = 0; k < 60; k++) {
      const a = next() * Math.PI * 2, d = rMin + r + (rMax - rMin - 2 * r) * Math.sqrt(next())
      const x = Math.cos(a) * d, z = Math.sin(a) * d
      if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 2.5)) { placed.push({ x, z, r }); return { x, z, a } }
    }
    return null
  }
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.y = ry; g.add(b); return b
  }
  const windowsOn = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number) => {
    // A row or two of lit panes on the long faces.
    const rows = Math.max(1, Math.floor(h / 3.2)), cols = Math.max(2, Math.floor(w / 2.6))
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (const side of [-1, 1]) {
      if (next() < 0.25) continue
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 0.12), windows)
      const lx = -w / 2 + (c + 0.5) * (w / cols), ly = y - h / 2 + 1.8 + r * 3.2, lz = side * (d / 2 + 0.02)
      pane.position.set(x + Math.cos(ry) * lx + Math.sin(ry) * lz, ly, z - Math.sin(ry) * lx + Math.cos(ry) * lz)
      pane.rotation.y = ry
      g.add(pane)
    }
  }

  // Two hangars, doors toward the pad, wide enough for the dart with room to spare.
  for (let i = 0; i < count(2); i++) {
    const p = place(14, PAD_RADIUS + 26, BASE_RADIUS - 30); if (!p) continue
    const ry = -p.a + Math.PI / 2
    box(24, 9, 18, wall, p.x, 4.5, p.z, ry)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 24, 12, 1, false, 0, Math.PI), roof)
    barrel.rotation.z = Math.PI / 2; barrel.rotation.y = ry; barrel.position.set(p.x, 9, p.z)
    g.add(barrel)
    // The door: a dark recess facing the pad, an orange frame, a lamp over it.
    const door = new THREE.Mesh(new THREE.BoxGeometry(12, 7.5, 0.4), dark)
    const fx = -Math.cos(p.a) * 9.2, fz = -Math.sin(p.a) * 9.2
    door.position.set(p.x + fx, 3.75, p.z + fz); door.rotation.y = ry
    g.add(door)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(13, 0.6, 0.6), accent)
    frame.position.set(p.x + fx * 1.02, 7.8, p.z + fz * 1.02); frame.rotation.y = ry
    g.add(frame)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), lamps)
    lamp.position.set(p.x + fx * 1.03, 8.5, p.z + fz * 1.03); lamp.rotation.y = ry
    g.add(lamp)
  }
  // Habitat blocks, stacked, a lighter roof slab and windows.
  for (let i = 0; i < count(30); i++) {
    const w = 6 + 8 * next(), d = 5 + 6 * next(), storeys = 1 + Math.floor(next() * 3)
    const p = place(Math.max(w, d) / 2 + 1); if (!p) continue
    const ry = next() < 0.5 ? -p.a : next() * Math.PI * 2
    let y = 0
    for (let s = 0; s < storeys; s++) {
      const h = 3.6 + 1.2 * next()
      const shrink = s === 0 ? 1 : 0.8 + 0.15 * next()
      box(w * shrink, h, d * shrink, s % 2 ? panel : wall, p.x, y + h / 2, p.z, ry)
      windowsOn(w * shrink, h, d * shrink, p.x, y + h / 2, p.z, ry)
      y += h
    }
    box(w * 0.9, 0.5, d * 0.9, roof, p.x, y + 0.25, p.z, ry)
    if (next() < 0.5) box(1.2, 2.5, 1.2, dark, p.x + 2, y + 1.6, p.z - 1.5, ry) // a vent
  }
  // Domes.
  for (let i = 0; i < count(7); i++) {
    const r = 4 + 6 * next()
    const p = place(r + 1); if (!p) continue
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? wall : drum)
    dome.position.set(p.x, 0, p.z); g.add(dome)
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 0.6), dark)
    door.position.set(p.x - Math.cos(p.a) * r, 1.5, p.z - Math.sin(p.a) * r); door.rotation.y = -p.a + Math.PI / 2
    g.add(door)
  }
  // Fuel tanks in a row, with a walkway and rails.
  {
    const p = place(12); if (p) {
      for (let i = 0; i < 4; i++) {
        const r = 2.6 + next() * 1.2, h = 7 + 3 * next()
        const ox = (i - 1.5) * 7
        const x = p.x + Math.cos(p.a + Math.PI / 2) * ox, z = p.z + Math.sin(p.a + Math.PI / 2) * ox
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), drum); tank.position.set(x, h / 2, z); g.add(tank)
        const top = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), drum); top.position.set(x, h, z); g.add(top)
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.1, r + 0.1, 0.5, 10), accent); band.position.set(x, h * 0.6, z); g.add(band)
      }
      box(30, 0.3, 2, panel, p.x, 1.2, p.z, -p.a - Math.PI / 2)
    }
  }
  // The comms tower: a mast, a dish, a red warning light on top.
  const dish = new THREE.Group()
  {
    const p = place(5, BASE_RADIUS - 60, BASE_RADIUS - 24)
    const x = p ? p.x : BASE_RADIUS * 0.45, z = p ? p.z : BASE_RADIUS * 0.3
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 34, 6), panel); mast.position.set(x, 17, z); g.add(mast)
    for (let i = 0; i < 3; i++) { const brace = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 0.3), dark); brace.position.set(x, 6 + i * 10, z); brace.rotation.y = i * 1.1; g.add(brace) }
    const d = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 3), drum)
    d.rotation.x = Math.PI; d.position.y = 1.5
    dish.add(d)
    dish.position.set(x, 27, z); dish.rotation.x = -0.6
    g.add(dish)
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), warn); light.position.set(x, 34.5, z); g.add(light)
  }
  // Lamp masts round the ring road and the edge, and approach lights up to the pad.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.15, r = i % 2 ? PAD_RADIUS + 22 : BASE_RADIUS - 24
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 8, 5), dark); post.position.set(Math.cos(a) * r, 4, Math.sin(a) * r); g.add(post)
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.7), lamps); head.position.set(Math.cos(a) * r, 8.2, Math.sin(a) * r); head.rotation.y = -a; g.add(head)
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), lamps); l.position.set(Math.cos(a) * (PAD_RADIUS + 3), 0.25, Math.sin(a) * (PAD_RADIUS + 3)); g.add(l)
  }
  // Crates and small kit, scattered near the buildings.
  for (let i = 0; i < count(70); i++) {
    const p = place(1.2, PAD_RADIUS + 20, BASE_RADIUS - 8); if (!p) continue
    const s = 1 + 1.2 * next()
    box(s, s * 0.8, s, next() < 0.3 ? accent : next() < 0.5 ? panel : dark, p.x, s * 0.4, p.z, next() * Math.PI)
  }
  // A perimeter fence: posts and a rail round the apron's edge, with two gaps for the road out.
  {
    const r = BASE_RADIUS - 11, n = 64
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      if (Math.abs(((a + 0.9) % Math.PI) - Math.PI / 2) < 0.12) continue
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.3), dark); post.position.set(Math.cos(a) * r, 1.1, Math.sin(a) * r); g.add(post)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2 * Math.PI * r / n + 0.2, 0.12, 0.12), panel)
      rail.position.set(Math.cos(a + Math.PI / n) * r, 1.9, Math.sin(a + Math.PI / n) * r); rail.rotation.y = -(a + Math.PI / n) + Math.PI / 2
      g.add(rail)
    }
  }
  // Pipes: a few long runs on low trestles between things, the way a depot looks.
  for (let i = 0; i < count(5); i++) {
    const a = next() * Math.PI * 2, r0 = PAD_RADIUS + 26 + next() * Math.max(4, BASE_RADIUS - 100), len = 25 + 40 * next()
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 6), drum)
    pipe.rotation.z = Math.PI / 2; pipe.rotation.y = -a
    pipe.position.set(Math.cos(a + 1.2) * r0, 0.9, Math.sin(a + 1.2) * r0)
    g.add(pipe)
    for (let k = -1; k <= 1; k++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), dark); leg.position.set(pipe.position.x + Math.cos(a) * k * len * 0.4, 0.45, pipe.position.z - Math.sin(a) * k * len * 0.4); g.add(leg) }
  }
  // Frame the group at the site like the pad.
  const up = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  g.position.copy(up).multiplyScalar(t.radius + site.h)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
  return { group: g, lamps, windows, warn, dish }
}

/** Night brings the lamps and windows up; the warning light blinks; the dish turns slowly. */
export function updateBase(v: BaseView, t: number, day: number): void {
  const night = 1 - Math.min(1, Math.max(0, (day - 0.15) / 0.35))
  v.lamps.color.lerpColors(LAMP_DAY, LAMP_NIGHT, night)
  v.windows.color.lerpColors(WIN_DAY, WIN_NIGHT, 0.3 + 0.7 * night)
  v.warn.color.setHex((t % 2) < 0.25 ? 0xff3030 : 0x3a0c0c)
  v.dish.rotation.y = t * 0.05
}
