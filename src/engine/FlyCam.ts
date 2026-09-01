// Free camera for looking at the planet before there is a ship. Holds a
// logical position and orientation; the renderer keeps the real camera at
// the origin and moves the world instead (camera-relative rendering).
import * as THREE from 'three'

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']

export class FlyCam {
  readonly pos = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  private readonly down = new Set<string>()
  private dragging = false
  private lastX = 0
  private lastY = 0
  private readonly tmpQ = new THREE.Quaternion()
  private readonly tmpV = new THREE.Vector3()

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => { if (KEYS.includes(e.code)) { this.down.add(e.code); e.preventDefault() } })
    addEventListener('keyup', (e) => this.down.delete(e.code))
    el.addEventListener('mousedown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY })
    addEventListener('mouseup', () => { this.dragging = false })
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY
      this.lastX = e.clientX; this.lastY = e.clientY
      this.rotate(-dx * 0.0025, -dy * 0.0025, 0)
    })
  }

  /** Point at a target with "up" along the local radial, so orbit views read level. */
  lookAt(target: THREE.Vector3): void {
    const up = this.pos.clone().normalize()
    const m = new THREE.Matrix4().lookAt(this.pos, target, up)
    this.quat.setFromRotationMatrix(m)
  }

  /** yaw about local Y, pitch about local X, roll about local Z. */
  rotate(yaw: number, pitch: number, roll: number): void {
    if (yaw) { this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), yaw); this.quat.multiply(this.tmpQ) }
    if (pitch) { this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 0, 0), pitch); this.quat.multiply(this.tmpQ) }
    if (roll) { this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 0, 1), roll); this.quat.multiply(this.tmpQ) }
    this.quat.normalize()
  }

  /** `altitude` in metres sets the speed: slow on the deck, fast in orbit. */
  update(dt: number, altitude: number): number {
    const fast = this.down.has('ShiftLeft') || this.down.has('ShiftRight')
    const speed = Math.min(3000, Math.max(6, Math.abs(altitude) * 0.7)) * (fast ? 4 : 1)
    const d = this.tmpV.set(0, 0, 0)
    if (this.down.has('KeyW')) d.z -= 1
    if (this.down.has('KeyS')) d.z += 1
    if (this.down.has('KeyA')) d.x -= 1
    if (this.down.has('KeyD')) d.x += 1
    if (this.down.has('KeyR')) d.y += 1
    if (this.down.has('KeyF')) d.y -= 1
    if (d.lengthSq() > 0) { d.normalize().applyQuaternion(this.quat).multiplyScalar(speed * dt); this.pos.add(d) }
    let roll = 0
    if (this.down.has('KeyQ')) roll += 1.2 * dt
    if (this.down.has('KeyE')) roll -= 1.2 * dt
    if (roll) this.rotate(0, 0, roll)
    return speed
  }
}
