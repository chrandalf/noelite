// Dust thrown out when you burn near the ground. Zarch's smoke, cheaper.
import * as THREE from 'three'
import { groundRadius } from '../world/terrain.ts'
import type { PlanetSeed } from '../world/height.ts'
import { rng } from '../world/noise.ts'

const N = 200
const LIFE = 0.9

export class Dust {
  readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel = new Float32Array(N * 3)
  private readonly life = new Float32Array(N)
  private cursor = 0
  private carry = 0
  private readonly next = rng(7)
  private readonly seed: PlanetSeed
  private readonly dir = new THREE.Vector3()
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly ax = new THREE.Vector3()

  constructor(seed: PlanetSeed) {
    this.seed = seed
    this.pos = new Float32Array(N * 3) // all at the planet centre: inside, invisible
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc9c39a, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false }))
    ;(this.points.material as THREE.Material).name = 'dust'
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  /** Call every frame. Emits while `burning` within `reach` metres of the ground under `craftPos`. */
  update(dt: number, craftPos: THREE.Vector3, feetAltitude: number, burning: boolean, reach = 14): void {
    if (burning && feetAltitude < reach) {
      const k = 1 - Math.max(0, feetAltitude) / reach
      this.carry += 110 * k * dt
      const count = Math.floor(this.carry); this.carry -= count
      if (count) {
        this.dir.copy(craftPos).normalize()
        this.ax.set(Math.abs(this.dir.x) < 0.9 ? 1 : 0, Math.abs(this.dir.x) < 0.9 ? 0 : 1, 0)
        this.t1.crossVectors(this.ax, this.dir).normalize()
        this.t2.crossVectors(this.dir, this.t1)
        const gr = groundRadius(this.dir, this.seed) + 0.4
        for (let i = 0; i < count; i++) {
          const j = this.cursor; this.cursor = (this.cursor + 1) % N
          const a = this.next() * Math.PI * 2, sp = (5 + 8 * this.next()) * (0.5 + 0.5 * k)
          this.pos[j * 3] = this.dir.x * gr; this.pos[j * 3 + 1] = this.dir.y * gr; this.pos[j * 3 + 2] = this.dir.z * gr
          const vx = (Math.cos(a) * this.t1.x + Math.sin(a) * this.t2.x) * sp + this.dir.x * sp * 0.3
          const vy = (Math.cos(a) * this.t1.y + Math.sin(a) * this.t2.y) * sp + this.dir.y * sp * 0.3
          const vz = (Math.cos(a) * this.t1.z + Math.sin(a) * this.t2.z) * sp + this.dir.z * sp * 0.3
          this.vel[j * 3] = vx; this.vel[j * 3 + 1] = vy; this.vel[j * 3 + 2] = vz
          this.life[j] = LIFE * (0.6 + 0.4 * this.next())
        }
      }
    }
    const damp = Math.exp(-2.2 * dt)
    for (let j = 0; j < N; j++) {
      if (this.life[j] <= 0) continue
      this.life[j] -= dt
      if (this.life[j] <= 0) { this.pos[j * 3] = 0; this.pos[j * 3 + 1] = 0; this.pos[j * 3 + 2] = 0; continue }
      this.pos[j * 3] += this.vel[j * 3] * dt; this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt; this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt
      this.vel[j * 3] *= damp; this.vel[j * 3 + 1] *= damp; this.vel[j * 3 + 2] *= damp
    }
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}
