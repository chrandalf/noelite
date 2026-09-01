// Where the sun is. The planet does not rotate; the sun goes round it, which
// looks identical from the ground and keeps every world coordinate fixed.
import * as THREE from 'three'
import { DAY_LENGTH } from './config.ts'

const SUN0 = new THREE.Vector3(1, 0.25, 0.35).normalize()
const AXIS = new THREE.Vector3(0.1, 1, 0.05).normalize()

/** Unit vector toward the sun at time t seconds. */
export function sunDirection(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(SUN0).applyAxisAngle(AXIS, (t / DAY_LENGTH) * Math.PI * 2)
}

/** Sine of the sun's elevation for an observer whose local up is `up`. */
export function sunElevation(up: THREE.Vector3, sun: THREE.Vector3): number {
  return up.dot(sun)
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 0 at night, 1 in full day, for lighting and the sky. */
export function dayFactor(sunElev: number): number {
  return smoothstep(-0.12, 0.25, sunElev)
}
