// The solar system, rendered in home's rotating frame (stage B). Every body is
// a group placed by its Kepler position and spin relative to home; near ones
// are LOD terrain, far ones colour-mapped spheres, the sun an emissive ball
// with a point light. The craft and the harnesses still live in home's frame;
// stage C moves them to the heliocentric one.
//
//   default        fly the craft (space thrusts, shift boosts, W/S A/D tilt, Q/E yaw, R respawn, M mute)
//                  drag orbits the camera, wheel zooms, C snaps it back
//                  X points against velocity, Z at the planet, T at the target; Tab cycles the target
//                  in air the ship hovers (thrust up, tilt to move); in vacuum it cruises (thrust forward, / brakes)
//                  , . side thrusters, / top thruster (pushes down), ' rear thruster (pushes forward)
//   ?mode=free     step-1 fly camera, for the LOD harness and screenshots
//   ?cam=&at=      free-mode camera placement
//   ?burn=N        full thrust for the first N seconds, for screenshots
//   ?t=SECONDS     start the clock here, for dawn and dusk shots (tools/sun-times.mjs)
//   ?wire=1  ?skirts=0|red  ?no=dust,shadow,flame   renderer debug
//   ?over=home-1:300   start hanging over another body (id:altitude, optionally :x,y,z direction)
//   ?pitch=-1.2        chase camera orbit pitch in radians (negative looks up from under the ship)
import * as THREE from 'three'
import { PlanetLOD } from './world/lod.ts'
import { FlyCam } from './engine/FlyCam.ts'
import { Craft, type Controls } from './engine/Craft.ts'
import { KeyInput } from './engine/Input.ts'
import { ChaseCam } from './engine/ChaseCam.ts'
import { buildCraftMesh } from './engine/craftMesh.ts'
import { GroundShadow } from './engine/GroundShadow.ts'
import { Dust } from './engine/Dust.ts'
import { Beeper } from './engine/Beeper.ts'
import { Sky } from './engine/Sky.ts'
import { NavMarkers } from './engine/NavMarkers.ts'
import { waterOf, height, HOME, terrainOf, padOf, type Terrain } from './world/height.ts'
import { buildPad } from './engine/Pad.ts'
import { slopeDeg } from './world/terrain.ts'
import { atmosphereDensity, buildAtmosphereShell } from './world/atmosphere.ts'
import { SYSTEM, body, bodyPosition, bodySpin, type Body } from './world/system.ts'
import { terrainColour, facetJitter, SEA } from './world/palette.ts'
import { Water } from './engine/Water.ts'
import { OrbitAutopilot } from './engine/Autopilot.ts'
import { Rain } from './engine/Rain.ts'
import { Clouds } from './engine/Clouds.ts'
import { CloudPuffs } from './engine/CloudPuffs.ts'
import { front, rainOf, cloudOf, moonDirection, TIDE_AMPLITUDE } from './world/weather.ts'
import { setGroundClock } from './world/terrain.ts'
import { LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE , FUEL_TANK } from './world/config.ts'

const q = new URLSearchParams(location.search)
const mode: 'fly' | 'free' = q.get('mode') === 'free' ? 'free' : 'fly'

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000000)
// Sky dome and stars. Scene root, so camera-centred for free.
const SKY = new THREE.Color(0x5d9be0)
const sky = new Sky()
scene.add(sky.group)
// Haze inside home's atmosphere, the sky's horizon colour, thinning with density.
const fog = new THREE.FogExp2(SKY.getHex(), 0)
scene.fog = fog

// The camera never leaves the origin. The world moves around it.
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 1e10) // the giant is 4.9 million km out; log depth buffer copes
const world = new THREE.Group()
scene.add(world)

// The sun is a body; it lights as a point light with no falloff, so every
// planet is lit from its own side of the sky. Plus a hemisphere fill.
const sunLight = new THREE.PointLight(0xfff2dc, 2.4, 0, 0)
const hemi = new THREE.HemisphereLight(0x9ec5ff, 0x3f5f2e, 0.85)
scene.add(sunLight, hemi)
const SUN_WHITE = new THREE.Color(0xfff2dc), SUN_LOW = new THREE.Color(0xffa060), GREY = new THREE.Color(0.58, 0.61, 0.65)
let weatherFront = -1, rainNow = 0, cloudNow = 0, windNow = 0

