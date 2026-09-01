// Third-person follow. In atmosphere it stays level to the planet: behind and
// above, looking at the ship, closing in as you get low. In vacuum there is no
// horizon worth being level to, so it locks to the ship's own frame and you
// see rotation against the stars. The two blend by atmospheric density.
// Position smoothing stiffens with speed so the ship can never outrun the frame.
import * as THREE from 'three'
import type { Craft } from './Craft.ts'
import { groundRadius } from '../world/terrain.ts'
import type { Terrain } from '../world/height.ts'

const NEAR = { back: 14, up: 10 }
const FAR = { back: 30, up: 26 }
const FAR_ALT = 150
const SHIP = { back: 24, up: 9 }
const CAM_CLEARANCE = 2.5
const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)

export class ChaseCam {
  readonly pos = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  /** User offsets on top of the follow: drag to orbit, wheel to zoom, reset() to snap back. */
  orbitYaw = 0
  orbitPitch = 0
  zoom = 1
  private readonly fwd = new THREE.Vector3(0, 0, -1)
  private readonly up = new THREE.Vector3()
  private readonly f = new THREE.Vector3()
  private readonly viewFwd = new THREE.Vector3()
  private readonly spin = new THREE.Quaternion()
  private readonly targetP = new THREE.Vector3()
  private readonly lookP = new THREE.Vector3()
  private readonly off = new THREE.Vector3()
  private readonly targetS = new THREE.Vector3()
  private readonly lookS = new THREE.Vector3()
  private readonly upS = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly camUp = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly dir = new THREE.Vector3()
  private readonly seed: Terrain
  private first = true

  constructor(seed: Terrain) {
    this.seed = seed
  }

  reset(): void { this.orbitYaw = 0; this.orbitPitch = 0; this.zoom = 1 }

  /** `density`: 1 is the planet-level follow, 0 is locked to the ship's frame. */
  update(dt: number, craft: Craft, density: number): void {
    this.up.copy(craft.pos).normalize()

    // Planet frame. Heading is the nose flattened onto the local horizon; when
    // the nose points straight up or down, keep the last good heading.
    const t = Math.min(1, Math.max(0, craft.altitude() / FAR_ALT))
    const BACK = NEAR.back + (FAR.back - NEAR.back) * t, UP = NEAR.up + (FAR.up - NEAR.up) * t
    this.f.set(0, 0, -1).applyQuaternion(craft.quat).addScaledVector(this.up, -this.f.dot(this.up))
    if (this.f.lengthSq() > 0.04) this.fwd.lerp(this.f.normalize(), this.first ? 1 : 1 - Math.exp(-2.5 * dt))
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize()
    this.spin.setFromAxisAngle(this.up, this.orbitYaw)
    this.viewFwd.copy(this.fwd).applyQuaternion(this.spin)
    const distP = Math.hypot(BACK, UP) * this.zoom
    const elev = Math.min(1.45, Math.max(0.08, Math.atan2(UP, BACK) + this.orbitPitch))
    this.targetP.copy(craft.pos).addScaledVector(this.up, distP * Math.sin(elev)).addScaledVector(this.viewFwd, -distP * Math.cos(elev))
    this.lookP.copy(craft.pos).addScaledVector(this.up, 1.5)

    // Ship frame. Behind the nose, above the spine, orbit offsets in body axes.
    this.off.set(0, SHIP.up, SHIP.back).multiplyScalar(this.zoom).applyAxisAngle(X, -this.orbitPitch).applyAxisAngle(Y, this.orbitYaw).applyQuaternion(craft.quat)
    this.targetS.copy(craft.pos).add(this.off)
    this.lookS.set(0, 0, -8).applyQuaternion(craft.quat).add(craft.pos)
    this.upS.copy(Y).applyQuaternion(craft.quat)

    // Blend.
    this.target.lerpVectors(this.targetS, this.targetP, density)
    this.look.lerpVectors(this.lookS, this.lookP, density)
    this.camUp.lerpVectors(this.upS, this.up, density)
    if (this.camUp.lengthSq() < 1e-6) this.camUp.copy(this.up)
    this.camUp.normalize()

    const k = 6 + craft.speed() * 0.5
    this.pos.lerp(this.target, this.first ? 1 : 1 - Math.exp(-k * dt))
    this.dir.copy(this.pos).normalize()
    const minR = groundRadius(this.dir, this.seed) + CAM_CLEARANCE
    if (this.pos.length() < minR) this.pos.copy(this.dir).multiplyScalar(minR)

    this.m.lookAt(this.pos, this.look, this.camUp)
    this.quat.setFromRotationMatrix(this.m)
    this.first = false
  }
}
