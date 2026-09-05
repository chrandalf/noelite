// Wingtip vapour: two ribbons off the jet's wingtips that show when it is pulling hard or
// going fast in thick air, fading along their length. Points are kept in the craft's local
// frame; main places the object at minus the view position, like the ship. Additive, so a
// point with no vapour is simply black and invisible.
import * as THREE from 'three'

const WINGTIPS = [new THREE.Vector3(-3.5, -0.05, 2.9), new THREE.Vector3(3.5, -0.05, 2.9)]
/** The nozzles in the jet form, for contrails. */
export const NOZZLES = [new THREE.Vector3(-0.5, 0.05, 3.9), new THREE.Vector3(0.5, 0.05, 3.9)]

export class Trails {
  readonly group = new THREE.Group()
  private readonly colour: THREE.Color
  private readonly lines: THREE.Line[] = []
  private readonly pos: Float32Array[] = []
  private readonly col: Float32Array[] = []
  private readonly tmp = new THREE.Vector3()
  private carry = 0
  private readonly POINTS: number
  private readonly rate: number
  private readonly tips: THREE.Vector3[]
  private readonly fade: number

  /** `points` kept per ribbon at `rate` a second; `fade` is what each point keeps per step. Wingtip vapour: 40 at 30, contrails: 240 at 8. */
  constructor(points = 40, rate = 30, tips = WINGTIPS, fade = 0.97, colour = new THREE.Color(0.9, 0.95, 1.0), opacity = 0.55) {
    this.POINTS = points; this.rate = rate; this.tips = tips; this.fade = fade; this.colour = colour
    const POINTS = points
    for (let i = 0; i < 2; i++) {
      const p = new Float32Array(POINTS * 3), c = new Float32Array(POINTS * 3)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
      m.name = 'vapour'
      const l = new THREE.Line(g, m)
      l.frustumCulled = false
      l.renderOrder = 4
      this.group.add(l)
      this.lines.push(l); this.pos.push(p); this.col.push(c)
    }
  }

  /** Every frame. `strength` 0 to 1 is how much vapour the tips shed right now; the ribbon records it point by point at 30 a second. */
  update(dt: number, craftPos: THREE.Vector3, quat: THREE.Quaternion, strength: number, show: boolean): void {
    this.group.visible = show
    this.carry += dt
    if (this.carry < 1 / this.rate) return
    this.carry = 0
    const POINTS = this.POINTS
    for (let i = 0; i < 2; i++) {
      const p = this.pos[i], c = this.col[i]
      // Shift the ribbon back one point.
      p.copyWithin(3, 0, (POINTS - 1) * 3); c.copyWithin(3, 0, (POINTS - 1) * 3)
      this.tmp.copy(this.tips[i]).applyQuaternion(quat).add(craftPos)
      p[0] = this.tmp.x; p[1] = this.tmp.y; p[2] = this.tmp.z
      const k = Math.min(1, Math.max(0, strength))
      c[0] = this.colour.r * k; c[1] = this.colour.g * k; c[2] = this.colour.b * k
      // Fade along the ribbon.
      for (let j = 1; j < POINTS; j++) { c[j * 3] *= this.fade; c[j * 3 + 1] *= this.fade; c[j * 3 + 2] *= this.fade }
      ;(this.lines[i].geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(this.lines[i].geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }
}