// flatShading is deliberately OFF. With it on, Three ignores the normal
// attribute and derives normals from screen-space derivatives, which lit every
// skirt as the vertical wall it is and drew a dark line along every LOD seam.
// The chunk builder supplies true per-facet normals on non-indexed geometry.
const wire = q.get('wire') === '1'
const terrainMaterial = wire ? new THREE.MeshBasicMaterial({ wireframe: true, color: 0x9fe3a0 }) : new THREE.MeshLambertMaterial({ vertexColors: true })
terrainMaterial.name = 'terrain'
// Other bodies are seen through home's air, and fog would erase them. No fog on them.
const bodyMaterial = wire ? terrainMaterial : new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })
bodyMaterial.name = 'body'
const skirts = q.get('skirts') === '0' ? false : q.get('skirts') === 'red' ? 'red' : true

/** A colour-mapped sphere for a body seen from far away. The sun glows. */
function buildFarSphere(b: Body, t: Terrain): THREE.Mesh {
  if (b.kind === 'sun') {
    const m = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xffe6a0, emissiveIntensity: 1.5, fog: false })
    m.name = 'sun'
    return new THREE.Mesh(new THREE.IcosahedronGeometry(b.radius, 3), m)
  }
  const g = new THREE.IcosahedronGeometry(b.radius, b.kind === 'giant' ? 5 : 4).toNonIndexed()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  const c = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 3) {
    c.set(0, 0, 0)
    for (let k = 0; k < 3; k++) c.x += pos.getX(i + k) / 3, c.y += pos.getY(i + k) / 3, c.z += pos.getZ(i + k) / 3
    c.normalize()
    const h = height(c, t)
    const lat = c.x * t.axis.x + c.y * t.axis.y + c.z * t.axis.z
    const hNorm = t.amplitude ? h / t.amplitude : 0
    const [r, gg, bb] = t.sea !== null && h < t.sea ? SEA : terrainColour(t.kind, hNorm, 0, facetJitter(c.x * 977, c.y * 977, c.z * 977), lat, t.sea === null || !t.amplitude ? hNorm : (h - t.sea) / t.amplitude)
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = r; col[(i + k) * 3 + 1] = gg; col[(i + k) * 3 + 2] = bb }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return new THREE.Mesh(g, bodyMaterial)
}

