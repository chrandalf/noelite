// The warp look (Chris, 2026-09-05: "when we get to supersonic speeds in space it should look
// a bit like star trek when going warp, but not fully, we're going fast to the sun it needs to
// look fast basically"). Line segments in a tube round the ship, streaming past along the
// velocity, longer and brighter with speed, from STREAK_FROM to STREAK_FULL. Only in vacuum.
// Positions are in the craft's local frame relative to the craft; main places the object at
// the ship's place in the scene.
import * as THREE from 'three'
import { STREAK_FROM, STREAK_FULL } from '../world/config.ts'
import { rng } from '../world/noise.ts'

const N = 260
const RADIUS = 90
const AHEAD = 900
const BEHIND = 500

export class Streaks {
  readonly lines: THREE.LineSegments
  private readonly pos: Float32Array
  private readonly seeds: Float32Array
  private readonly next = rng(41)
  private readonly dir = new THREE.Vector3(0, 0, -1)
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly p = new THREE.Vector3()
  /** 0 off to 1 full, eased. */
  level = 0

  constructor() {
    this.pos = new Float32Array(N * 6)
    this.seeds = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const a = this.next() * Math.PI * 2, r = RADIUS * Math.sqrt(0.15 + 0.85 * this.next())
      this.seeds[i * 3] = Math.cos(a) * r; this.seeds[i * 3 + 1] = Math.sin(a) * r
      this.seeds[i * 3 + 2] = -BEHIND + (AHEAD + BEHIND) * this.next()   // along the flight, metres
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const m = new THREE.LineBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    m.name = 'streaks'
    this.lines = new THREE.LineSegments(g, m)
    this.lines.frustumCulled = false
    this.lines.renderOrder = 4
    this.lines.visible = false
  }

  /** `vel` is the craft's velocity in its local frame; `speed` its magnitude; `vacuum` true when there is no air. */
  update(dt: number, vel: THREE.Vector3, speed: number, vacuum: boolean): void {
    const want = vacuum ? Math.min(1, Math.max(0, (speed - STREAK_FROM) / (STREAK_FULL - STREAK_FROM))) : 0
    this.level += (want - this.level) * Math.min(1, dt / 0.6)
    this.lines.visible = this.level > 0.01
    if (!this.lines.visible) return
    if (speed > 1) this.dir.copy(vel).divideScalar(speed)
    // A frame across the flight direction.
    this.t1.set(1, 0, 0); if (Math.abs(this.dir.x) > 0.9) this.t1.set(0, 1, 0)
    this.t1.cross(this.dir).normalize(); this.t2.crossVectors(this.dir, this.t1)
    // Each streak slides back along the flight at a fraction of the speed and wraps; its length grows with speed.
    const slide = Math.min(400, speed * 0.01) * dt * 60
    const len = 20 + 380 * this.level
    for (let i = 0; i < N; i++) {
      let z = this.seeds[i * 3 + 2] - slide
      if (z < -BEHIND) z += AHEAD + BEHIND
      this.seeds[i * 3 + 2] = z
      const x = this.seeds[i * 3], y = this.seeds[i * 3 + 1]
      this.p.copy(this.t1).multiplyScalar(x).addScaledVector(this.t2, y).addScaledVector(this.dir, z)
      this.pos[i * 6] = this.p.x; this.pos[i * 6 + 1] = this.p.y; this.pos[i * 6 + 2] = this.p.z
      this.pos[i * 6 + 3] = this.p.x + this.dir.x * len; this.pos[i * 6 + 4] = this.p.y + this.dir.y * len; this.pos[i * 6 + 5] = this.p.z + this.dir.z * len
    }
    ;(this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.lines.material as THREE.LineBasicMaterial).opacity = 0.12 + 0.5 * this.level
  }
}
