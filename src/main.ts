// Step 2 of the build order: the craft and the flight model, on the step-1 planet.
//   default        fly the craft (space thrusts, W/S A/D tilt, Q/E yaw, R respawn)
//   ?mode=free     step-1 fly camera, for the LOD harness and screenshots
//   ?cam=&at=      free-mode camera placement
//   ?burn=N        full thrust for the first N seconds, for screenshots
//   ?wire=1  ?skirts=0|red   renderer debug
import * as THREE from 'three'
import { PlanetLOD } from './world/lod.ts'
import { FlyCam } from './engine/FlyCam.ts'
import { Craft, type Controls } from './engine/Craft.ts'
import { KeyInput } from './engine/Input.ts'
import { ChaseCam } from './engine/ChaseCam.ts'
import { buildCraftMesh } from './engine/craftMesh.ts'
import { height } from './world/height.ts'
import { findLandable } from './world/terrain.ts'
import { PLANET_RADIUS, MASTER_SEED } from './world/config.ts'

const q = new URLSearchParams(location.search)
const mode: 'fly' | 'free' = q.get('mode') === 'free' ? 'free' : 'fly'

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
// Lander's sky: flat blue, hard horizon, and it thins to space as you climb.
const SKY = new THREE.Color(0x5d9be0), SPACE = new THREE.Color(0x06060e)
const background = new THREE.Color()
scene.background = background

// The camera never leaves the origin. The world moves around it.
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 2e6)
const world = new THREE.Group()
scene.add(world)

// One hard sun and a hemisphere fill. That is the entire lighting rig.
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4)
sun.position.set(1, 0.55, 0.35).multiplyScalar(1e5)
scene.add(sun, new THREE.HemisphereLight(0x9ec5ff, 0x3f5f2e, 0.85))

// flatShading is deliberately OFF. With it on, Three ignores the normal
// attribute and derives normals from screen-space derivatives, which lit every
// skirt as the vertical wall it is and drew a dark line along every LOD seam.
// The chunk builder supplies true per-facet normals on non-indexed geometry.
const terrainMaterial = q.get('wire') === '1'
  ? new THREE.MeshBasicMaterial({ wireframe: true, color: 0x9fe3a0 })
  : new THREE.MeshLambertMaterial({ vertexColors: true })
const planet = new PlanetLOD(MASTER_SEED, terrainMaterial, q.get('skirts') === '0' ? false : q.get('skirts') === 'red' ? 'red' : true)
world.add(planet.group)

// The craft, its pad, its camera.
const craft = new Craft(MASTER_SEED)
const input = new KeyInput()
const chase = new ChaseCam(MASTER_SEED)
const { root: ship, flame } = buildCraftMesh(new THREE.MeshLambertMaterial({ vertexColors: true }))
world.add(ship)
ship.visible = mode === 'fly'
const pad = findLandable(new THREE.Vector3(0, 0, 1), MASTER_SEED)
craft.spawnOn(pad, new THREE.Vector3(1, 0, 0))

const free = new FlyCam(renderer.domElement)
{
  const vec = (s: string | null, d: THREE.Vector3) => { const p = s?.split(',').map(Number); return p && p.length === 3 && p.every(Number.isFinite) ? new THREE.Vector3(...(p as [number, number, number])) : d }
  free.pos.copy(vec(q.get('cam'), new THREE.Vector3(0, PLANET_RADIUS * 0.9, PLANET_RADIUS * 2.6)))
  free.lookAt(vec(q.get('at'), new THREE.Vector3(0, 0, 0)))
}
const burn = Number(q.get('burn') ?? 0)

const hud = document.getElementById('hud')!
const dir = new THREE.Vector3()
const viewPos = new THREE.Vector3(), viewQuat = new THREE.Quaternion()
let last = performance.now(), frames = 0, fps = 0, fpsAt = last, updates = 0, elapsed = 0
let crashedAt: number | null = null
addEventListener('keydown', (e) => { if (e.code === 'KeyR' && mode === 'fly') respawn() })
function respawn() { craft.spawnOn(pad, new THREE.Vector3(1, 0, 0)); crashedAt = null }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; elapsed += dt
  let altitude: number, line: string

  if (mode === 'fly') {
    let c: Controls = input.read()
    if (burn > 0 && elapsed < burn) c = { ...c, thrust: 1 }
    craft.step(dt, c)
    if (craft.state === 'crashed') { crashedAt ??= now; if (now - crashedAt > 2000) respawn() }
    ship.position.copy(craft.pos)
    ship.quaternion.copy(craft.quat)
    flame.visible = craft.thrusting && craft.state === 'flying'
    chase.update(dt, craft)
    viewPos.copy(chase.pos); viewQuat.copy(chase.quat)
    altitude = craft.altitude()
    if (Math.abs(altitude) < 0.05) altitude = 0
    const lc = craft.lastContact
    line = `alt ${altitude.toFixed(1).padStart(6)} m   v↑ ${craft.vUp().toFixed(1).padStart(5)} m/s   spd ${craft.vel.length().toFixed(1).padStart(5)} m/s   tilt ${craft.tilt().toFixed(0).padStart(2)}°   ${craft.state.toUpperCase()}   landings ${craft.landings}  crashes ${craft.crashes}\n` +
      (craft.state === 'crashed' ? `contact: v↑ ${lc.vUp.toFixed(1)}  drift ${lc.vH.toFixed(1)}  tilt ${lc.tilt.toFixed(0)}°  slope ${lc.slope.toFixed(0)}°   (R to respawn)\n` : '') +
      `space thrust   W/S tilt   A/D roll   Q/E yaw   R respawn   ${fps} fps   chunks ${planet.liveCount}`
  } else {
    dir.copy(free.pos).normalize()
    altitude = free.pos.length() - PLANET_RADIUS - height(dir, MASTER_SEED)
    const speed = free.update(dt, altitude)
    viewPos.copy(free.pos); viewQuat.copy(free.quat)
    const [lo, hi] = planet.levelRange()
    line = `alt ${altitude.toFixed(0)} m   speed ${speed.toFixed(0)} m/s   chunks ${planet.liveCount} (+${planet.pendingCount})   lod ${lo}..${hi}   ${fps} fps\nWASD move  R/F up/down  Q/E roll  drag to look  shift = fast`
  }

  background.lerpColors(SKY, SPACE, Math.min(1, Math.max(0, altitude / 900)))
  planet.update(viewPos); updates++
  world.position.copy(viewPos).negate()
  camera.quaternion.copy(viewQuat)
  renderer.render(scene, camera)

  frames++
  if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now }
  hud.textContent = line
})

// For the harnesses.
;(window as unknown as { __noelite: unknown }).__noelite = {
  mode, planet, craft, input, free,
  /** True only once the LOD has run at least once and its queue is empty. */
  ready: () => updates > 0 && planet.pendingCount === 0,
  /** Free mode: put the camera at p looking at a. */
  place: (px: number, py: number, pz: number, ax: number, ay: number, az: number) => { free.pos.set(px, py, pz); free.lookAt(new THREE.Vector3(ax, ay, az)) },
  altitude: () => mode === 'fly' ? craft.altitude() : free.pos.length() - PLANET_RADIUS - height(free.pos.clone().normalize(), MASTER_SEED),
  respawn,
}