const SHELL_COLOUR: Record<string, number> = { terrestrial: 0x5d9be0, hot: 0xd08050, giant: 0xd8b890 }
type BodyView = {
  body: Body; terrain: Terrain; group: THREE.Group; far: THREE.Mesh; lod: PlanetLOD | null; water: PlanetLOD | null; clouds: Clouds | null
  shellSun: THREE.Vector3 | null; rel: THREE.Vector3
}
const waterMat = new Water()
const home = body('home'), sunBody = body('sun')
const views: BodyView[] = SYSTEM.map((b) => {
  const terrain = b.id === 'home' ? HOME : terrainOf(b)
  const group = new THREE.Group()
  world.add(group)
  const far = buildFarSphere(b, terrain)
  group.add(far)
  let lod: PlanetLOD | null = null, water: PlanetLOD | null = null
  if (b.kind !== 'sun' && b.kind !== 'giant') { lod = new PlanetLOD(terrain, b.id === 'home' ? terrainMaterial : bodyMaterial, skirts); group.add(lod.group) }
  if (lod && terrain.sea !== null) { water = new PlanetLOD(waterOf(terrain), waterMat.material, skirts); group.add(water.group) }
  let clouds: Clouds | null = null
  if (lod && terrain.air > 0) { clouds = new Clouds(terrain, terrain.air * 0.6); group.add(clouds.mesh) }
  let shellSun: THREE.Vector3 | null = null
  if (b.atmosphereHeight > 0) {
    const shell = buildAtmosphereShell(new THREE.Vector3(1, 0, 0), new THREE.Color(SHELL_COLOUR[b.kind] ?? 0x5d9be0), b.radius, b.atmosphereHeight)
    group.add(shell)
    shellSun = (shell.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3
  }
  return { body: b, terrain, group, far, lod, water, clouds, shellSun, rel: new THREE.Vector3() }
})
const homeView = views.find((v) => v.body === home)!
const sunView = views.find((v) => v.body === sunBody)!
/** Home's LOD, for the harness and the HUD. */
const planet = homeView.lod!

// The craft, its pad, its camera, its feedback stack. All in home's frame.
const craft = new Craft(HOME)
const input = new KeyInput()
const chase = new ChaseCam(HOME)
chase.orbitPitch = Math.min(ChaseCam.MAX_PITCH, Math.max(-ChaseCam.MAX_PITCH, Number(q.get('pitch') ?? 0)))
const shipMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
shipMaterial.name = 'ship'
const { root: ship, flame, rcs, gear, morph } = buildCraftMesh(shipMaterial)
/** 0 dart, 1 TIE. Follows the craft's cruise flag over about a second and a half. */
let morphed = 0
/** 1 down, 0 up. Goes up above GEAR_ALT over the ground, down below it, over about a second. */
let gearDown = 1
const GEAR_ALT = 100
;(flame.material as THREE.Material).name = 'flame'
ship.renderOrder = 2
homeView.group.add(ship)
ship.visible = mode === 'fly'
const padSite = padOf(HOME)!
const pad = new THREE.Vector3(padSite.dir.x, padSite.dir.y, padSite.dir.z)
{ const padMesh = buildPad(HOME); if (padMesh) homeView.group.add(padMesh) }
const shadow = new GroundShadow(HOME)
const dust = new Dust(HOME)
const rain = new Rain()
const puffs = new CloudPuffs()
const beeper = new Beeper()
homeView.group.add(shadow.mesh, dust.points, rain.lines, puffs.mesh)
shadow.mesh.visible = dust.points.visible = mode === 'fly'
/** The view whose frame the scene is drawn in: the craft's reference body. Ship, shadow and dust live in it. */
let refView = homeView
function switchFrame(): void {
  refView = views.find((v) => v.body === craft.ref)!
  refView.group.add(ship, shadow.mesh, dust.points, rain.lines, puffs.mesh)
  shadow.terrain = dust.terrain = chase.terrain = craft.terrain
  chase.snap()
}
const off = new Set((q.get('no') ?? '').split(','))
if (off.has('dust')) dust.points.visible = false
if (off.has('shadow')) shadow.mesh.visible = false

const free = new FlyCam(renderer.domElement)
{
  const vec = (s: string | null, d: THREE.Vector3) => { const p = s?.split(',').map(Number); return p && p.length === 3 && p.every(Number.isFinite) ? new THREE.Vector3(...(p as [number, number, number])) : d }
  free.pos.copy(vec(q.get('cam'), new THREE.Vector3(0, HOME.radius * 0.9, HOME.radius * 2.6)))
  free.lookAt(vec(q.get('at'), new THREE.Vector3(0, 0, 0)))
}
const burn = Number(q.get('burn') ?? 0)
// Default clock: mid-morning on the pad (tools/sun-times.mjs: dawn 103, noon 702, dusk 1301).
const clock0 = Number(q.get('t') ?? 350)
craft.time = clock0
craft.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'surface', home)
// ?over=<body id>:<altitude m> starts you hanging over another body instead: over=home-1:300 is the moon.
{
  const over = q.get('over')
  if (over) {
    const [id, alt, at] = over.split(':')
    const d = at?.split(',').map(Number)
    craft.placeAbove(body(id), d && d.length === 3 && d.every(Number.isFinite) ? new THREE.Vector3(d[0], d[1], d[2]) : new THREE.Vector3(0, 0, 1), Number(alt) || 500)
  }
}
const markers = new NavMarkers(document.body)
const orbitAP = new OrbitAutopilot()

const hud = document.getElementById('hud')!
const altimeter = document.getElementById('altimeter')!
const altFill = altimeter.querySelector<HTMLElement>('.fill')!, altMarker = altimeter.querySelector<HTMLElement>('.marker')!
const altNum = document.getElementById('alt-num')!, altState = document.getElementById('alt-state')!
const lights = { v: document.getElementById('l-v')!, d: document.getElementById('l-d')!, t: document.getElementById('l-t')!, s: document.getElementById('l-s')! }
altimeter.hidden = mode !== 'fly'
const light = (el: HTMLElement, text: string, ok: boolean, armed: boolean) => { el.textContent = text; el.className = armed ? (ok ? 'ok' : 'bad') : '' }
const atmosEl = document.getElementById('atmos')!
const fuelEl = document.getElementById('fuel')!
// Drag orbits the chase camera, wheel zooms, C resets.
{
  let dragging = false, lx = 0, ly = 0
  renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY })
  addEventListener('mouseup', () => { dragging = false })
  addEventListener('mousemove', (e) => {
    if (!dragging || mode !== 'fly') return
    chase.orbitYaw -= (e.clientX - lx) * 0.006
    chase.orbitPitch = Math.min(ChaseCam.MAX_PITCH, Math.max(-ChaseCam.MAX_PITCH, chase.orbitPitch + (e.clientY - ly) * 0.006))
    lx = e.clientX; ly = e.clientY
  })
  addEventListener('wheel', (e) => { if (mode === 'fly') chase.zoom = Math.min(3, Math.max(0.4, chase.zoom * Math.pow(1.1, e.deltaY / 100))) }, { passive: true })
}

