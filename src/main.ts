// Step 1 of the build order: sphere with LOD, free camera, no ship.
import * as THREE from 'three'
import { PlanetLOD } from './world/lod.ts'
import { FlyCam } from './engine/FlyCam.ts'
import { height } from './world/height.ts'
import { PLANET_RADIUS, MASTER_SEED } from './world/config.ts'

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x06060e)

// The camera never leaves the origin. The world moves around it.
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 2e6)
const world = new THREE.Group()
scene.add(world)

// One hard sun, one cool ambient. That is the entire lighting rig.
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4)
sun.position.set(1, 0.55, 0.35).multiplyScalar(1e5)
scene.add(sun, new THREE.AmbientLight(0x50608a, 0.6))

// Debug switches: ?wire=1 draws chunk edges, ?skirts=0 removes the crack-hiding skirts.
const debug = new URLSearchParams(location.search)
const terrainMaterial = debug.get('wire') === '1'
  ? new THREE.MeshBasicMaterial({ wireframe: true, color: 0x9fe3a0 })
  // flatShading is deliberately OFF. With it on, Three ignores the normal
  // attribute and derives normals from screen-space derivatives, which lit every
  // skirt as the vertical wall it is and drew a dark line along every LOD seam.
  // The chunk builder supplies true per-facet normals on non-indexed geometry,
  // so the faceted look is identical and the skirts inherit their surface's normal.
  : new THREE.MeshLambertMaterial({ vertexColors: true })
const planet = new PlanetLOD(MASTER_SEED, terrainMaterial, debug.get('skirts') === '0' ? false : debug.get('skirts') === 'red' ? 'red' : true)
world.add(planet.group)

const cam = new FlyCam(renderer.domElement)
{
  // ?cam=x,y,z&at=x,y,z puts the camera somewhere exact, for screenshots and harnesses.
  const q = new URLSearchParams(location.search)
  const vec = (s: string | null, d: THREE.Vector3) => { const p = s?.split(',').map(Number); return p && p.length === 3 && p.every(Number.isFinite) ? new THREE.Vector3(...(p as [number, number, number])) : d }
  cam.pos.copy(vec(q.get('cam'), new THREE.Vector3(0, PLANET_RADIUS * 0.9, PLANET_RADIUS * 2.6)))
  cam.lookAt(vec(q.get('at'), new THREE.Vector3(0, 0, 0)))
}

const hud = document.getElementById('hud')!
const dir = new THREE.Vector3()
let last = performance.now(), frames = 0, fps = 0, fpsAt = last

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  dir.copy(cam.pos).normalize()
  const ground = PLANET_RADIUS + height(dir, MASTER_SEED)
  const altitude = cam.pos.length() - ground
  const speed = cam.update(dt, altitude)

  planet.update(cam.pos)
  world.position.copy(cam.pos).negate()
  camera.quaternion.copy(cam.quat)
  renderer.render(scene, camera)

  frames++
  if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now }
  const [lo, hi] = planet.levelRange()
  hud.textContent =
    `alt ${altitude.toFixed(0)} m   speed ${speed.toFixed(0)} m/s   chunks ${planet.liveCount} (+${planet.pendingCount})   lod ${lo}..${hi}   ${fps} fps\n` +
    `WASD move  R/F up/down  Q/E roll  drag to look  shift = fast`
})

// For the harnesses.
;(window as unknown as { __noelite: unknown }).__noelite = {
  planet, cam,
  ready: () => planet.pendingCount === 0,
  /** Put the camera at p looking at a. Harness hook. */
  place: (px: number, py: number, pz: number, ax: number, ay: number, az: number) => { cam.pos.set(px, py, pz); cam.lookAt(new THREE.Vector3(ax, ay, az)) },
  altitude: () => { const d = cam.pos.clone().normalize(); return cam.pos.length() - PLANET_RADIUS - height(d, MASTER_SEED) },
}
