// The boob you can see: a sphere the colour of a Spurs fan in July, a darker disc, a
// nipple, and the jiggle. Same no-assets rule as everything else: flat polygons, three
// colours. It lives in home's group; syncBoob moves it every frame.
import * as THREE from 'three'
import { Boob, BOOB_RADIUS } from '../world/boob.ts'

export type BoobView = { group: THREE.Group; skin: THREE.Mesh; areola: THREE.Mesh; nipple: THREE.Mesh }

export function buildBoob(): BoobView {
  const g = new THREE.Group()
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf2c4a8 })
  skinMat.name = 'boob-skin'
  const areolaMat = new THREE.MeshLambertMaterial({ color: 0xc98a78 })
  areolaMat.name = 'boob-areola'
  const nippleMat = new THREE.MeshLambertMaterial({ color: 0xb06a5e })
  nippleMat.name = 'boob-nipple'
  const skin = new THREE.Mesh(new THREE.SphereGeometry(BOOB_RADIUS, 20, 14), skinMat)
  // The disc is a cap of a slightly larger sphere, so it sits on the skin without fighting it:
  // a SphereGeometry cut to a third of a radian round its pole, turned to face +z.
  const areola = new THREE.Mesh(new THREE.SphereGeometry(BOOB_RADIUS * 1.006, 20, 6, 0, Math.PI * 2, 0, Math.asin(0.34)), areolaMat)
  areola.rotation.x = Math.PI / 2
  const nipple = new THREE.Mesh(new THREE.SphereGeometry(BOOB_RADIUS * 0.11, 12, 8), nippleMat)
  nipple.position.z = BOOB_RADIUS * 1.02
  g.add(skin, areola, nipple)
  return { group: g, skin, areola, nipple }
}

const UP = new THREE.Vector3(0, 1, 0)
const _up = new THREE.Vector3()
/** Put the group on the boob, level to the ground under it, turning slowly so the disc is not always at your back, and squash it by the wobble. */
export function syncBoob(b: Boob, v: BoobView, t: number): void {
  v.group.position.copy(b.pos)
  _up.copy(b.pos).normalize()
  v.group.quaternion.setFromUnitVectors(UP, _up)
  v.group.rotateY(t * 0.05)
  const s = 1 + 0.18 * b.wobble * Math.sin(b.phase)
  v.group.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s))
}
