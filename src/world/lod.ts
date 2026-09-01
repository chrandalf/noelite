// Per-face quadtree. Each frame: decide which leaves the camera wants, diff
// against what is live, retire the extras, and build the missing ones inside
// a budget so a descent never hitches. Chunks fully beyond the horizon are
// not visited at all, which is what keeps the live count bounded.
import * as THREE from 'three'
import { FACES, faceToUnit, type Face } from './cubesphere.ts'
import { height, type PlanetSeed } from './height.ts'
import { PLANET_RADIUS } from './config.ts'
import { buildChunk, chunkBounds, chunkKey, type ChunkKey, type SkirtMode } from './chunk.ts'

export const MAX_LEVEL = 6
/** A chunk splits when the camera is closer than this many chunk-widths. */
export const SPLIT_K = 2.2
const BUILD_BUDGET = 6

type Want = { f: Face; level: number; ix: number; iy: number }

export class PlanetLOD {
  readonly group = new THREE.Group()
  private readonly live = new Map<ChunkKey, THREE.Mesh>()
  private readonly queue: Want[] = []
  private readonly queued = new Set<ChunkKey>()

  private readonly seed: PlanetSeed
  private readonly material: THREE.Material
  private readonly skirts: SkirtMode

  /** `skirts: false` is a debug switch: it makes LOD cracks visible on purpose. */
  constructor(seed: PlanetSeed, material: THREE.Material, skirts: SkirtMode = true) {
    // Explicit fields, not parameter properties: tools/*.mjs import this file
    // through Node's strip-only TypeScript, which rejects parameter properties.
    this.seed = seed
    this.material = material
    this.skirts = skirts
  }

  get liveCount(): number { return this.live.size }
  get pendingCount(): number { return this.queue.length }

  /** Levels currently on screen, for the HUD and the harness. */
  levelRange(): [number, number] {
    let lo = Infinity, hi = -Infinity
    for (const k of this.live.keys()) { const l = Number(k.split(':')[1]); if (l < lo) lo = l; if (l > hi) hi = l }
    return this.live.size ? [lo, hi] : [0, 0]
  }

  update(cam: THREE.Vector3): void {
    const wanted = new Map<ChunkKey, Want>()
    const camDist = cam.length()
    // Angle from the sub-camera point to the horizon, plus slack for terrain height.
    const horizon = Math.acos(Math.min(1, PLANET_RADIUS / Math.max(camDist, PLANET_RADIUS + 1))) + 0.08
    for (const f of FACES) this.visit(f, 0, 0, 0, cam, camDist, horizon, wanted)

    for (const [k, mesh] of this.live) {
      if (wanted.has(k)) continue
      this.group.remove(mesh)
      mesh.geometry.dispose()
      this.live.delete(k)
    }
    // Anything queued that is no longer wanted drops out of the queue.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const w = this.queue[i]
      const k = chunkKey(w.f, w.level, w.ix, w.iy)
      if (!wanted.has(k)) { this.queue.splice(i, 1); this.queued.delete(k) }
    }
    for (const [k, w] of wanted) {
      if (this.live.has(k) || this.queued.has(k)) continue
      this.queue.push(w); this.queued.add(k)
    }
    // Nearest first, so what is under you arrives before the horizon does.
    if (this.queue.length > 1) {
      const d = (w: Want) => { const { u0, v0, s } = chunkBounds(w.level, w.ix, w.iy); const p = faceToUnit(w.f, u0 + s / 2, v0 + s / 2); return -(p.x * cam.x + p.y * cam.y + p.z * cam.z) }
      this.queue.sort((a, b) => d(a) - d(b))
    }
    let built = 0
    while (this.queue.length && built < BUILD_BUDGET) {
      const w = this.queue.shift()!
      const k = chunkKey(w.f, w.level, w.ix, w.iy)
      this.queued.delete(k)
      const mesh = new THREE.Mesh(buildChunk(w.f, w.level, w.ix, w.iy, this.seed, this.skirts), this.material)
      mesh.frustumCulled = true
      this.group.add(mesh)
      this.live.set(k, mesh)
      built++
    }
  }

  private visit(f: Face, level: number, ix: number, iy: number, cam: THREE.Vector3, camDist: number, horizon: number, wanted: Map<ChunkKey, Want>): void {
    const { u0, v0, s } = chunkBounds(level, ix, iy)
    const dir = faceToUnit(f, u0 + s / 2, v0 + s / 2)
    // Generous angular radius of the chunk, in radians. Exact at the face
    // centre, an over-estimate toward the corners, which is the safe direction.
    const angRad = s * 0.8
    const cosToCam = (dir.x * cam.x + dir.y * cam.y + dir.z * cam.z) / camDist
    const theta = Math.acos(Math.min(1, Math.max(-1, cosToCam)))
    if (theta - angRad > horizon) return // entirely over the horizon

    if (level < MAX_LEVEL) {
      const h = height(dir, this.seed)
      const r = PLANET_RADIUS + h
      const dx = cam.x - dir.x * r, dy = cam.y - dir.y * r, dz = cam.z - dir.z * r
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < SPLIT_K * angRad * PLANET_RADIUS) {
        this.visit(f, level + 1, ix * 2, iy * 2, cam, camDist, horizon, wanted)
        this.visit(f, level + 1, ix * 2 + 1, iy * 2, cam, camDist, horizon, wanted)
        this.visit(f, level + 1, ix * 2, iy * 2 + 1, cam, camDist, horizon, wanted)
        this.visit(f, level + 1, ix * 2 + 1, iy * 2 + 1, cam, camDist, horizon, wanted)
        return
      }
    }
    wanted.set(chunkKey(f, level, ix, iy), { f, level, ix, iy })
  }
}
