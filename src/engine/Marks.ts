// Skid marks: a dark scuff on the ground where the gear touched, fading over a couple of
// minutes. A small pool, in the reference body's frame. Chris, 2026-09-03: attention to detail.
import * as THREE from 'three'

const N = 8
const LIFE = 120

export class Marks {
  readonly group = new THREE.Group()
  private readonly meshes: THREE.Mesh[] = []
  private readonly born: number[] = []
  private cursor = 0

  constructor() {
    for (let i = 0; i < N; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      m.name = 'mark'
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 10), m)
      mesh.visible = false
      mesh.renderOrder = 2
      this.meshes.push(mesh); this.born.push(-1)
      this.group.add(mesh)
    }
  }

  /** Lay a mark at `pos` (feet on the ground, local frame) with the ground normal `up`. */
  add(pos: THREE.Vector3, up: THREE.Vector3, now: number, size = 2.6): void {
    const i = this.cursor; this.cursor = (this.cursor + 1) % N
    const m = this.meshes[i]
    m.position.copy(pos).addScaledVector(up, 0.06)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up)
    m.rotateZ(Math.random() * Math.PI)
    m.scale.set(size * (0.8 + 0.4 * Math.random()), size * 0.5, 1)
    m.visible = true
    this.born[i] = now
  }

  update(now: number): void {
    for (let i = 0; i < N; i++) {
      if (this.born[i] < 0) continue
      const age = now - this.born[i]
      const m = this.meshes[i]
      if (age > LIFE) { m.visible = false; this.born[i] = -1; continue }
      ;(m.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - age / LIFE)
    }
  }
}
