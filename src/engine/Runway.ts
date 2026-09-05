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
  for (let z = -half; z <= half; z += 40) for (const side of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), lamps)
    l.position.set(side * (RUNWAY_WIDTH / 2 + 2), 0.3, z)
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

const LAMP_DAY = new THREE.Color(0x5a5548), LAMP_NIGHT = new THREE.Color(0xfff1c0)
export function updateRunway(v: RunwayView, day = 1): void {
  const night = 1 - Math.min(1, Math.max(0, (day - 0.15) / 0.35))
  v.lamps.color.lerpColors(LAMP_DAY, LAMP_NIGHT, night)
}
