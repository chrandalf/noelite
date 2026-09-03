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
//   ?yaw=1.3           chase camera orbit yaw in radians (from the side)
//   ?menu=1            start paused with the menu up (for shots)
//   ?field=home-l4:2000:3   start in cruise 2 km off rock 3 of home's leading Trojans
//   ?fuel=20           start with 20 units in the tank
//   ?station=2         start landed on pad 2 of home's station (0: hanging 300 m over it)
import * as THREE from 'three'
import { PlanetLOD } from './world/lod.ts'
import { FlyCam } from './engine/FlyCam.ts'
import { Craft, type Controls } from './engine/Craft.ts'
import { KeyInput } from './engine/Input.ts'
import { ChaseCam } from './engine/ChaseCam.ts'
import { buildCraftMesh } from './engine/craftMesh.ts'
import { GroundShadow } from './engine/GroundShadow.ts'
import { Dust } from './engine/Dust.ts'
import { Marks } from './engine/Marks.ts'
import { Sound } from './engine/Sound.ts'
import { Sky } from './engine/Sky.ts'
import { NavMarkers } from './engine/NavMarkers.ts'
import { waterOf, height, HOME, terrainOf, padOf, stationOf, type Terrain, type Station } from './world/height.ts'
import { buildPad } from './engine/Pad.ts'
import { buildStation, updateStation, type StationView } from './engine/Station.ts'
import { buildBase, updateBase, type BaseView } from './engine/Base.ts'
import { slopeDeg } from './world/terrain.ts'
import { atmosphereDensity, buildAtmosphereShell } from './world/atmosphere.ts'
import { SYSTEM, body, bodyPosition, bodySpin, type Body } from './world/system.ts'
import { terrainColour, facetJitter, SEA } from './world/palette.ts'
import { Water } from './engine/Water.ts'
import { OrbitAutopilot } from './engine/Autopilot.ts'
import { Asteroids } from './engine/Asteroids.ts'
import { FIELDS, fieldPosition, fieldOf, type Field } from './world/asteroids.ts'
import { Rain } from './engine/Rain.ts'
import { Clouds } from './engine/Clouds.ts'
import { CloudPuffs } from './engine/CloudPuffs.ts'
import { front, rainOf, cloudOf, moonDirection, TIDE_AMPLITUDE } from './world/weather.ts'
import { setGroundClock } from './world/terrain.ts'
import { LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE , FUEL_TANK, HULL_CLEARANCE, HULL_LIMIT, HULL_WARN, HULL_GLOW, CLOUD_BASE_FRAC, shownDistance } from './world/config.ts'

const q = new URLSearchParams(location.search)
const mode: 'fly' | 'free' = q.get('mode') === 'free' ? 'free' : 'fly'
// Dawn Shift: the opening. On by default on a plain start (no URL parameters), ?intro=1 forces
// it, ?intro=0 skips it. Cold open on the pad in the dark, 103 s before sunrise (tools/sun-times).
const intro = q.get('intro') === '1' || (q.get('intro') !== '0' && location.search === '' && mode === 'fly')

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
// A point light has no planet in the way, so at night it lit the pad from below the horizon.
// The local sun (layer 0) follows the daylight at the viewer; the far sun (layer 1) lights
// the other bodies at full, so the moon keeps its phase.
const farSun = new THREE.PointLight(0xfff2dc, 2.4, 0, 0)
farSun.layers.set(1)
const hemi = new THREE.HemisphereLight(0x9ec5ff, 0x3f5f2e, 0.85)
scene.add(sunLight, farSun, hemi)
const SUN_WHITE = new THREE.Color(0xfff2dc), SUN_LOW = new THREE.Color(0xffa060), GREY = new THREE.Color(0.58, 0.61, 0.65)
let weatherFront = -1, rainNow = 0, cloudNow = 0, windNow = 0
/** Last frame's daylight at the viewer, 1 noon, 0 night. */
let dayNow = 1

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
  if (lod && terrain.air > 0) { clouds = new Clouds(terrain, terrain.air * CLOUD_BASE_FRAC); group.add(clouds.mesh) }
  let shellSun: THREE.Vector3 | null = null
  if (b.atmosphereHeight > 0) {
    const shell = buildAtmosphereShell(new THREE.Vector3(1, 0, 0), new THREE.Color(SHELL_COLOUR[b.kind] ?? 0x5d9be0), b.radius, b.atmosphereHeight)
    group.add(shell)
    shellSun = (shell.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3
  }
  return { body: b, terrain, group, far, lod, water, clouds, shellSun, rel: new THREE.Vector3() }
})
// Far spheres (the moon in the sky, the planets) are lit by the sun alone: the hemisphere
// fill is the local sky and would light the moon's night side. Layer 1 has the sun and no fill.
for (const v of views) if (v.body.kind !== 'sun') v.far.layers.set(1)
camera.layers.enable(1)
const homeView = views.find((v) => v.body === home)!
const sunView = views.find((v) => v.body === sunBody)!
/** Home's LOD, for the harness and the HUD. */
const planet = homeView.lod!

