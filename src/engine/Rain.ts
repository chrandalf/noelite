// Rain: streaks in a box around the craft, falling with the wind, where the weather
// says so. Line segments, one per drop, in the reference body's frame.
import * as THREE from 'three'
import { rng } from '../world/noise.ts'

const N = 700
const BOX = 45
const STREAK = 0.06

export class Rain {
  readonly lines: THREE.LineSegments
  private readonly pos: Float32Array
  private readonly next = rng(11)
  private readonly up = new THREE.Vector3()
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly ax = new THREE.Vector3()
  private readonly v = new THREE.Vector3()
  private active = 0

  constructor() {
    this.pos = new Float32Array(N * 6)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const m = new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.35, depthWrite: false })
    m.name = 'rain'
    this.lines = new THREE.LineSegments(g, m)
    this.lines.frustumCulled = false
    this.lines.renderOrder = 3
  }

  /** `craftPos` local frame; `wind` local m/s; `intensity` 0..1; `density` of air at the craft. */
  update(dt: number, craftPos: THREE.Vector3, wind: THREE.Vector3, intensity: number, density: number): void {
    const want = Math.round(N * Math.min(1, intensity * 1.2) * (density > 0.05 ? 1 : 0))
    this.up.copy(craftPos).normalize()
    this.ax.set(Math.abs(this.up.x) < 0.9 ? 1 : 0, Math.abs(this.up.x) < 0.9 ? 0 : 1, 0)
    this.t1.crossVectors(this.ax, this.up).normalize()
    this.t2.crossVectors(this.up, this.t1)
    // Fall velocity: down at 9 m/s, plus the wind.
    this.v.copy(this.up).multiplyScalar(-9).add(wind)
    const p = this.pos
    for (let i = 0; i < N; i++) {
      const o = i * 6
      if (i >= want) { p[o] = p[o + 1] = p[o + 2] = p[o + 3] = p[o + 4] = p[o + 5] = 0; continue }
      let x = p[o], y = p[o + 1], z = p[o + 2]
      const dead = i >= this.active || (x === 0 && y === 0 && z === 0)
      x += this.v.x * dt; y += this.v.y * dt; z += this.v.z * dt
      // Out of the box (or new): respawn upwind and above, anywhere in the box.
      const dx = x - craftPos.x, dy = y - craftPos.y, dz = z - craftPos.z
      const above = dx * this.up.x + dy * this.up.y + dz * this.up.z
      if (dead || Math.abs(above) > BOX || dx * dx + dy * dy + dz * dz > 3 * BOX * BOX) {
        const a = (this.next() - 0.5) * 2 * BOX, b = (this.next() - 0.5) * 2 * BOX, h = this.next() * BOX
        x = craftPos.x + this.t1.x * a + this.t2.x * b + this.up.x * h - this.v.x * 1.5
        y = craftPos.y + this.t1.y * a + this.t2.y * b + this.up.y * h - this.v.y * 1.5
        z = craftPos.z + this.t1.z * a + this.t2.z * b + this.up.z * h - this.v.z * 1.5
      }
      p[o] = x; p[o + 1] = y; p[o + 2] = z
      p[o + 3] = x + this.v.x * STREAK; p[o + 4] = y + this.v.y * STREAK; p[o + 5] = z + this.v.z * STREAK
    }
    this.active = want
    this.lines.visible = want > 0
    ;(this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}