const dir = new THREE.Vector3(), tmp = new THREE.Vector3(), sunDir = new THREE.Vector3()
const fmtSpeed = (v: number) => v < 10_000 ? `${v.toFixed(v < 100 ? 1 : 0)} m/s` : `${(v / 1000).toFixed(0)} km/s`
const fmtDist = (d: number) => d < 1e6 ? `${(d / 1000).toFixed(1)} km` : d < 1e9 ? `${(d / 1e6).toFixed(0)}k km` : `${(d / 1e9).toFixed(2)}M km`
const fmtTime = (s: number) => s < 90 ? `${s.toFixed(0)} s` : s < 5400 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`
const qHome = new THREE.Quaternion(), qHomeInv = new THREE.Quaternion(), qBody = new THREE.Quaternion(), qLocal = new THREE.Quaternion()
const pHome = new THREE.Vector3(), pBody = new THREE.Vector3(), camLocal = new THREE.Vector3()
const viewPos = new THREE.Vector3(), viewQuat = new THREE.Quaternion()
let last = performance.now(), frames = 0, fps = 0, fpsAt = last, updates = 0, elapsed = 0
// Stamped by place(): ready() must see an LOD update newer than the last camera move,
// otherwise a harness can read the queue in the gap before the move is noticed.
let placedAt = -1
let crashedAt: number | null = null
// Targeting: Tab cycles through every body, home included, so there is always a way back.
const targets = views.slice()
let targetIndex = 0
const toTarget = new THREE.Vector3()
addEventListener('keydown', (e) => {
  beeper.arm()
  if (mode !== 'fly') return
  if (e.code === 'KeyR') respawn()
  if (e.code === 'KeyM') beeper.muted = !beeper.muted
  if (e.code === 'KeyC') chase.reset()
  if (e.code === 'KeyO') orbitAP.engaged = !orbitAP.engaged && craft.state === 'flying'
  if (e.code === 'Tab') { e.preventDefault(); targetIndex = (targetIndex + 1) % targets.length }
})
function respawn() { craft.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'surface', home); if (refView.body !== craft.ref) switchFrame(); crashedAt = null }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

/** Place every body relative to `frame`'s rotating frame and the viewer. */
function placeBodies(t: number, frame: Body): void {
  bodyPosition(frame, t, pHome)
  bodySpin(frame, t, qHome)
  qHomeInv.copy(qHome).invert()
  for (const v of views) {
    // Position in home's frame, then in scene space (camera at the origin).
    bodyPosition(v.body, t, pBody).sub(pHome).applyQuaternion(qHomeInv)
    v.rel.copy(pBody)
    v.group.position.copy(pBody).sub(viewPos)
    v.group.quaternion.copy(qHomeInv).multiply(bodySpin(v.body, t, qBody))
    if (v.lod) {
      const near = v.body === frame || v.rel.distanceTo(viewPos) < 40 * v.body.radius
      v.lod.group.visible = near
      if (v.water) v.water.group.visible = near
      if (v.clouds) v.clouds.mesh.visible = near
      v.far.visible = !near
      if (near) {
        // The LOD thinks in the body's own frame: viewer relative to the body, un-spun.
        camLocal.copy(viewPos).sub(v.rel).applyQuaternion(qLocal.copy(v.group.quaternion).invert())
        v.lod.update(camLocal)
        v.water?.update(camLocal)
      }
    }
    if (v.shellSun) v.shellSun.copy(sunView.rel).sub(v.rel).normalize()
  }
  // The sun, from the viewer.
  sunDir.copy(sunView.rel).sub(viewPos).normalize()
  sunLight.position.copy(sunView.rel).sub(viewPos)
}

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; elapsed += dt
  const t = clock0 + elapsed
  let altitude: number, line: string

  if (mode === 'fly') {
    let c: Controls = input.read()
    if (burn > 0 && elapsed < burn) c = { ...c, thrust: 1 }
    // The orbit autopilot flies until you touch anything.
    if (orbitAP.engaged && (c.thrust || c.pitch || c.roll || c.yaw || c.vertical || c.lateral || c.fore || craft.state !== 'flying')) orbitAP.engaged = false
    if (orbitAP.engaged) c = orbitAP.controls(craft)
    const assist = orbitAP.engaged ? null : input.assist()
    const tgt = targets[targetIndex]
    toTarget.copy(tgt.rel).sub(craft.pos)
    if (assist && craft.state === 'flying') {
      dir.copy(craft.pos).normalize()
      const target = assist === 'nadir' ? dir.clone().negate()
        : assist === 'target' ? toTarget.clone().normalize()
        : craft.speed() > 0.5 ? craft.vel.clone().normalize().negate() : dir.clone()
      const a = craft.aimControls(target)
      c = { ...c, pitch: a.pitch, roll: a.roll, yaw: a.yaw }
    }
    // A target within 30° of the nose caps cruise so you arrive at it; otherwise only the nearest body does.
    tmp.set(0, 0, -1).applyQuaternion(craft.quat)
    craft.arrive = toTarget.lengthSq() > 0 && tmp.dot(toTarget) / toTarget.length() > 0.86 ? toTarget.length() - tgt.body.radius : Infinity
    craft.step(dt, c)
    if (refView.body !== craft.ref) switchFrame()
    if (craft.state === 'crashed') { crashedAt ??= now; if (now - crashedAt > 2000) respawn() }
    ship.position.copy(craft.pos)
    ship.quaternion.copy(craft.quat)
    const flying = craft.state === 'flying'
    morphed += ((craft.cruise ? 1 : 0) - morphed) * Math.min(1, dt / 0.5)
    morph.set(morphed)
    // The hover engine fires down; in cruise the boosters fire back. Hand over halfway through the morph.
    flame.visible = craft.thrusting && flying && morphed < 0.5
    for (const f of morph.cruiseFlames) f.visible = craft.thrusting && flying && morphed >= 0.5
    rcs.right.visible = flying && c.lateral < 0
    rcs.left.visible = flying && c.lateral > 0
    rcs.top.visible = flying && c.vertical < 0
    rcs.rear.visible = flying && c.fore > 0
    altitude = craft.altitude()
    {
      const want = craft.state !== 'flying' || altitude < GEAR_ALT ? 1 : 0
      gearDown += (want - gearDown) * Math.min(1, dt / 0.35)
      const sy = Math.max(0.03, gearDown)
      for (const g of gear) g.scale.y = sy
    }
    chase.update(dt, craft, atmosphereDensity(altitude, craft.terrain.air))
    viewPos.copy(chase.pos); viewQuat.copy(chase.quat)
    if (Math.abs(altitude) < 0.05) altitude = 0
    if (!off.has('shadow')) shadow.update(craft)
    if (!off.has('dust')) dust.update(dt, craft.pos, altitude, flame.visible)
    // Weather at the craft.
    dir.copy(craft.pos).normalize()
    weatherFront = front(dir, craft.terrain, craft.time)
    rainNow = craft.atmosphere() > 0 ? rainOf(weatherFront) : 0
    cloudNow = craft.atmosphere() > 0 ? cloudOf(weatherFront) : 0
    windNow = craft.wind.length()
    if (!off.has('rain')) rain.update(dt, craft.pos, craft.wind, rainNow, craft.atmosphere())
    if (!off.has('clouds')) puffs.update(craft.pos, craft.terrain, craft.time)
    if (off.has('flame')) { flame.visible = false; for (const f of morph.cruiseFlames) f.visible = false }
    beeper.update(now / 1000, altitude, flying)

    // Altimeter and the four landing lights. They arm below 60 m so they mean something.
    const vUp = craft.vUp(), tilt = craft.tilt()
    dir.copy(craft.pos).normalize()
    const drift = Math.sqrt(Math.max(0, craft.vel.lengthSq() - vUp * vUp)), slope = slopeDeg(dir, craft.terrain)
    const armed = flying && altitude < 60
    const frac = Math.min(1, Math.max(0, altitude / 120))
    altFill.style.height = `${frac * 100}%`; altMarker.style.bottom = `${frac * 100}%`
    altNum.textContent = altitude < 100 ? altitude.toFixed(1) : altitude.toFixed(0)
    altimeter.className = !flying ? '' : altitude < 15 ? 'critical' : altitude < 40 ? 'low' : ''
    light(lights.v, `V↑ ${vUp.toFixed(1)}`, vUp > -LAND_MAX_VSPEED, armed)
    light(lights.d, `DRIFT ${drift.toFixed(1)}`, drift < LAND_MAX_HSPEED, armed)
    light(lights.t, `TILT ${tilt.toFixed(0)}°`, tilt < LAND_MAX_TILT, armed)
    light(lights.s, `SLOPE ${slope.toFixed(0)}°`, slope < LAND_MAX_SLOPE, armed)
    altState.textContent = craft.state === 'landed' ? 'DOWN' : craft.state === 'crashed' ? 'CRASHED' : gearDown > 0.5 ? 'GEAR ↓' : 'GEAR ↑'
    const rho = craft.atmosphere()
    atmosEl.textContent = rho > 0 ? `ATMOS ${(rho * 100).toFixed(0)}%   WIND ${windNow.toFixed(0)} m/s${rainNow > 0 ? `   RAIN ${(rainNow * 100).toFixed(0)}%` : cloudNow > 0.5 ? '   OVERCAST' : ''}` : 'VACUUM'
    atmosEl.className = rho > 0 ? '' : 'vacuum'
    // Fuel: the tank, what it costs right now, and how long that lasts. Shouts under 20%, and when dry.
    {
      const pct = (100 * craft.fuel / FUEL_TANK)
      const endure = craft.endurance()
      const refuel = craft.state === 'landed' && craft.fuel < FUEL_TANK ? (craft.onPad() ? '   REFUELLING' : '   SOLAR') : ''
      fuelEl.textContent = craft.fuel <= 0 ? 'FUEL DRY' + refuel : `FUEL ${pct.toFixed(0)}%${Number.isFinite(endure) ? `   ${fmtTime(endure)} at this burn` : ''}${refuel}`
      fuelEl.className = 'atmos ' + (craft.fuel <= 0 ? 'dry' : pct < 20 ? 'low' : '')
    }
    // Nav markers once the ground stops being the obvious reference.
    const showNav = flying && (altitude > 80 || rho < 0.5)
    markers.place('planet', dir.clone().negate(), camera, showNav)
    const moving = craft.speed() > 2
    const pro = craft.vel.clone().normalize()
    markers.place('pro', pro, camera, showNav && moving)
    markers.place('retro', pro.clone().negate(), camera, showNav && moving)
    const tDist = toTarget.length(), tDir = toTarget.clone().divideScalar(tDist)
    const closing = -craft.vel.dot(tDir)
    const tSurf = Math.max(0, tDist - tgt.body.radius)
    const eta = closing > 1 ? `  ETA ${fmtTime(tSurf / closing)}` : ''
    markers.place('target', tDir, camera, showNav, `${tgt.body.name}  ${fmtDist(tSurf)}  ${closing >= 0 ? '↓' : '↑'}${fmtSpeed(Math.abs(closing))}${eta}`)
    const lc = craft.lastContact
    const vOrb = craft.orbitalSpeed(), vEsc = craft.escapeSpeed(), spd = craft.speed(), vIn = craft.inertialSpeed()
    const apLine = orbitAP.engaged ? `AUTOPILOT ${orbitAP.phase.toUpperCase()} ${craft.ref.name}  park ${((orbitAP.parkRadius(craft) - craft.terrain.radius) / 1000).toFixed(0)} km at ${orbitAP.parkSpeed(craft).toFixed(0)} m/s  (any control releases)` : 'O orbit'
    const spaceLine = rho < 1 ? `${craft.cruise ? `CRUISE  cap ${fmtSpeed(craft.cap())}  (thrust forward, / brakes)` : 'HOVER'}   ${apLine}   SOI ${craft.ref.name}   orbit ${vOrb.toFixed(0)}   escape ${vEsc.toFixed(0)}   ${craft.cruise ? '' : vIn > vEsc ? '!! ESCAPING !!' : vIn > vOrb ? 'above orbital' : ''}   target ${tgt.body.name} (Tab)   T aim   X retro   Z planet\n` : ''
    line = `alt ${altitude.toFixed(1).padStart(6)} m   v↑ ${vUp.toFixed(1).padStart(5)} m/s   spd ${fmtSpeed(spd).padStart(9)}   tilt ${tilt.toFixed(0).padStart(2)}°   ${craft.state.toUpperCase()}   landings ${craft.landings}  crashes ${craft.crashes}\n` + spaceLine +
      (craft.state === 'crashed' ? `contact: v↑ ${lc.vUp.toFixed(1)}  drift ${lc.vH.toFixed(1)}  tilt ${lc.tilt.toFixed(0)}°  slope ${lc.slope.toFixed(0)}°   (R to respawn)\n` : '') +
      `space thrust   shift boost   W/S tilt   A/D roll   Q/E yaw   , . side   / top   ' rear   X/Z assists   R respawn   M mute   drag orbit   wheel zoom   C reset   ${fps} fps   chunks ${refView.lod?.liveCount ?? 0}`
  } else {
    setGroundClock(t)
    weatherFront = -1; rainNow = 0; cloudNow = 0; windNow = 4
    puffs.update(free.pos, HOME, t)
    dir.copy(free.pos).normalize()
    altitude = free.pos.length() - HOME.radius - height(dir, HOME)
    const speed = free.update(dt, altitude)
    viewPos.copy(free.pos); viewQuat.copy(free.quat)
    const [lo, hi] = planet.levelRange()
    line = `alt ${altitude.toFixed(0)} m   speed ${speed.toFixed(0)} m/s   chunks ${planet.liveCount} (+${planet.pendingCount})   lod ${lo}..${hi}   ${fps} fps\nWASD move  R/F up/down  Q/E roll  drag to look  shift = fast`
    markers.hide()
  }

  placeBodies(mode === 'fly' ? craft.time : t, mode === 'fly' ? craft.ref : home); updates++
  const ft = mode === 'fly' ? craft.terrain : HOME

  // "How day is it" uses the sun's APPARENT elevation: level elevation plus the
  // horizon dip at this altitude. On a 40 km world the horizon drops 7° by 300 m,
  // so the sun that set on the pad is back above the horizon once you climb.
  const density = atmosphereDensity(altitude, ft.air)
  dir.copy(viewPos).normalize()
  const sinApp = Sky.apparentSunElevation(dir, sunDir, altitude, ft.radius)
  const sinDip = Math.sin(Math.acos(Math.min(1, ft.radius / (ft.radius + Math.max(0, altitude)))))
  const day = sky.update(dir, sunDir, density, sinApp, sinDip)
  const simTime = mode === 'fly' ? craft.time : t
  const hasMoon = mode === 'fly' && moonDirection(craft.terrain, craft.time, tmp)
  waterMat.update(simTime, sunDir, day, windNow, hasMoon ? tmp : null, TIDE_AMPLITUDE)
  if (mode === 'fly') refView.clouds?.update(craft.time, sunDir, day, altitude)
  else homeView.clouds?.update(t, sunDir, day, altitude)
  // Under cloud the light goes flat and grey; in rain the air thickens.
  const overcast = cloudNow * density
  hemi.position.copy(dir) // the fill's "sky" is the local up, not scene +Y
  hemi.intensity = 0.85 * (0.2 + 0.8 * day) * (1 - 0.3 * overcast)
  sunLight.intensity = 2.4 * (1 - 0.65 * overcast)
  sunLight.color.lerpColors(SUN_LOW, SUN_WHITE, Math.min(1, Math.max(0, (sinApp + 0.05) / 0.25)))
  fog.color.copy(sky.horizon).lerp(GREY, overcast * 0.7)
  fog.density = 0.00055 * density * (1 + 2.5 * rainNow + 0.8 * overcast)

  camera.quaternion.copy(viewQuat)
  renderer.render(scene, camera)

  frames++
  if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now }
  hud.textContent = line
})
void tmp

// For the harnesses.
;(window as unknown as { __noelite: unknown }).__noelite = {
  mode, planet, craft, input, free, views,
  /** True only once the LOD has updated since the last place() and its queue is empty. */
  ready: () => updates > placedAt + 1 && planet.pendingCount === 0,
  /** Free mode: put the camera at p looking at a. */
  place: (px: number, py: number, pz: number, ax: number, ay: number, az: number) => { free.pos.set(px, py, pz); free.lookAt(new THREE.Vector3(ax, ay, az)); placedAt = updates },
  altitude: () => mode === 'fly' ? craft.altitude() : free.pos.length() - HOME.radius - height(free.pos.clone().normalize(), HOME),
  respawn,
}
