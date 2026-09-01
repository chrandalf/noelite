// Planet, prograde and retrograde markers on the HUD. Projected through the
// camera; when off-screen or behind, pinned to the edge with an arrow, so
// "where is the planet" always has an answer even in empty space.
import * as THREE from 'three'

type Kind = 'planet' | 'pro' | 'retro' | 'target'
const LABEL: Record<Kind, string> = { planet: '⊕', pro: '▲', retro: '▽', target: '◇' }

export class NavMarkers {
  private readonly els: Record<Kind, HTMLElement>
  private readonly v = new THREE.Vector3()
  private readonly qInv = new THREE.Quaternion()

  constructor(root: HTMLElement) {
    const make = (k: Kind) => { const e = document.createElement('div'); e.className = `nav ${k}`; e.textContent = LABEL[k]; root.appendChild(e); return e }
    this.els = { planet: make('planet'), pro: make('pro'), retro: make('retro'), target: make('target') }
  }

  hide(): void { for (const e of Object.values(this.els)) e.hidden = true }

  /** `dir` is a unit direction in scene space (camera at the origin). */
  place(kind: Kind, dir: THREE.Vector3, camera: THREE.PerspectiveCamera, show: boolean, label = ''): void {
    const el = this.els[kind]
    el.hidden = !show
    if (!show) return
    el.textContent = label ? `${LABEL[kind]} ${label}` : LABEL[kind]
    this.qInv.copy(camera.quaternion).invert()
    this.v.copy(dir).applyQuaternion(this.qInv)
    const behind = this.v.z >= -1e-6
    const tanY = Math.tan((camera.fov * Math.PI) / 360), tanX = tanY * camera.aspect
    let x: number, y: number
    if (!behind) { x = this.v.x / -this.v.z / tanX; y = this.v.y / -this.v.z / tanY }
    else { x = -this.v.x; y = -this.v.y }
    const onScreen = !behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9
    if (!onScreen) {
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-6)
      x = (x / m) * 0.94; y = (y / m) * 0.9
    }
    el.style.left = `${((x + 1) / 2) * 100}%`
    el.style.top = `${((1 - y) / 2) * 100}%`
    el.classList.toggle('edge', !onScreen)
    el.style.setProperty('--ang', `${Math.atan2(-y, x) + Math.PI / 2}rad`)
  }
}
