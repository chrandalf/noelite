// The landing pad you can see: a grey octagonal slab flush with the flattened ground and
// a painted ring. The ground itself is flattened by height.ts; this is only the paint.
import * as THREE from 'three'
import { padOf, PAD_RADIUS, type Terrain } from '../world/height.ts'

export function buildPad(t: Terrain): THREE.Group | null {
  const site = padOf(t)
  if (!site) return null
  const g = new THREE.Group()
  const slabMat = new THREE.MeshLambertMaterial({ color: 0x8f9296 })
  slabMat.name = 'pad'
  const ringMat = new THREE.MeshLambertMaterial({ color: 0xd9b93a })
  ringMat.name = 'pad-ring'
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS - 4, PAD_RADIUS - 2, 0.6, 8), slabMat)
  slab.position.y = -0.28 // top at +0.02
  const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_RADIUS - 9, PAD_RADIUS - 7.5, 8), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.05
  g.add(slab, ring)
  const up = new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z)
  g.position.copy(up).multiplyScalar(t.radius + site.h)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up)
  return g
}
