// Ground queries the flight model needs. All derived from height(); nothing here
// is a second source of truth about the surface.
import * as THREE from 'three'
import { height, type Terrain } from './height.ts'
import { tide, oceanFade } from './weather.ts'

/** Simulation time the ground queries use for the tide. The craft sets it every substep; main sets it every frame. */
let clock = 0
export function setGroundClock(t: number): void { clock = t }

/** Height of the water surface above datum at d: sea level plus the tide, which only the deep water feels. */
export function seaSurface(d: THREE.Vector3, t: Terrain, landHeight: number): number {
  const sea = t.sea ?? 0
  return sea + tide(d, t, clock) * oceanFade(sea - landHeight)
}

/** Distance from the planet centre to the ground in direction d (unit). Water counts as ground: you can put down on it. */
export function groundRadius(d: THREE.Vector3, t: Terrain): number {
  const h = height(d, t)
  if (t.sea !== null && h < t.sea) return t.radius + seaSurface(d, t, h)
  return t.radius + h
}

/** True where the ground is land, a few metres clear of the sea. */
export function isDry(d: THREE.Vector3, t: Terrain): boolean {
  return t.sea === null || height(d, t) > t.sea + 3
}

const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), ax = new THREE.Vector3()
const q = new THREE.Vector3(), px = new THREE.Vector3(), nx = new THREE.Vector3(), py = new THREE.Vector3(), ny = new THREE.Vector3()
function at(d: THREE.Vector3, du: number, dv: number, seed: Terrain, out: THREE.Vector3): THREE.Vector3 {
  q.copy(d).addScaledVector(t1, du).addScaledVector(t2, dv).normalize()
  return out.copy(q).multiplyScalar(groundRadius(q, seed))
}

/** Outward surface normal at d by central differences one metre apart. */
export function surfaceNormal(d: THREE.Vector3, seed: Terrain, out = new THREE.Vector3()): THREE.Vector3 {
  ax.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0)
  t1.crossVectors(ax, d).normalize()
  t2.crossVectors(d, t1)
  const e = 1 / seed.radius
  at(d, e, 0, seed, px); at(d, -e, 0, seed, nx); at(d, 0, e, seed, py); at(d, 0, -e, seed, ny)
  px.sub(nx); py.sub(ny)
  out.crossVectors(px, py).normalize()
  if (out.dot(d) < 0) out.negate()
  return out
}

const nTmp = new THREE.Vector3()
/** Ground slope at d, degrees from level. */
export function slopeDeg(d: THREE.Vector3, seed: Terrain): number {
  return (Math.acos(Math.min(1, surfaceNormal(d, seed, nTmp).dot(d))) * 180) / Math.PI
}

const spiral = new THREE.Vector3(), sT1 = new THREE.Vector3(), sT2 = new THREE.Vector3(), sAx = new THREE.Vector3()
/** Nearest direction to `guess` whose ground is under `maxSlope` degrees: a spiral search in ~12 m steps. */
export function findLandable(guess: THREE.Vector3, seed: Terrain, maxSlope = 8, out = new THREE.Vector3()): THREE.Vector3 {
  const d = out.copy(guess).normalize()
  if (isDry(d, seed) && slopeDeg(d, seed) < maxSlope) return d
  sAx.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0)
  sT1.crossVectors(sAx, d).normalize()
  sT2.crossVectors(d, sT1)
  const step = 12 / seed.radius
  for (let k = 1; k < 400; k++) {
    const ang = k * 2.4, rad = step * Math.sqrt(k) * 2
    spiral.copy(guess).normalize().addScaledVector(sT1, Math.cos(ang) * rad).addScaledVector(sT2, Math.sin(ang) * rad).normalize()
    if (isDry(spiral, seed) && slopeDeg(spiral, seed) < maxSlope) return out.copy(spiral)
  }
  return d
}
