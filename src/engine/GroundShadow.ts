// A blob shadow straight down onto the terrain. Not a real shadow: the point is
// that it grows and darkens as you descend, which is the oldest altitude cue in
// the genre and still the best one.
//
// The disc conforms to the ground: every rim vertex sits on its own height()
// sample, so it hugs facets instead of slicing through them, and it needs no
// depth-test tricks (depthTest: false under the log depth buffer took the GL
// context down on swiftshader). Polygon offset keeps it just proud of the surface.
import * as THREE from 'three'
import type { Craft } from './Craft.ts'
import { groundRadius } from '../world/terrain.ts'
import type { Terrain } from '../world/height.ts'

const SEGMENTS = 12

export class GroundShadow {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly pos: Float32Array
  private readonly dir = new THREE.Vector3()
  private readonly t1 = new THREE.Vector3()
  private readonly t2 = new THREE.Vector3()
  private readonly ax = new THREE.Vector3()
  private readonly p = new THREE.Vector3()
  /** The body under the craft; main swaps it when the reference body changes. */
  terrain: Terrain

  constructor(terrain: Terrain) {
    this.terrain = terrain
    this.pos = new Float32Array((SEGMENTS + 1) * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const idx: number[] = []
    for (let i = 0; i < SEGMENTS; i++) idx.push(0, 1 + i, 1 + ((i + 1) % SEGMENTS))
    g.setIndex(idx)
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    })
    this.mat.name = 'shadow'
    this.mesh = new THREE.Mesh(g, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  update(craft: Craft): void {
    const alt = Math.max(0, craft.altitude())
    this.mat.opacity = 0.55 * Math.max(0, 1 - alt / 140)
    this.mesh.visible = this.mat.opacity > 0.01 // landed too: a contact shadow is what says it is down
    if (!this.mesh.visible) return

    this.dir.copy(craft.pos).normalize()
    this.ax.set(Math.abs(this.dir.x) < 0.9 ? 1 : 0, Math.abs(this.dir.x) < 0.9 ? 0 : 1, 0)
    this.t1.crossVectors(this.ax, this.dir).normalize()
    this.t2.crossVectors(this.dir, this.t1)
    const r = 3.4 + alt * 0.06
    const lift = 0.15
    this.p.copy(this.dir).multiplyScalar(groundRadius(this.dir, this.terrain) + lift)
    this.pos[0] = this.p.x; this.pos[1] = this.p.y; this.pos[2] = this.p.z
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2
      this.p.copy(this.dir).addScaledVector(this.t1, (Math.cos(a) * r) / groundRadius(this.dir, this.terrain)).addScaledVector(this.t2, (Math.sin(a) * r * 0.8) / groundRadius(this.dir, this.terrain)).normalize()
      this.p.multiplyScalar(groundRadius(this.p, this.terrain) + lift)
      this.pos[(1 + i) * 3] = this.p.x; this.pos[(1 + i) * 3 + 1] = this.p.y; this.pos[(1 + i) * 3 + 2] = this.p.z
    }
    ;(this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}