// The craft, its pad, its camera, its feedback stack. All in home's frame.
const craft = new Craft(HOME)
const input = new KeyInput()
const chase = new ChaseCam(HOME)
chase.orbitPitch = Math.min(ChaseCam.MAX_PITCH, Math.max(-ChaseCam.MAX_PITCH, Number(q.get('pitch') ?? 0)))
chase.orbitYaw = Number(q.get('yaw') ?? 0)
const shipMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
shipMaterial.name = 'ship'
const { root: ship, flame, rcs, gear, morph, strobe, glowMats, plasma, haze } = buildCraftMesh(shipMaterial)
/** 0 dart, 1 TIE. Follows the craft's cruise flag over about a second and a half. */
let morphed = 0
/** Muzzle flash timers, left and right, in ms of `now`. */
const flashUntil = [0, 0]
/** 1 down, 0 up. Goes up above GEAR_ALT over the ground, down below it, over about a second. */
let gearDown = 1
const GEAR_ALT = 100
;(flame.material as THREE.Material).name = 'flame'
ship.renderOrder = 2
// The ship lives at the scene root, placed camera-relative in float64 every frame. In a
// body's group it would be a child at up to 939 million metres (the sun's frame at home's
// distance) and Three multiplies matrices in float32, which puts it 100 m from where the
// camera is looking. Bodies never showed this: their frames are 40 km across.
world.add(ship)
ship.visible = mode === 'fly'
const padSite = padOf(HOME)!
const pad = new THREE.Vector3(padSite.dir.x, padSite.dir.y, padSite.dir.z)
{ const padMesh = buildPad(HOME); if (padMesh) homeView.group.add(padMesh) }
const shadow = new GroundShadow(HOME)
const dust = new Dust(HOME)
const marks = new Marks()
/** The opening's phase. 'off' is a normal start. */
let phase: 'off' | 'dark' | 'boot' | 'hover' | 'dawn' | 'done' = intro ? 'dark' : 'off'
let phaseAt = 0
let bootStage = 0
let idleSince = 0
let sinAppNow = 1
const SUNRISE_T = 103
const bootParts: HTMLElement[][] = []
const localTime = (t: number) => { const h = ((t % 2400) + 2400) % 2400 / 100; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }
/** Last frame's state, for the touchdown and lift-off moments. */
let lastState: 'landed' | 'flying' | 'crashed' = 'landed'
const rain = new Rain()
const puffs = new CloudPuffs()
const sound = new Sound()
homeView.group.add(shadow.mesh, dust.points, rain.lines, puffs.mesh, puffs.shadows, marks.group)
shadow.mesh.visible = dust.points.visible = mode === 'fly'
/** The view whose frame the scene is drawn in: the craft's reference body. Ship, shadow and dust live in it. */
let refView = homeView
function switchFrame(): void {
  refView = views.find((v) => v.body === craft.ref)!
  refView.group.add(shadow.mesh, dust.points, rain.lines, puffs.mesh, puffs.shadows, marks.group)
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
let clock0 = Number(q.get('t') ?? (intro ? 0 : 350))
craft.time = clock0
craft.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'surface', home)
// ?field=<field id>:<gap m>[:<rock index>] starts you in cruise off a rock in a field, nose on it: field=home-l4:2000
{
  const fp = q.get('field')
  if (fp) {
    const [id, gap, idx] = fp.split(':')
    const f = fieldOf(id)
    craft.placeNearRock(f.rocks[Math.min(f.rocks.length - 1, Number(idx) || 0)], Number(gap) || 2000)
  }
}
// ?station=<pad 1-4> starts landed on that pad of home's station; ?station=0 hangs 300 m over its dome.
{
  const sp = q.get('station')
  if (sp !== null) {
    const st = stationOf(HOME)!
    const n = Number(sp)
    if (n >= 1 && n <= 4) craft.spawnOn(new THREE.Vector3(st.pads[n - 1].dir.x, st.pads[n - 1].dir.y, st.pads[n - 1].dir.z), new THREE.Vector3(1, 0, 0), 'surface', home)
    else craft.placeAbove(home, new THREE.Vector3(st.site.dir.x, st.site.dir.y, st.site.dir.z), 300)
  }
}
// ?fuel=<units> starts with that much in the tank.
if (q.get('fuel') !== null) craft.fuel = Math.max(0, Math.min(FUEL_TANK, Number(q.get('fuel'))))
// ?over=<body id>:<altitude m> starts you hanging over another body instead: over=home-1:300 is the moon.
{
  const over = q.get('over')
  if (over) {
    const [id, alt, at] = over.split(':')
    const d = at?.split(',').map(Number)
    // No direction given: over the body's pad if it has one, so ?over=home:200 is the base from the air.
    const site = padOf(terrainOf(body(id)))
    craft.placeAbove(body(id), d && d.length === 3 && d.every(Number.isFinite) ? new THREE.Vector3(d[0], d[1], d[2]) : site ? new THREE.Vector3(site.dir.x, site.dir.y, site.dir.z) : new THREE.Vector3(0, 0, 1), Number(alt) || 500)
  }
}
const markers = new NavMarkers(document.body)
const orbitAP = new OrbitAutopilot()

