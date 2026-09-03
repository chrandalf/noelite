// The station you can see: a flat disc flush with the flattened ground, four numbered
// pads with rings and pips, a dome, a tower with a beacon that pulses, edge lights. The
// ground itself is flattened by height.ts; this is the paint and the furniture. Same
// no-assets rule as the ship: flat polygons, two or three colours.
import * as THREE from 'three'
import { stationOf, PAD_RADIUS, STATION_RADIUS, type Terrain, type Station } from '../world/height.ts'

export type StationView = { station: Station; group: THREE.Group; beacon: THREE.MeshLambertMaterial }

export function buildStation(t: Terrain): StationView | null {
  const st = stationOf(t)
  if (!st) return null
  const g = new THREE.Group()
  const discMat = new THREE.MeshLambertMaterial({ color: 0x7d8288 })
  discMat.name = 'station-disc'
  const padMat = new THREE.MeshLambertMaterial({ color: 0x676b71 })
  padMat.name = 'station-pad'
  const ringMat = new THREE.MeshLambertMaterial({ color: 0xd9b93a })
  ringMat.name = 'station-ring'
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xb9c2cc })
  wallMat.name = 'station-wall'
  const beacon = new THREE.MeshLambertMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 1 })
  beacon.name = 'station-beacon'
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0 })
  lampMat.name = 'station-lamp'

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(STATION_RADIUS - 6, STATION_RADIUS - 2, 0.6, 16), discMat)
  disc.position.y = -0.28
  g.add(disc)
  // Edge lights.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), lampMat)
    l.position.set(Math.cos(a) * (STATION_RADIUS - 8), 0.4, Math.sin(a) * (STATION_RADIUS - 8))
    g.add(l)
  }
  // Frame: the group's quaternion takes +Y to the site's up; pads are placed by taking their
  // directions into that local frame, so paint and physics agree to the centimetre.
  const up = new THREE.Vector3(st.site.dir.x, st.site.dir.y, st.site.dir.z)
  const centre = up.clone().multiplyScalar(t.radius + st.site.h)
  g.position.copy(centre)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
  const qInv = g.quaternion.clone().invert()
  const local = (d: { x: number; y: number; z: number }) => new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(t.radius + st.site.h).sub(centre).applyQuaternion(qInv)
  for (const p of st.pads) {
    const at = local(p.dir)
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS - 4, PAD_RADIUS - 2, 0.5, 8), padMat)
    slab.position.set(at.x, 0.05, at.z)
    const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_RADIUS - 9, PAD_RADIUS - 7.5, 8), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(at.x, 0.36, at.z)
    g.add(slab, ring)
    // Pips: the pad number, in yellow squares on the side away from the dome.
    const out = new THREE.Vector3(at.x, 0, at.z).normalize()
    const side = new THREE.Vector3(-out.z, 0, out.x)
    for (let i = 0; i < p.n; i++) {
      const pip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), ringMat)
      pip.position.copy(out).multiplyScalar(PAD_RADIUS - 4).addScaledVector(side, (i - (p.n - 1) / 2) * 3.4).setY(0.4).add(new THREE.Vector3(at.x, 0, at.z))
      g.add(pip)
    }
    // Four pad lamps.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), lampMat)
      l.position.set(at.x + Math.cos(a) * (PAD_RADIUS - 5), 0.5, at.z + Math.sin(a) * (PAD_RADIUS - 5))
      g.add(l)
    }
  }
  // The dome, half buried, and the tower with its beacon between pads 1 and 2.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(15, 12, 8), wallMat)
  dome.position.y = -3
  g.add(dome)
  const p1 = local(st.pads[0].dir), p2 = local(st.pads[1].dir)
  const towerAt = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.36)
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 30, 6), wallMat)
  tower.position.set(towerAt.x, 15, towerAt.z)
  const top = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), beacon)
  top.position.set(towerAt.x, 31.5, towerAt.z)
  g.add(tower, top)
  return { station: st, group: g, beacon }
}

/** Pulse the beacon: on for a fifth of every second and a half. */
export function updateStation(v: StationView, t: number): void {
  v.beacon.emissiveIntensity = (t % 1.5) < 0.3 ? 1.6 : 0.25
}
