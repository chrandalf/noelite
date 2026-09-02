// Clouds you can fly under: low-poly puffs at cloud height in a field round the craft,
// seeded per cell of the cube-sphere so they stay put as you move, present and sized by
// the same weather front that rains on you. The shell (Clouds.ts) carries the cover at a
// distance and fades out near the camera, where its kilometre faces were reading as
// "large triangles" (Chris, 2026-09-02) rather than weather.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { cubeToFace, faceToUnit } from '../world/cubesphere.ts'
import { front, cloudOf } from '../world/weather.ts'
import { rng } from '../world/noise.ts'

const CELL_LEVEL = 6 // cells of ~500 m on a 40 km world
const REACH = 9000 // metres round the camera
const SITES = 3
const MAX = 4000

let shared: THREE.BufferGeometry | null = null
function puffGeometry(): THREE.BufferGeometry {
  if (!shared) { shared = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(); shared.computeVertexNormals() }
  return shared
}

export class CloudPuffs {
  readonly mesh: THREE.InstancedMesh
  private lastAt = new THREE.Vector3(Infinity, 0, 0)
  private lastTime = -Infinity
  private lastId = ''
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly pos = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly ax = new THREE.Vector3()
  private readonly d = new THREE.Vector3()
  private readonly Y = new THREE.Vector3(0, 1, 0)

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xf4f6f8 })
    mat.name = 'puff'
    this.mesh = new THREE.InstancedMesh(puffGeometry(), mat, MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  /** `at`: viewer in the body's frame. Rebuilds when you have moved 300 m, the body changed, or two seconds passed. */
  update(at: THREE.Vector3, t: Terrain, time: number): void {
    if (t.air <= 0) { this.mesh.count = 0; this.mesh.visible = false; return }
    if (t.id === this.lastId && at.distanceTo(this.lastAt) < 300 && time - this.lastTime < 2) return
    this.lastAt.copy(at); this.lastTime = time; this.lastId = t.id
    this.mesh.visible = true
    const base = t.radius + t.air * 0.6
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
        const alt = base + (next() - 0.5) * 400
        const size = 50 + 130 * next(), squash = 0.35 + 0.25 * next(), yaw = next() * Math.PI * 2
        const p = faceToUnit(face, pu, pv)
        const cover = cloudOf(front(p, t, time))
        if (cover < 0.45) continue
        const grow = 0.6 + 0.8 * (cover - 0.45) / 0.55
        this.pos.set(p.x, p.y, p.z).multiplyScalar(alt)
        this.q.setFromUnitVectors(this.Y, this.d.set(p.x, p.y, p.z)).multiply(new THREE.Quaternion().setFromAxisAngle(this.Y, yaw))
        this.sc.set(size * grow, size * grow * squash, size * grow * (0.8 + 0.4 * next()))
        this.mesh.setMatrixAt(count++, this.m.compose(this.pos, this.q, this.sc))
      }
    }
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
