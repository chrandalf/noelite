// Clouds you can fly under. Chris, 2026-09-02, after the first version: "like someone has
// been blowing bubbles, we need them to be proper weather systems." So: cumulus, not
// balls. Each seeded site grows a cluster of overlapping lobes, their bottoms clamped to
// the cloud base (a cumulus is flat underneath, at the height where the air condenses),
// tops lumpy. The number of lobes and their spread grow with cover, so heavy cover merges
// into a continuous deck, and a finer field inside each system breaks that deck into
// masses, streets and gaps. Sites are seeded per cube-sphere cell so they stay put as
// you move. The shell (Clouds.ts) carries the cover at a distance and fades out near.
import * as THREE from 'three'
import { CLOUD_BASE_FRAC } from '../world/config.ts'
import { groundRadius } from '../world/terrain.ts'
import type { Terrain } from '../world/height.ts'
import { cubeToFace, faceToUnit } from '../world/cubesphere.ts'
import { cloudCover } from '../world/weather.ts'
import { rng } from '../world/noise.ts'

const CELL_LEVEL = 6 // cells of ~500 m on a 40 km world
const REACH = 7500 // metres round the camera
const SITES = 3
const MAX_SITES = 400
const MAX = 9000
const SQUASH = 0.42

let shared: THREE.BufferGeometry | null = null
/** One lobe: a low-poly ball, white on top shading to grey underneath. */
function lobeGeometry(): THREE.BufferGeometry {
  if (shared) return shared
  const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  // Cut flat underneath: a cumulus is level at the base, where the air condenses, and
  // lumpy on top. Everything below the cut folds up onto it.
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.08) pos.setY(i, -0.08)
  pos.needsUpdate = true
  g.computeVertexNormals()
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = Math.min(1, Math.max(0, (y + 0.3) / 0.9))
    const k = 0.66 + 0.32 * t * t * (3 - 2 * t)
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 1.02
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  shared = g
  return g
}

export class CloudPuffs {
  readonly mesh: THREE.InstancedMesh
  private lastAt = new THREE.Vector3(Infinity, 0, 0)
  private lastTime = -Infinity
  private lastId = ''
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly yaw = new THREE.Quaternion()
  private readonly pos = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly ax = new THREE.Vector3()
  private readonly d = new THREE.Vector3()
  private readonly site = new THREE.Vector3()
  private readonly s1 = new THREE.Vector3()
  private readonly s2 = new THREE.Vector3()
  private readonly Y = new THREE.Vector3(0, 1, 0)

  /** One dark disc on the ground under each cloudy site: the cluster's shadow. */
  readonly shadows: THREE.InstancedMesh

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
    mat.name = 'cloud'
    this.mesh = new THREE.InstancedMesh(lobeGeometry(), mat, MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    shadowMat.name = 'cloud-shadow'
    const disc = new THREE.CircleGeometry(1, 14)
    disc.rotateX(-Math.PI / 2)          // flat, facing +y, so the site's up quaternion lays it on the ground
    this.shadows = new THREE.InstancedMesh(disc, shadowMat, MAX_SITES)
    this.shadows.count = 0
    this.shadows.frustumCulled = false
    this.shadows.renderOrder = 1
  }
  private readonly sq = new THREE.Quaternion()
  private readonly ss = new THREE.Vector3()
  private readonly sp = new THREE.Vector3()

