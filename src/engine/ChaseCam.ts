// Third-person follow that stays level to the planet, not to the craft.
// Behind and above, looking at the ship, and never inside a hill.
import * as THREE from 'three'
import type { Craft } from './Craft.ts'
import { groundRadius } from '../world/terrain.ts'
import type { PlanetSeed } from '../world/height.ts'

// Steeper than a chase cam, shallower than Zarch: you see the top of the ship
// and the ground it is over, and the horizon stays in frame. It closes in as
// you get low, so the ship fills the frame at the moment that matters.
const NEAR = { back: 14, up: 10 }
const FAR = { back: 30, up: 26 }
const FAR_ALT = 150
const CAM_CLEARANCE = 2.5

export class ChaseCam {
  readonly pos = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  /** User offsets on top of the follow: drag to orbit, wheel to zoom, reset() to snap back. */
  orbitYaw = 0
  orbitPitch = 0
  zoom = 1
  private readonly viewFwd = new THREE.Vector3()
  private readonly spin = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3(0, 0, -1)
  private readonly up = new THREE.Vector3()
  private readonly f = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly dir = new THREE.Vector3()
  private readonly seed: PlanetSeed
  private first = true

  constructor(seed: PlanetSeed) {
    this.seed = seed
  }

  reset(): void { this.orbitYaw = 0; this.orbitPitch = 0; this.zoom = 1 }

  update(dt: number, craft: Craft): void {
    this.up.copy(craft.pos).normalize()
    const t = Math.min(1, Math.max(0, craft.altitude() / FAR_ALT))
    const BACK = NEAR.back + (FAR.back - NEAR.back) * t, UP = NEAR.up + (FAR.up - NEAR.up) * t
    // Heading is the ship's nose flattened onto the local horizon. When the
    // nose points straight up or down, keep the last good heading.
    this.f.set(0, 0, -1).applyQuaternion(craft.quat).addScaledVector(this.up, -this.f.dot(this.up))
    if (this.f.lengthSq() > 0.04) this.fwd.lerp(this.f.normalize(), this.first ? 1 : 1 - Math.exp(-2.5 * dt))
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize()

    // The follow gives a heading; the user's orbit rotates around it and tilts it.
    this.spin.setFromAxisAngle(this.up, this.orbitYaw)
    this.viewFwd.copy(this.fwd).applyQuaternion(this.spin)
    const dist = Math.hypot(BACK, UP) * this.zoom
    const elev = Math.min(1.45, Math.max(0.08, Math.atan2(UP, BACK) + this.orbitPitch))
    this.target.copy(craft.pos).addScaledVector(this.up, dist * Math.sin(elev)).addScaledVector(this.viewFwd, -dist * Math.cos(elev))
    this.pos.lerp(this.target, this.first ? 1 : 1 - Math.exp(-6 * dt))
    // Stay out of the ground.
    this.dir.copy(this.pos).normalize()
    const minR = groundRadius(this.dir, this.seed) + CAM_CLEARANCE
    if (this.pos.length() < minR) this.pos.copy(this.dir).multiplyScalar(minR)

    this.look.copy(craft.pos).addScaledVector(this.up, 1.5)
    this.m.lookAt(this.pos, this.look, this.up)
    this.quat.setFromRotationMatrix(this.m)
    this.first = false
  }
}