const hud = document.getElementById('hud')!
const menu = document.getElementById('menu')!
const introEl = document.getElementById('intro')!
/** Escape. The sim stops, the picture stays, the menu shows the controls. */
let paused = q.get('menu') === '1'
menu.hidden = !paused
const altimeter = document.getElementById('altimeter')!
const altFill = altimeter.querySelector<HTMLElement>('.fill')!, altMarker = altimeter.querySelector<HTMLElement>('.marker')!
const altNum = document.getElementById('alt-num')!, altState = document.getElementById('alt-state')!
const lights = { v: document.getElementById('l-v')!, d: document.getElementById('l-d')!, t: document.getElementById('l-t')!, s: document.getElementById('l-s')! }
altimeter.hidden = mode !== 'fly'
{
  const part = (sel: string) => Array.from(altimeter.querySelectorAll<HTMLElement>(sel))
  bootParts.push(part('.lights'), part('.scale, .readout'), part('#fuel'), part('.state, .atmos:not(#fuel)'))
  if (intro) for (const ps of bootParts) for (const e of ps) e.style.visibility = 'hidden'
}
const light = (el: HTMLElement, text: string, ok: boolean, armed: boolean) => { el.textContent = text; el.className = armed ? (ok ? 'ok' : 'bad') : '' }
const atmosEl = document.getElementById('atmos')!
const fuelEl = document.getElementById('fuel')!
const hullEl = document.getElementById('hull')!
const GLOW = new THREE.Color(0xff5a1a)
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
// Targeting: Tab cycles through every body, home included, so there is always a way back, then the asteroid fields.
type Target = { name: string; rel: THREE.Vector3; radius: number; field: Field | null; station: { view: BodyView; st: Station } | null }
// Stations: one per terrestrial body, drawn in its group, a target after the bodies.
const stationViews: { view: BodyView; sv: StationView }[] = []
for (const v of views) { const sv = buildStation(v.terrain); if (sv) { v.group.add(sv.group); stationViews.push({ view: v, sv }) } }
// The outpost round each pad.
const baseViews: BaseView[] = []
for (const v of views) { const bv = buildBase(v.terrain); if (bv) { v.group.add(bv.group); baseViews.push(bv) } }
// Tab cycles the bodies and stations; V cycles the nearest rock clusters (Chris, 2026-09-03:
// "the tabbing should be on planets ... select the clusters but not mixing them").
const bodyTargets: Target[] = [
  ...views.map((v) => ({ name: v.body.name, rel: v.rel, radius: v.body.radius, field: null, station: null })),
  ...stationViews.map((s) => ({ name: s.sv.station.name, rel: new THREE.Vector3(), radius: 0, field: null, station: { view: s.view, st: s.sv.station } })),
]
const fieldTargets: Target[] = FIELDS.map((f) => ({ name: f.name, rel: new THREE.Vector3(), radius: 0, field: f, station: null }))
const targets: Target[] = [...bodyTargets, ...fieldTargets]
/** The eight nearest clusters at the moment V was pressed, nearest first; V steps through them. */
let nearFields: Target[] = []
let fieldIndex = -1
let target: Target = bodyTargets[0]
const fp = new THREE.Vector3()
function nextField(): void {
  if (fieldIndex < 0 || !nearFields.includes(target)) {
    nearFields = fieldTargets.map((t) => ({ t, d: fieldPosition(t.field!, craft.time, fp).distanceTo(craft.hpos) })).sort((a, b) => a.d - b.d).slice(0, 8).map((x) => x.t)
    fieldIndex = 0
  } else fieldIndex = (fieldIndex + 1) % nearFields.length
  target = nearFields[fieldIndex]
}
const asteroids = new Asteroids()
world.add(asteroids.group)
asteroids.group.visible = mode === 'fly'
let targetIndex = 0
const toTarget = new THREE.Vector3()
addEventListener('keydown', (e) => {
  sound.arm()
  if (e.code === 'Escape') { paused = !paused; menu.hidden = !paused; return }
  if (mode !== 'fly' || paused) return
  if (phase === 'dark' && elapsed > 1) { phase = 'boot'; phaseAt = elapsed; sound.standby = false; sound.reactor(); return }
  if (phase === 'dark' || phase === 'boot') return
  idleSince = elapsed
  if (e.code === 'KeyR') respawn()
  if (e.code === 'KeyM') sound.muted = !sound.muted
  if (e.code === 'KeyC') chase.reset()
  if (e.code === 'KeyO') orbitAP.engaged = !orbitAP.engaged && craft.state === 'flying'
  if (e.code === 'Tab') { e.preventDefault(); if (bodyTargets.includes(target)) targetIndex = (targetIndex + (e.shiftKey ? bodyTargets.length - 1 : 1)) % bodyTargets.length; target = bodyTargets[targetIndex]; fieldIndex = -1 }
  if (e.code === 'KeyV') nextField()
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
  for (const tg of targets) {
    if (tg.field) fieldPosition(tg.field, t, tg.rel).sub(pHome).applyQuaternion(qHomeInv)
    if (tg.station) {
      const { view, st } = tg.station
      tg.rel.set(st.site.dir.x, st.site.dir.y, st.site.dir.z).multiplyScalar(view.body.radius + st.site.h).applyQuaternion(view.group.quaternion).add(view.rel)
    }
  }
  for (const s of stationViews) updateStation(s.sv, t, dayNow)
  for (const b of baseViews) updateBase(b, t, dayNow)
  // The sun, from the viewer.
  sunDir.copy(sunView.rel).sub(viewPos).normalize()
  sunLight.position.copy(sunView.rel).sub(viewPos)
  farSun.position.copy(sunLight.position)
}

renderer.setAnimationLoop((now) => {
  const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000); last = now; elapsed += dt
  const t = clock0 + elapsed
  let altitude: number, line: string

  if (mode === 'fly') {
    let c: Controls = input.read()
    // Dawn Shift.
    if (phase !== 'off') {
      const ph = elapsed - phaseAt
      craft.cruiseLocked = phase !== 'done'
      if (phase === 'dark' || phase === 'boot') c = { ...c, thrust: 0, boost: 0, vertical: 0, lateral: 0, fore: 0, pitch: 0, roll: 0, yaw: 0 }
      if (phase === 'dark') { chase.orbitYaw += 0.012 * dt; sound.standby = true; introEl.hidden = false; introEl.textContent = `PAD 01  .  LOCAL ${localTime(craft.time)}  .  SUNRISE ${localTime(SUNRISE_T)}` }
      if (phase === 'boot') {
        // The HUD boots element by element in the order the ship powers them, a click each.
        const at = [0.8, 2.2, 3.6, 5.0]
        while (bootStage < at.length && ph > at[bootStage]) { for (const e of bootParts[bootStage]) e.style.visibility = ''; sound.click(); bootStage++ }
        if (ph > 5.6) { phase = 'hover'; phaseAt = elapsed; idleSince = elapsed; sound.pad(1) }
      }
      if (phase === 'hover') {
        introEl.textContent = elapsed - idleSince > 20 && craft.state === 'landed' ? 'HOLD 20 M' : `PAD 01  .  LOCAL ${localTime(craft.time)}  .  SUNRISE ${localTime(SUNRISE_T)}`
        if (sinAppNow > 0) { phase = 'dawn'; phaseAt = elapsed; sound.pad(2); introEl.textContent = '' }
      }
      if (phase === 'dawn' && ph > 40) {
        phase = 'done'; phaseAt = elapsed
        sound.pad(3)
        const st = bodyTargets.find((t) => t.station && t.station.view.body === home)
        if (st) { target = st; targetIndex = bodyTargets.indexOf(st) }
        introEl.textContent = st ? `STATION  .  ${fmtDist(st.rel.distanceTo(craft.pos))}` : ''
        setTimeout(() => sound.pad(0), 45000)
      }
      if (phase === 'done' && ph > 10) introEl.hidden = true
    }
    if (burn > 0 && elapsed < burn) c = { ...c, thrust: 1 }
    // The orbit autopilot flies until you touch anything.
    if (orbitAP.engaged && (c.thrust || c.pitch || c.roll || c.yaw || c.vertical || c.lateral || c.fore || craft.state !== 'flying')) orbitAP.engaged = false
    if (orbitAP.engaged) c = orbitAP.controls(craft)
    const assist = orbitAP.engaged ? null : input.assist()
    const tgt = target
    toTarget.copy(tgt.rel).sub(craft.pos)
    // The aim assists near the ground would tip the ship at a target below the horizon (a station 38 km away is), so they wait until 40 m up in hover.
    if (assist && craft.state === 'flying' && (craft.cruise || craft.altitude() > 40)) {
      dir.copy(craft.pos).normalize()
      const target = assist === 'nadir' ? dir.clone().negate()
        : assist === 'target' ? toTarget.clone().normalize()
        : craft.speed() > 0.5 ? craft.vel.clone().normalize().negate() : dir.clone()
      const a = craft.aimControls(target)
      c = { ...c, pitch: a.pitch, roll: a.roll, yaw: a.yaw }
    }
    // A target within 30° of the nose caps cruise so you arrive at it; otherwise only the nearest body does.
    tmp.set(0, 0, -1).applyQuaternion(craft.quat)
    craft.arrive = toTarget.lengthSq() > 0 && tmp.dot(toTarget) / toTarget.length() > 0.86 ? toTarget.length() - tgt.radius : Infinity
    craft.arriveFloor = tgt.field === null
    craft.step(dt, c)
    if (input.fire() && !orbitAP.engaged) { const b = craft.fire(); if (b) { sound.shot(); flashUntil[b.side > 0 ? 1 : 0] = now + 60 } }
    morph.flashes[0].visible = now < flashUntil[0]; morph.flashes[1].visible = now < flashUntil[1]
    if (craft.hits.length) { asteroids.hits(craft.hits, craft.time); for (const h of craft.hits) { sound.hit(h.broke); if (h.fuel > 0) sound.chime() }; craft.hits.length = 0 }
    if (refView.body !== craft.ref) switchFrame()
    if (craft.state === 'crashed') { crashedAt ??= now; if (now - crashedAt > 2000) respawn() }
    ship.quaternion.copy(craft.quat)
    const flying = craft.state === 'flying'
    morphed += ((craft.cruise ? 1 : 0) - morphed) * Math.min(1, dt / 0.5)
    morph.set(morphed)
    // The hover engine fires down; in cruise the boosters fire back. Hand over halfway through the morph.
    flame.visible = craft.thrusting && flying && morphed < 0.5
    for (const f of morph.cruiseFlames) f.visible = craft.thrusting && flying && morphed >= 0.5
    // Flames flicker; the strobe flashes twice a second and a half, only in flight.
    { const k = 0.85 + 0.3 * Math.random(); flame.scale.set(1, k, 1); for (const f of morph.cruiseFlames) f.scale.set(1, 0.85 + 0.3 * Math.random(), 1) }
    { const ph = (now / 1000) % 1.5; strobe.visible = flying && (ph < 0.06 || (ph > 0.18 && ph < 0.24)) }
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
    ship.position.copy(craft.pos).sub(viewPos)
    if (Math.abs(altitude) < 0.05) altitude = 0
    if (!off.has('shadow')) shadow.update(craft)
    if (!off.has('dust')) dust.update(dt, craft.pos, altitude, flame.visible)
    // Touchdown: a puff and a scuff. Lift-off: a puff.
    if (craft.state !== lastState) {
      if (craft.state === 'landed' && craft.atmosphere() >= 0 && !craft.hitRock) { dust.burst(craft.pos, 70); marks.add(craft.pos.clone().addScaledVector(dir.copy(craft.pos).normalize(), -HULL_CLEARANCE), dir, now / 1000) }
      if (craft.state === 'flying' && lastState === 'landed') dust.burst(craft.pos, 40)
      lastState = craft.state
    }
    marks.update(now / 1000)
    // Weather at the craft.
    dir.copy(craft.pos).normalize()
    weatherFront = front(dir, craft.terrain, craft.time)
    rainNow = craft.atmosphere() > 0 ? rainOf(weatherFront) : 0
    cloudNow = craft.atmosphere() > 0 ? cloudOf(weatherFront) : 0
    windNow = craft.wind.length()
    if (!off.has('rain')) rain.update(dt, craft.pos, craft.wind, rainNow, craft.atmosphere(), craft.terrain.radius + craft.terrain.air * CLOUD_BASE_FRAC)
    if (!off.has('clouds')) puffs.update(craft.pos, craft.terrain, craft.time)
    if (off.has('flame')) { flame.visible = false; for (const f of morph.cruiseFlames) f.visible = false }
    sound.update(now / 1000, craft, c, craft.atmosphere(), chase.zoom, rainNow, gearDown, morphed)

    // Altimeter and the four landing lights. They arm below 60 m so they mean something.
    const vUp = craft.vUp(), tilt = craft.tilt()
    dir.copy(craft.pos).normalize()
    const drift = Math.sqrt(Math.max(0, craft.vel.lengthSq() - vUp * vUp)), slope = slopeDeg(dir, craft.terrain)
    const armed = flying && altitude < 60
    const frac = Math.min(1, Math.max(0, altitude / 120))
    altFill.style.height = `${frac * 100}%`; altMarker.style.bottom = `${frac * 100}%`
    // The number is the shown altitude: honest to 500 m, then growing with the log toward the planet's real scale.
    const shownAlt = shownDistance(Math.max(0, altitude))
    altNum.textContent = altitude < 100 ? altitude.toFixed(1) : shownAlt < 100_000 ? shownAlt.toFixed(0) : `${(shownAlt / 1000).toFixed(0)}k`
    altimeter.className = !flying ? '' : altitude < 15 ? 'critical' : altitude < 40 ? 'low' : ''
    light(lights.v, `V↑ ${vUp.toFixed(1)}`, vUp > -LAND_MAX_VSPEED, armed)
    light(lights.d, `DRIFT ${drift.toFixed(1)}`, drift < LAND_MAX_HSPEED, armed)
    light(lights.t, `TILT ${tilt.toFixed(0)}°`, tilt < LAND_MAX_TILT, armed)
    light(lights.s, `SLOPE ${slope.toFixed(0)}°`, slope < LAND_MAX_SLOPE, armed)
    const here = craft.state === 'landed' ? craft.padHere() : null
    altState.textContent = craft.state === 'landed' ? (here?.station ? `DOCKED  PAD ${here.pad}` : here ? 'ON THE PAD' : 'DOWN') : craft.state === 'crashed' ? 'CRASHED' : `${gearDown > 0.5 ? 'GEAR ↓' : 'GEAR ↑'}${craft.assisting ? '   ASSIST' : ''}`
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
    // Hull: heat as a fraction of the limit, damage when there is any. The hull glows from HULL_GLOW of the limit, saturating at HULL_WARN.
    {
      const over = craft.hull / HULL_LIMIT
      hullEl.textContent = over > 0.05 || craft.damage > 0 ? `HULL ${(over * 100).toFixed(0)}%${craft.damage > 0 ? `   DAMAGE ${(craft.damage * 100).toFixed(0)}%` : ''}${craft.cruise && rho > 0 ? '   RE-ENTRY: flip and brake' : ''}` : ''
      hullEl.className = 'atmos ' + (over > 1 ? 'dry' : over > HULL_WARN ? 'low' : '')
      const glow = Math.min(1, Math.max(0, (over - HULL_GLOW) / (HULL_WARN - HULL_GLOW)))
      shipMaterial.emissive.copy(GLOW).multiplyScalar(glow * 0.9)
      for (const m of glowMats) m.emissive.copy(GLOW).multiplyScalar(glow * 0.7)
      // The plasma streak: behind the ship, longer and brighter with the glow, flickering.
      plasma.visible = glow > 0.02 && flying
      if (plasma.visible) {
        const len = (25 + 70 * glow) * (0.9 + 0.2 * Math.random())
        plasma.scale.set(2.2 + 2 * glow, 2.2 + 2 * glow, len)
        ;(plasma.material as THREE.MeshBasicMaterial).opacity = 0.25 * glow + 0.15 * glow * Math.random()
      }
      // Hot exhaust under the hover engine, near the ground.
      haze.visible = flame.visible && altitude < 40
      if (haze.visible) haze.scale.set(0.9 + 0.3 * Math.random(), 0.8 + 0.5 * Math.random(), 0.9 + 0.3 * Math.random())
    }
    // Nav markers once the ground stops being the obvious reference.
    const showNav = flying && (altitude > 80 || rho < 0.5) && (phase === 'off' || phase === 'done')
    markers.place('planet', dir.clone().negate(), camera, showNav)
    const moving = craft.speed() > 2
    const pro = craft.vel.clone().normalize()
    markers.place('pro', pro, camera, showNav && moving)
    markers.place('retro', pro.clone().negate(), camera, showNav && moving)
    const tDist = toTarget.length(), tDir = toTarget.clone().divideScalar(tDist)
    const closing = -craft.vel.dot(tDir)
    const tSurf = Math.max(0, tDist - tgt.radius)
    // Within 5 km of a station you are cleared to its nearest pad, which the marker names.
    let cleared = ''
    if (tgt.station && tSurf < 5000 && flying) {
      const st = tgt.station.st
      let bestN = 0, bestD = Infinity
      for (const p of st.pads) {
        const d = tmp.set(p.dir.x, p.dir.y, p.dir.z).multiplyScalar(tgt.station.view.body.radius + st.site.h).applyQuaternion(tgt.station.view.group.quaternion).add(tgt.station.view.rel).distanceTo(craft.pos)
        if (d < bestD) { bestD = d; bestN = p.n }
      }
      cleared = `  cleared pad ${bestN}`
    }
    const eta = closing > 1 && tSurf / closing < 86400 ? `  ETA ${fmtTime(tSurf / closing)}` : ''
    markers.place('target', tDir, camera, showNav || cleared !== '', `${tgt.name}  ${fmtDist(tgt.station ? tSurf : shownDistance(tSurf))}  ${closing >= 0 ? '↓' : '↑'}${fmtSpeed(Math.abs(closing))}${eta}${cleared}`)
    const lc = craft.lastContact
    const vOrb = craft.orbitalSpeed(), vEsc = craft.escapeSpeed(), spd = craft.speed(), vIn = craft.inertialSpeed()
    const apLine = orbitAP.engaged ? `   AUTOPILOT ${orbitAP.phase.toUpperCase()} ${craft.ref.name}  park ${((orbitAP.parkRadius(craft) - craft.terrain.radius) / 1000).toFixed(0)} km at ${orbitAP.parkSpeed(craft).toFixed(0)} m/s` : ''
    const rn = craft.rockNear
    const rockLine = rn.rock && rn.dist < 30000 ? `   ROCK ${fmtDist(rn.dist)}${rn.dist < 2000 ? (rn.rock.ice ? '  ICE' : '  STONE') : ''}${craft.cruise ? '  (F fires)' : '  (cannons stowed in hover)'}` : ''
    const spaceLine = rho < 1 ? `${craft.cruise ? `CRUISE  cap ${fmtSpeed(craft.cap())}` : 'HOVER'}${apLine}   SOI ${craft.ref.name}   orbit ${vOrb.toFixed(0)}   escape ${vEsc.toFixed(0)}   ${craft.cruise ? '' : vIn > vEsc ? '!! ESCAPING !!' : vIn > vOrb ? 'above orbital' : ''}   target ${tgt.name}${tgt.field ? ` (${fieldIndex + 1} of ${nearFields.length} nearest, V)` : ' (Tab)'}${rockLine}\n` : ''
    line = `alt ${(altitude < 500 ? altitude.toFixed(1) : shownDistance(altitude).toFixed(0)).padStart(6)} m   v↑ ${vUp.toFixed(1).padStart(5)} m/s   spd ${fmtSpeed(spd).padStart(9)}   tilt ${tilt.toFixed(0).padStart(2)}°   ${craft.state.toUpperCase()}   landings ${craft.landings}  crashes ${craft.crashes}\n` + spaceLine +
      (craft.state === 'crashed' ? `contact: ${craft.burned ? 'HULL BURNED THROUGH  ' : craft.hitRock ? 'ROCK  ' : ''}v↑ ${lc.vUp.toFixed(1)}  drift ${lc.vH.toFixed(1)}  tilt ${lc.tilt.toFixed(0)}°  slope ${lc.slope.toFixed(0)}°   R to respawn\n` : '') +
      `Esc  menu and controls   ${fps} fps   chunks ${refView.lod?.liveCount ?? 0}`
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
  if (mode === 'fly') asteroids.update(dt, craft.time, craft.hpos, pHome, qHomeInv, viewPos, craft.hpos, craft.bolts)
  const ft = mode === 'fly' ? craft.terrain : HOME

  // "How day is it" uses the sun's APPARENT elevation: level elevation plus the
  // horizon dip at this altitude. On a 40 km world the horizon drops 7° by 300 m,
  // so the sun that set on the pad is back above the horizon once you climb.
  const density = atmosphereDensity(altitude, ft.air)
  dir.copy(viewPos).normalize()
  // In the sun's own sphere there is no horizon to be under: it is always noon.
  const sinApp = ft.kind === 'sun' ? 1 : Sky.apparentSunElevation(dir, sunDir, altitude, ft.radius)
  const sinDip = Math.sin(Math.acos(Math.min(1, ft.radius / (ft.radius + Math.max(0, altitude)))))
  const day = sky.update(dir, sunDir, density, sinApp, sinDip)
  dayNow = day
  sinAppNow = sinApp
  const simTime = mode === 'fly' ? craft.time : t
  const hasMoon = mode === 'fly' && moonDirection(craft.terrain, craft.time, tmp)
  waterMat.update(simTime, sunDir, day, windNow, hasMoon ? tmp : null, TIDE_AMPLITUDE)
  if (mode === 'fly') refView.clouds?.update(craft.time, sunDir, day, altitude)
  else homeView.clouds?.update(t, sunDir, day, altitude)
  // Under cloud the light goes flat and grey; in rain the air thickens.
  const overcast = cloudNow * density
  hemi.position.copy(dir) // the fill's "sky" is the local up, not scene +Y
  hemi.intensity = 0.85 * (0.07 + 0.93 * day) * (1 - 0.3 * overcast)
  // The local sun sets: below the apparent horizon it is gone, with a twilight ramp.
  const sunUp = Math.min(1, Math.max(0, (sinApp + 0.04) / 0.12))
  sunLight.intensity = 2.4 * (1 - 0.65 * overcast) * sunUp
  // Cumulus are Lambert and would take the sun through the planet: dim them with the day.
  ;(puffs.mesh.material as THREE.MeshLambertMaterial).color.setScalar(0.05 + 0.95 * Math.max(day * day, sunUp * 0.5))
  sunLight.color.lerpColors(SUN_LOW, SUN_WHITE, Math.min(1, Math.max(0, (sinApp + 0.05) / 0.25)))
  fog.color.copy(sky.horizon).lerp(GREY, overcast * 0.7)
  fog.density = 0.00055 * density * (1 + 2.5 * rainNow + 0.8 * overcast)

  camera.quaternion.copy(viewQuat)
  renderer.render(scene, camera)

  frames++
  if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now }
  hud.textContent = phase === 'off' || phase === 'done' ? line : ''
})
void tmp

// For the harnesses.
;(window as unknown as { __noelite: unknown }).__noelite = {
  mode, planet, craft, input, free, views, asteroids, ship,
  /** True only once the LOD has updated since the last place() and its queue is empty. */
  ready: () => updates > placedAt + 1 && planet.pendingCount === 0,
  /** Free mode: put the camera at p looking at a. */
  place: (px: number, py: number, pz: number, ax: number, ay: number, az: number) => { free.pos.set(px, py, pz); free.lookAt(new THREE.Vector3(ax, ay, az)); placedAt = updates },
  altitude: () => mode === 'fly' ? craft.altitude() : free.pos.length() - HOME.radius - height(free.pos.clone().normalize(), HOME),
  respawn,
}