  /** `at`: viewer in the body's frame. Rebuilds when you have moved 300 m, the body changed, or two seconds passed. */
  update(at: THREE.Vector3, t: Terrain, time: number): void {
    if (t.air <= 0) { this.mesh.count = 0; this.mesh.visible = false; this.shadows.count = 0; this.shadows.visible = false; return }
    if (t.id === this.lastId && at.distanceTo(this.lastAt) < 300 && time - this.lastTime < 2) return
    this.lastAt.copy(at); this.lastTime = time; this.lastId = t.id
    this.mesh.visible = true
    this.shadows.visible = true
    let nShadow = 0
    const base = t.radius + t.air * CLOUD_BASE_FRAC
    this.up.copy(at).normalize()
    this.ax.set(Math.abs(this.up.x) < 0.9 ? 1 : 0, Math.abs(this.up.x) < 0.9 ? 0 : 1, 0)
    this.t1.crossVectors(this.ax, this.up).normalize()
    this.t2.crossVectors(this.up, this.t1)
    const s = 2 / 2 ** CELL_LEVEL
    const cellMetres = s * 0.8 * t.radius
    const n = Math.ceil(REACH / cellMetres)
    const seen = new Set<string>()
    let count = 0
    for (let i = -n; i <= n && count < MAX; i++) for (let j = -n; j <= n && count < MAX; j++) {
      if (i * i + j * j > n * n) continue
      this.d.copy(this.up).addScaledVector(this.t1, (i * cellMetres) / t.radius).addScaledVector(this.t2, (j * cellMetres) / t.radius).normalize()
      const { face, u, v } = cubeToFace(this.d.x, this.d.y, this.d.z)
      const ix = Math.floor((u + 1) / s), iy = Math.floor((v + 1) / s)
      const key = `${face}:${ix}:${iy}`
      if (seen.has(key)) continue
      seen.add(key)
      const next = rng((t.seed ^ Math.imul(face + 1, 0x9e3779b1) ^ Math.imul(ix + 3, 0x85ebca6b) ^ Math.imul(iy + 5, 0xc2b2ae35)) >>> 0)
      for (let k = 0; k < SITES && count < MAX; k++) {
        const pu = -1 + (ix + next()) * s, pv = -1 + (iy + next()) * s
        const p = faceToUnit(face, pu, pv)
        this.site.set(p.x, p.y, p.z)
        // The site's own tangent frame.
        this.ax.set(Math.abs(this.site.x) < 0.9 ? 1 : 0, Math.abs(this.site.x) < 0.9 ? 0 : 1, 0)
        this.s1.crossVectors(this.ax, this.site).normalize()
        this.s2.crossVectors(this.site, this.s1)
        // Consume the site's randoms whether or not it is cloudy, so the cluster is stable as the front moves.
        const seedA = next(), seedB = next(), seedC = next()
        const cover = cloudCover(this.site, t, time)
        if (cover < 0.22) continue
        const grow = (cover - 0.22) / 0.78
        const lobes = 4 + Math.round(8 * grow)
        const spread = 90 + 220 * grow
        const big = 95 + 120 * grow
        // The shadow: a disc the size of the deck, on the ground straight under the site.
        if (nShadow < MAX_SITES) {
          this.sp.copy(this.site).multiplyScalar(groundRadius(this.site, t) + 2.5)
          this.sq.setFromUnitVectors(this.Y, this.site)
          const rad = (spread + big * 0.6) * (0.9 + 0.3 * grow)
          this.ss.set(rad * (1 + 0.5 * Math.abs(Math.cos(seedC * Math.PI))), 1, rad * (1 + 0.5 * Math.abs(Math.sin(seedC * Math.PI))))
          this.shadows.setMatrixAt(nShadow++, this.m.compose(this.sp, this.sq, this.ss))
        }
        const local = rng((seedA * 4294967296) >>> 0 ^ Math.floor(seedB * 65536))
        const street = seedC * Math.PI // clusters stretch along one heading, the way streets do
        for (let l = 0; l < lobes && count < MAX; l++) {
          const a = local() * Math.PI * 2, r = spread * Math.sqrt(local())
          const ox = Math.cos(a) * r * (1 + 0.6 * Math.cos(street)), oy = Math.sin(a) * r * (1 + 0.6 * Math.sin(street))
          const size = big * (0.6 + 0.4 * local()) * (1 - 0.3 * (r / spread))
          const h = size * SQUASH
          this.d.copy(this.site).addScaledVector(this.s1, ox / t.radius).addScaledVector(this.s2, oy / t.radius).normalize()
          // Flat base: the cut underside of every lobe sits on the cloud base, so a cluster is one deck.
          this.pos.copy(this.d).multiplyScalar(base + h * 0.08 + 6 * local())
          this.q.setFromUnitVectors(this.Y, this.d)
          this.yaw.setFromAxisAngle(this.Y, local() * Math.PI * 2)
          this.q.multiply(this.yaw)
          this.sc.set(size * (0.85 + 0.3 * local()), h, size * (0.85 + 0.3 * local()))
          this.mesh.setMatrixAt(count++, this.m.compose(this.pos, this.q, this.sc))
        }
      }
    }
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    this.shadows.count = nShadow
    this.shadows.instanceMatrix.needsUpdate = true
  }
}
