// The runway you can see (DESIGN §10l-2): a dark strip on the flattened ground, a centreline
// of dashes, threshold bars at both ends, and edge lights that come up at night. Same rule as
// the station: flat polygons, a few colours, no assets. The ground under it is flattened by
// height.ts; this is the paint.
import * as THREE from 'three'
import type { PadSite, Terrain } from '../world/height.ts'
import { RUNWAY_WIDTH } from '../world/height.ts'

export type RunwayView = { group: THREE.Group; lamps: THREE.MeshBasicMaterial }

export function buildRunway(t: Terrain, site: PadSite): RunwayView {
  const g = new THREE.Group()
  const half = site.half ?? 200
  const paving = new THREE.MeshLambertMaterial({ color: 0x4a4d52 })
  paving.name = 'runway'
  const paint = new THREE.MeshLambertMaterial({ color: 0xe8e8e0 })
  paint.name = 'runway-paint'
  const lamps = new THREE.MeshBasicMaterial({ color: 0xfff1c0 })
  lamps.name = 'runway-lamp'
  const strip = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY_WIDTH, 0.3, half * 2), paving)
  strip.position.y = -0.1
  g.add(strip)
  for (let z = -half + 30; z < half - 20; z += 30) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 12), paint)
    dash.position.set(0, 0.1, z)
    g.add(dash)
  }
  for (const end of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 14), paint)
      bar.position.set(-RUNWAY_WIDTH / 2 + 3 + i * ((RUNWAY_WIDTH - 6) / 5), 0.1, end * (half - 12))
      g.add(bar)
    }
  }
  // Lights (Chris, 2026-09-05: "need the runway lights on it"): white edge lights every 30 m either side, amber
  // centreline lights every 30 m set into the paving, green threshold lights across the near end and red across the far.
  for (let z = -half; z <= half; z += 30) for (const side of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), lamps)
    l.position.set(side * (RUNWAY_WIDTH / 2 + 2.5), 0.45, z)
    g.add(l)
  }
  const centre = new THREE.MeshBasicMaterial({ color: 0xffb347 })
  centre.name = 'runway-centre'
  for (let z = -half + 15; z < half - 10; z += 30) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.9), centre)
    l.position.set(0, 0.2, z)
    g.add(l)
  }
  const green = new THREE.MeshBasicMaterial({ color: 0x4cff6a }), red = new THREE.MeshBasicMaterial({ color: 0xff4040 })
  green.name = 'runway-green'; red.name = 'runway-red'
  for (let i = 0; i <= 8; i++) for (const [end, mat] of [[-1, green], [1, red]] as [number, THREE.MeshBasicMaterial][]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.0), mat)
    l.position.set(-RUNWAY_WIDTH / 2 + (i * RUNWAY_WIDTH) / 8, 0.25, end * (half + 3))
    g.add(l)
  }
  // Frame: +Y to the site's up, then turn so local +Z runs along the strip.
  const up = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  g.position.copy(up).multiplyScalar(t.radius + site.h)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
  const alongLocal = new THREE.Vector3(site.along!.x, site.along!.y, site.along!.z).applyQuaternion(g.quaternion.clone().invert())
  g.rotateY(Math.atan2(alongLocal.x, alongLocal.z))
  return { group: g, lamps }
}

/** The edge lights stay lit by day (a shade dimmer) so the strip reads from the air. */
const LAMP_DAY = new THREE.Color(0xc8bfa0), LAMP_NIGHT = new THREE.Color(0xfff1c0)
export function updateRunway(v: RunwayView, day = 1): void {
  const night = 1 - Math.min(1, Math.max(0, (day - 0.15) / 0.35))
  v.lamps.color.lerpColors(LAMP_DAY, LAMP_NIGHT, night)
}
