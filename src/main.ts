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
//   ?outpost=3         start landed on home's third outpost (-3: hanging 300 m over it)
//   ?assist=0          landing assist off (so a drop is a drop)
//   J                  jet mode, in air: wings out, the engine along the nose, bank to turn, / brakes, J again for hover (hover lands; the jet flies)
//   G                  the scanner: pings the nearest seam on this body within range onto the compass (and, on home, the contact)
//   U                  landed on a seam: dig a pod; landed at a town: sell what you carry
//   P / ?demo=1        the demo: the ship plays the loop itself and says what it is pressing; any key takes over
//   ?seam=home:3       start landed on the fourth seam of a body (0-based)
//   plain URL          the start: a starfield and Continue / New game / Demo
//   ?sandbox=1         nothing is loaded or saved (the demo from the start menu runs in it)
//   ?reset=1           forget the save (company, ship, wrecks) and start again; any placement
//                      parameter (?over ?outpost ?station ?field ?t) also starts on that spot, books kept
import * as THREE from 'three'
import { PlanetLOD } from './world/lod.ts'
import { FlyCam } from './engine/FlyCam.ts'
import { Craft, IDLE, type Controls } from './engine/Craft.ts'
import { KeyInput } from './engine/Input.ts'
import { ChaseCam } from './engine/ChaseCam.ts'
import { buildCraftMesh } from './engine/craftMesh.ts'
import { GroundShadow } from './engine/GroundShadow.ts'
import { Dust } from './engine/Dust.ts'
import { Marks } from './engine/Marks.ts'
import { Sound } from './engine/Sound.ts'
import { Sky } from './engine/Sky.ts'
import { NavMarkers } from './engine/NavMarkers.ts'
import { Compass, type CompassItem } from './engine/Compass.ts'
import { Pilot } from './engine/Demo.ts'
import { waterOf, height, HOME, terrainOf, padOf, stationOf, outpostsOf, type Terrain, type Station, type Outpost } from './world/height.ts'
import { buildPad } from './engine/Pad.ts'
import { buildStation, updateStation, type StationView } from './engine/Station.ts'
import { buildBase, updateBase, type BaseView } from './engine/Base.ts'
import { Wreck, buildWreckMeshes, syncWreckMeshes } from './engine/Wreck.ts'
import { Boob, boobName, BOOB_BODY, BOOB_SCAN_RANGE } from './world/boob.ts'
import { buildBoob, syncBoob } from './engine/Boob.ts'
import { Digger, GOOD_COLOUR, MODULE_GROUND } from './engine/Digger.ts'
import { Bank } from './world/economy.ts'
import { snapshot, restore, isSave } from './world/save.ts'
import { seamsOf, type Seam } from './world/seams.ts'
import { landingFor, allTowns, townsOn, current, shortfall, priceAt, sell, tick as tickTown, type Town } from './world/town.ts'
import { slopeDeg } from './world/terrain.ts'
import { atmosphereDensity, buildAtmosphereShell } from './world/atmosphere.ts'
import { SYSTEM, SETTLED, body, bodyPosition, bodySpin, type Body } from './world/system.ts'
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
import { LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE , FUEL_TANK, HULL_CLEARANCE, HULL_LIMIT, HULL_WARN, HULL_GLOW, CLOUD_BASE_FRAC, WRECK_HOLD, FUEL_PRICE, REPAIR_PRICE, LOAN_STEP, INSURANCE, DIG_SECONDS, POD_TONNES, JET_LIFT, shownDistance } from './world/config.ts'

const q = new URLSearchParams(location.search)
/** The save on disk, read once. ?reset=1 forgets it. A placement parameter starts you where it says, books kept. */
const SAVE_KEY = 'noelite.save'
let sandbox = q.get('sandbox') === '1'
const loadSave = () => { try { if (q.get('reset') === '1') localStorage.removeItem(SAVE_KEY); if (sandbox) return null; const raw = localStorage.getItem(SAVE_KEY); const j: unknown = raw ? JSON.parse(raw) : null; return isSave(j) ? j : null } catch { return null } }
const saved = loadSave()
const placed = ['over', 'outpost', 'station', 'field', 't', 'seam'].some((k) => q.get(k) !== null)
const mode: 'fly' | 'free' = q.get('mode') === 'free' ? 'free' : 'fly'
// Dawn Shift: the opening. On by default on a plain start (no URL parameters), ?intro=1 forces
// it, ?intro=0 skips it. Cold open on the pad in the dark, 103 s before sunrise (tools/sun-times).
const intro = q.get('intro') === '1' || (q.get('intro') !== '0' && location.search === '' && mode === 'fly' && saved === null)

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
// The sun's glare: a soft additive sprite on the sun's bearing, strongest in vacuum where
// the sky draws no haze (Chris, 2026-09-04: "the sun glare" on the title). Camera-relative,
// like the sky; hidden when the sun is under the apparent horizon.
const glare = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(255,250,235,1)'); grad.addColorStop(0.08, 'rgba(255,240,210,0.85)'); grad.addColorStop(0.3, 'rgba(255,220,170,0.28)'); grad.addColorStop(0.7, 'rgba(255,200,140,0.06)'); grad.addColorStop(1, 'rgba(255,200,140,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(cv)
  const m = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true })
  m.name = 'glare'
  const sp = new THREE.Sprite(m); sp.renderOrder = 3; sp.visible = false
  scene.add(sp)
  return sp
})()
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
// Cargo modules (Chris, 2026-09-05: "the timber is being put under the thrust, which is wrong,
// need the ship to have modules that load"): crates clamped to the top of the hull, one each
// side of the spine and one on the ridge behind it, the colour of what is in them. The pods
// were drums under the tail, which is where the engine is. A module fills on the ground beside
// the auger and hops up to its slot at the end of the dig.
const topY = (x: number, z: number) => (3.795 * (z + 4.6) - 8.28 * Math.abs(x)) / 18.15   // the top facets' plane through the nose, spine and tail tips
const MODULE_SLOTS = [new THREE.Vector3(1.25, topY(1.25, 0.9) + 0.22, 0.9), new THREE.Vector3(-1.25, topY(1.25, 0.9) + 0.22, 0.9), new THREE.Vector3(0, 1.15 * (1 - 1.0 / 1.7) + 0.22, 1.9)]
const modules: THREE.Mesh[] = MODULE_SLOTS.map((slot) => {
  const mat = new THREE.MeshLambertMaterial({ color: 0xc9a24a })
  mat.name = 'module'
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 1.3), mat)
  const strap = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.14, 1.36), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }))
  ;(strap.material as THREE.Material).name = 'module-strap'
  m.add(strap)
  m.position.copy(slot); m.visible = false; ship.add(m); return m
})
ship.visible = mode === 'fly'
const padSite = padOf(HOME)!
const pad = new THREE.Vector3(padSite.dir.x, padSite.dir.y, padSite.dir.z)
{ const padMesh = buildPad(HOME); if (padMesh) homeView.group.add(padMesh) }
const shadow = new GroundShadow(HOME)
const dust = new Dust(HOME)
const marks = new Marks()
// Wrecks (DESIGN §10): the hull's facets tumble off and stay where they fell, in their
// body's frame, so you can fly back to one. A fireball at the site, scene root like the ship.
const wrecks: { wreck: Wreck; meshes: THREE.Mesh[]; view: BodyView }[] = []
const placeWreck = (wreck: Wreck, view: BodyView) => { const meshes = buildWreckMeshes(); for (const m of meshes) view.group.add(m); syncWreckMeshes(wreck, meshes); wrecks.push({ wreck, meshes, view }) }
// The boob (Ben, 2026-09-05, DESIGN §10i): one, on home, drifting round the world 500 m up. It lives in home's group.
const boob = new Boob()
const boobView = buildBoob()
views.find((v) => v.body.id === BOOB_BODY)!.group.add(boobView.group)
const boobPos = new THREE.Vector3(), boobVel = new THREE.Vector3()
// The dig you can see (DESIGN §10j): the auger under the keel, the heaps in the body's frame.
const digger = new Digger(homeView.group)
ship.add(digger.group)
let digDust = 0
const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8830, transparent: true, opacity: 0.9, depthWrite: false }))
;(fireball.material as THREE.Material).name = 'fireball'
fireball.visible = false
world.add(fireball)
let fireAt = 0
const firePos = new THREE.Vector3(), wtmp = new THREE.Vector3()
/** Metres the hull has sunk since going into the water. */
let sink = 0
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
  for (const h of digger.heapsAll()) refView.group.add(h)
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
// ?outpost=<n> starts landed on home's nth outpost; a negative n hangs 300 m over it.
{
  const op = q.get('outpost')
  if (op !== null) {
    const n = Number(op), o = outpostsOf(HOME)[Math.abs(n) - 1]
    if (o) { const d = new THREE.Vector3(o.site.dir.x, o.site.dir.y, o.site.dir.z); if (n > 0) craft.spawnOn(d, new THREE.Vector3(1, 0, 0), 'surface', home); else craft.placeAbove(home, d, 300) }
    else console.warn(`?outpost=${op}: home has ${outpostsOf(HOME).length} outposts`)
  }
}
// ?seam=<body id>:<n> starts landed on that body's nth seam (0-based), for the dig.
{
  const sp = q.get('seam')
  if (sp !== null) {
    const [id, n] = sp.split(':'); const b = body(id); const list = seamsOf(terrainOf(b)); const sm = list[Number(n) || 0]
    if (sm) craft.spawnOn(new THREE.Vector3(sm.dir.x, sm.dir.y, sm.dir.z), new THREE.Vector3(1, 0, 0), 'surface', b)
  }
}
// ?assist=0 turns the landing assist off.
if (q.get('assist') === '0') craft.assist = false
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
const compass = new Compass(document.body)
const compassItems: CompassItem[] = []
// The first loop (DESIGN §10e-2, §10g): dig at a seam, carry, sell at a town. Towns run all the time.
const cargoEl = document.getElementById('cargo')!, townEl = document.getElementById('town')!, townPre = townEl.querySelector('pre')!
/** Seconds into the current dig, or -1. */
let digging = -1
/** The town the ship is landed at, if any: the pad's town. */
const townHere = (): Town | null => {
  const h = craft.padHere(); if (!h) return null
  const id = h.station ? `${craft.ref.id}:station` : h.outpost ? `${craft.ref.id}:${h.outpost.n}` : null
  return id ? townsOn(craft.terrain).find((t) => t.id === id) ?? null : null
}
const use = () => {
  if (craft.state !== 'landed') return
  const seam = craft.seamHere()
  if (seam) {
    if (digging >= 0) return
    if (!craft.canLoad()) { toast('NO ROOM: THREE PODS'); return }
    if (seam.richness <= 0) { toast('SEAM WORKED OUT'); return }
    digging = 0; sound.click(); return
  }
  const town = townHere()
  if (town) {
    if (!craft.cargo.length) { toast('NOTHING TO SELL'); return }
    let paid = 0
    for (const c of craft.cargo) paid += sell(town, c.good, c.tonnes)
    bank.earn(craft.time, 'SALE', paid)
    craft.cargo.length = 0
    toast(`SOLD FOR ${credits(paid)}`); sound.chime(); saveGame(); renderCompany()
  }
}
/** A line on the intro element for a few seconds: the game talking back. */
let toastUntil = 0
const toastEl = document.getElementById('toast')!
const toast = (msg: string) => { toastEl.hidden = false; toastEl.textContent = msg; toastUntil = elapsed + 4 }
// The demo (DESIGN §10d): the pilot flies the loop and the caption says what it is doing
// and which keys it is pressing, so a new player sees what is supposed to happen.
const pilot = new Pilot()
let demo = false
let demoAuto = q.get('demo') === '1'
let demoStep: 'seam' | 'dig' | 'town' | 'sell' | 'refuel' = 'seam'
let demoWait = 0
let demoWhere = ''
const demoEl = document.getElementById('demo')!
const nearest = <T,>(list: T[], dirOf: (x: T) => { x: number; y: number; z: number }): T | null => {
  const up = craft.pos.clone().normalize(); let best: T | null = null, bestC = -2
  for (const it of list) { const d = dirOf(it); const c = up.x * d.x + up.y * d.y + up.z * d.z; if (c > bestC) { bestC = c; best = it } }
  return best
}
const demoGo = (step: 'seam' | 'town') => {
  const t = craft.terrain
  if (step === 'seam') {
    const sm = nearest(seamsOf(t).filter((x) => x.richness > 0), (x) => x.dir)
    if (!sm) { demo = false; return }
    pilot.goTo(new THREE.Vector3(sm.dir.x, sm.dir.y, sm.dir.z).multiplyScalar(t.radius + sm.h)); demoWhere = `the ${sm.good} seam`
  } else {
    const tw = nearest(townsOn(t), (x) => x.dir)
    if (!tw) { demo = false; return }
    const at = landingFor(tw, craft.pos.clone().normalize())   // a station's nearest pad, not its dome
    pilot.goTo(new THREE.Vector3(at.dir.x, at.dir.y, at.dir.z).multiplyScalar(t.radius + at.h)); demoWhere = tw.name
  }
  demoStep = step
}
const startDemo = () => { if (craft.state === 'crashed') return; demo = true; demoWait = 0; demoGo(craft.cargo.length >= 3 ? 'town' : 'seam') }
const stopDemo = () => { demo = false; input.override = null; demoEl.hidden = true }
/** What the demo is pressing and why, from the controls themselves. A key stays on the caption for a third of a second after it was last pressed, because the pilot's throttle is a flicker. */
const keyHeld = new Map<string, number>()
const demoCaption = (c: Controls): string => {
  const press = (on: boolean, k: string) => { if (on) keyHeld.set(k, elapsed) }
  press(c.thrust > 0, 'SPACE  thrust'); press(c.boost > 0, 'SHIFT  boost'); press(c.pitch > 0.05, 'W  nose down'); press(c.pitch < -0.05, 'S  nose up')
  press(c.roll > 0.05, 'D  roll right'); press(c.roll < -0.05, 'A  roll left'); press(c.yaw > 0.05, 'E  yaw right'); press(c.yaw < -0.05, 'Q  yaw left'); press(c.vertical < 0, '/  dive')
  const keys = [...keyHeld].filter(([, t]) => elapsed - t < 0.35).map(([k]) => k)
  const doing = demoStep === 'dig' ? `digging: U on a seam fills a pod in ${DIG_SECONDS} s` : demoStep === 'sell' ? 'selling: U at a town sells everything aboard' : demoStep === 'refuel' ? 'refuelling on the pad, then off again' :
    pilot.leg === 'lift' ? `lifting off for ${demoWhere}` : pilot.leg === 'climb' ? `${fmtDist(pilot.distance(craft))} to ${demoWhere}: too far for hover, climbing out of the air for cruise` : pilot.leg === 'cruise' ? `wings out: cruise to ${demoWhere}, ${fmtDist(pilot.distance(craft))}, nose on the horizon toward it, the cap does the speed` : pilot.leg === 'descend' ? `over ${demoWhere}: nose down, no thrust, brake to hand back to hover` : pilot.leg === 'fly' ? `flying to ${demoWhere}, ${fmtDist(pilot.distance(craft))}: lean toward it, ease off to slow` : pilot.leg === 'settle' ? 'over the spot: level, let it sink' : 'hands off: the assist lands it'
  return `DEMO   ${doing}\n${keys.length ? keys.join('    ') : 'no keys: hands off'}\nany key takes over`
}
// The purpose line (Chris, 2026-09-04: "looks like there is no purpose"): the nearest town's job and what it is short of, always on the panel; the board's first form.
const goalEl = document.getElementById('goal')!
const goalLine = (): string => {
  const tw = nearest(townsOn(craft.terrain), (x) => x.dir); if (!tw) return ''
  const p = current(tw); if (!p) return `${tw.name.toUpperCase()}: nothing left to build`
  const shorts = (Object.entries(shortfall(tw)) as [string, number][]).filter(([, v]) => v >= 0.05)
  return shorts.length ? `${tw.name.toUpperCase()} WANTS ${shorts.map(([g, v]) => `${Math.ceil(v)} t ${g.toUpperCase()}`).join(', ')} for ${p.name}` : `${tw.name.toUpperCase()} is building ${p.name}, ${Math.round(100 * p.progress / p.labour)}%`
}
const renderTown = () => {
  const town = townHere()
  townEl.hidden = !town
  if (!town) return
  const p = current(town), sf = shortfall(town)
  const stock = (Object.entries(town.stock) as [string, number][]).filter(([, v]) => v > 0.05).map(([g, v]) => `${g} ${v.toFixed(1)} t`).join('   ') || 'nothing'
  const shorts = (Object.entries(sf) as [string, number][]).filter(([, v]) => v >= 0.05)
  const job = p ? `${p.name}: ${Math.round(100 * p.progress / p.labour)}% built${shorts.length ? ', short of ' + shorts.map(([g, v]) => `${v.toFixed(1)} t ${g}`).join(', ') : ', all materials in'}` : 'nothing left on the works list'
  const buys = craft.cargo.length ? '\n\nBUYS   ' + craft.cargo.map((c) => `${c.good} at ${priceAt(town, c.good as never).toFixed(0)} cr/t`).join('   ') + '   ·   U sells' : ''
  townPre.textContent = `${town.name.toUpperCase()}   ${town.population} people\nSTOCK  ${stock}\nBUILDING  ${job}\nBUILT  ${town.built.join(', ') || 'nothing yet'}${buys}`
}
// The scanner (DESIGN §10g): G pings; for a while the nearest seam in range sits on the
// compass as a blip with its good and distance, and the beeper quickens as you close.
const SCAN_RANGE = 25_000
const SCAN_HOLD = 12
let scanUntil = -1, scanHit: { seam: Seam; rel: THREE.Vector3 } | null = null, scanBeepAt = 0
/** The boob is on the scan too, while it is in range of the ping. */
let scanBoob = false
const scan = () => {
  const t = craft.terrain, up = craft.pos.clone().normalize()
  let best: Seam | null = null, bestC = -2
  for (const sm of seamsOf(t)) { const c = up.x * sm.dir.x + up.y * sm.dir.y + up.z * sm.dir.z; if (c > bestC) { bestC = c; best = sm } }
  scanUntil = elapsed + SCAN_HOLD
  scanHit = best && Math.acos(Math.min(1, bestC)) * t.radius < SCAN_RANGE ? { seam: best, rel: new THREE.Vector3(best.dir.x, best.dir.y, best.dir.z).multiplyScalar(t.radius + best.h) } : null
  scanBoob = craft.ref.id === BOOB_BODY && boob.distance(craft.pos) < BOOB_SCAN_RANGE
  sound.click()
}
const orbitAP = new OrbitAutopilot()

const hud = document.getElementById('hud')!
const menu = document.getElementById('menu')!
const introEl = document.getElementById('intro')!
/** The opening's letterbox. 1 = bars fully in (a fifth of the frame between them), 0 = open. */
const bars = Array.from(document.querySelectorAll<HTMLElement>('.bar'))
// The arrival card (Chris, 2026-09-04: "some fancy font saying which planet we're on"):
// shown for every body whose sphere of influence you arrive in, and in the opening once
// the HUD has booted, with the notes.
const titleEl = document.getElementById('title')!, titleName = titleEl.querySelector('h1')!, titleLine = titleEl.querySelector('p')!
let titleBody: Body | null = null
let titleUntil = 0
const describe = (b: Body): string => {
  const kind = b.kind === 'terrestrial' ? 'TERRESTRIAL' : b.kind === 'desert' ? 'DESERT WORLD' : b.kind === 'ice' ? 'ICE WORLD' : b.kind === 'moon' ? 'MOON' : b.kind === 'tiny' ? 'DWARF' : b.kind === 'giant' ? 'GAS GIANT' : b.kind === 'hot' ? 'HOT WORLD' : 'STAR'
  const air = b.atmosphereHeight > 0 ? 'ATMOSPHERE' : 'AIRLESS'
  const day = b.spinPeriod > 0 ? `DAY ${Math.round(b.spinPeriod / 60)} MIN` : 'TIDALLY LOCKED'
  return [kind, `${b.surfaceGravity.toFixed(1)} m/s²`, air, b.seaLevel !== null ? (b.kind === 'ice' ? 'FROZEN SEA' : 'OCEANS') : null, day].filter(Boolean).join('   ·   ')
}
const showTitle = (b: Body) => { titleName.textContent = b.name; titleLine.textContent = describe(b); titleEl.classList.add('on'); titleUntil = elapsed + 6 }
let barFrac = intro ? 1 : 0
const BAR_VH = 11
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
// A light holds its colour until the value is clear of the limit by a tenth, so a reading sitting on the line does not flicker (Chris, 2026-09-04).
const lightState = new WeakMap<HTMLElement, boolean>()
const light = (el: HTMLElement, text: string, value: number, limit: number, armed: boolean) => {
  el.textContent = text
  const was = lightState.get(el) ?? true
  const ok = value < limit * 0.9 ? true : value > limit * 1.1 ? false : was
  lightState.set(el, ok)
  el.className = armed ? (ok ? 'ok' : 'bad') : ''
}
const atmosEl = document.getElementById('atmos')!
const fuelEl = document.getElementById('fuel')!
const hullEl = document.getElementById('hull')!
// The company (DESIGN §10e): money, a loan, a ledger; saved in the browser, ?reset=1 forgets it.
const bankEl = document.getElementById('bank')!, companyEl = document.querySelector<HTMLElement>('#company pre')!
const saveEl = document.querySelector<HTMLElement>('#company .save')!
let bank = saved ? Bank.fromJSON(saved.bank) : new Bank()
let savedAt = 0
let lastSave = saved ? `${new Date(saved.savedAt).toLocaleTimeString('en-GB')} on ${saved.where}` : 'never'
// Loading: the books and the wrecks always; the ship back on the pad it saved on unless a URL put it somewhere.
if (saved && mode === 'fly') {
  const r = restore(placed ? null : craft, saved)
  bank = r.bank
  for (const w of r.wrecks) { const v = views.find((x) => x.body.id === w.body); if (v) placeWreck(w.wreck, v) }
  if (refView.body !== craft.ref) switchFrame()
  setTimeout(() => toast(`LOADED   ·   ${whereAmI().toUpperCase()}`), 0)
}
/** Where the ship is: a pad's name for the save and the menu. */
const whereAmI = (): string => { const h = craft.padHere(); const sm = craft.seamHere(); return h?.station ? `${h.station.name} pad ${h.pad}` : h?.outpost ? h.outpost.name : h ? 'the home pad' : sm ? `the ${sm.good} seam on ${craft.ref.name}` : `${craft.ref.name}, open ground` }
/** Write the save if the ship is on the ground. True if it did. */
const saveGame = (): boolean => {
  if (sandbox) return false
  const snap = snapshot(craft, bank, wrecks.map((w) => ({ body: w.view.body.id, wreck: w.wreck })), whereAmI())
  if (!snap) return false
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(snap)) } catch { /* private window, or storage off: the game lives for the session */ }
  lastSave = `${new Date(snap.savedAt).toLocaleTimeString('en-GB')} on ${snap.where}`
  return true
}
/** Running pad charges, booked as one FUEL or REPAIR line when the fill stops. */
const pending = { fuel: 0, repair: 0 }
/** The books change while flying too; a landed ship writes the whole save, a flying one only remembers to. */
const saveBank = () => { if (!saveGame()) savedAt = -10 }
const credits = (v: number) => `${Math.round(v).toLocaleString('en-GB')} cr`
const renderCompany = () => {
  const lines = bank.ledger.slice(-10).reverse().map((e) => `${localTime(e.t)}   ${e.what.padEnd(10)} ${(e.amount >= 0 ? '+' : '') + Math.round(e.amount).toLocaleString('en-GB').padStart(8)}`)
  companyEl.textContent = `BALANCE ${credits(bank.balance).padStart(12)}      LOAN ${credits(bank.loan).padStart(12)}\n\n${lines.join('\n') || 'no transactions yet'}`
  saveEl.textContent = `last save ${lastSave}   ·   ${craft.state === 'landed' ? 'S saves now' : 'land to save'}`
}
renderCompany()
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
  // Not while the menu is up: scrolling the menu used to zoom the camera, and the camera is the ear (Chris, 2026-09-04: "sound disappeared after going into the menu").
  addEventListener('wheel', (e) => { if (mode === 'fly' && !paused) chase.zoom = Math.min(3, Math.max(0.4, chase.zoom * Math.pow(1.1, e.deltaY / 100))) }, { passive: true })
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
// The outposts dotted round each body (Chris, 2026-09-04): a pad and a half-density base each,
// drawn only within OUTPOST_DRAW of the craft so six bases do not cost six bases of draw calls.
type OutpostView = { view: BodyView; o: Outpost; group: THREE.Group; bv: BaseView; rel: THREE.Vector3 }
const outpostViews: OutpostView[] = []
for (const v of views) for (const o of outpostsOf(v.terrain)) {
  const group = new THREE.Group()
  const padMesh = buildPad(v.terrain, o.site); if (padMesh) group.add(padMesh)
  const bv = buildBase(v.terrain, o.site, o.n, 0.5); if (!bv) continue
  group.add(bv.group); group.visible = false
  v.group.add(group)
  outpostViews.push({ view: v, o, group, bv, rel: new THREE.Vector3() })
}
const OUTPOST_DRAW = 40_000
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
// The start (Chris, 2026-09-04: "a starfield type menu at the start of the game, which allows you
// to go to the demo or play or load a save"). Only on a plain URL. The game sits frozen behind it.
const startEl = document.getElementById('start')!
let starting = location.search === '' && mode === 'fly'
const choices = Array.from(startEl.querySelectorAll<HTMLLIElement>('li'))
let choice = saved ? 0 : 1
const drawChoices = () => {
  for (const li of choices) {
    const k = li.dataset.choice
    if (k === 'continue') { li.classList.toggle('off', !saved); li.querySelector('small')!.textContent = saved ? `last save ${lastSave}` : 'no save yet' }
    li.classList.toggle('on', choices.indexOf(li) === choice)
  }
}
const choose = (k: string | undefined) => {
  sound.arm()   // the choice is the gesture that unlocks the audio; a fresh page would start silent (Chris, 2026-09-04: "no sounds in the demo")
  if (k === 'continue' && saved) { leaveStart('continue'); toast(`LOADED   ·   ${whereAmI().toUpperCase()}`) }
  else if (k === 'new') { if (saved) location.href = '?reset=1&intro=1'; else leaveStart('new') }
  else if (k === 'demo') { sandbox = true; leaveStart('new'); phase = 'off'; startDemo(); toast('DEMO   ·   SANDBOX, NOTHING IS SAVED   ·   ANY KEY TAKES OVER') }
}
/** The title view: high over the pad just before its dawn, the sun on the limb, the stars out, the ship out of shot, the camera drifting round. */
const titleClock = clock0
const leaveStart = (how: 'continue' | 'new') => {
  starting = false; startEl.hidden = true
  clock0 = titleClock
  ship.visible = true; chase.reset(); chase.snap()
  if (how === 'continue' && saved) restore(craft, saved)
  else craft.spawnOn(pad, new THREE.Vector3(1, 0, 0), 'surface', home)
  if (refView.body !== craft.ref) switchFrame()
}
if (starting) {
  startEl.hidden = false
  drawChoices()
  for (const li of choices) li.addEventListener('click', () => choose(li.dataset.choice))
  clock0 = 2170   // a few minutes before the pad's dawn: from 30 km up the sun sits on the limb
  // Nose on the sun's bearing, so the glare sits on the limb ahead with the planet below.
  const sunHere = bodyPosition(body('sun'), clock0, new THREE.Vector3()).sub(bodyPosition(home, clock0, new THREE.Vector3())).applyQuaternion(bodySpin(home, clock0, new THREE.Quaternion()).invert()).normalize()
  const heading = sunHere.clone().addScaledVector(pad, -sunHere.dot(pad)).normalize()
  craft.placeAbove(home, pad, 30_000, heading)
  ship.visible = false
  chase.orbitPitch = 0.35; chase.zoom = 3; chase.snap()
  if (refView.body !== craft.ref) switchFrame()
}
addEventListener('pointerdown', () => sound.arm())
addEventListener('keydown', (e) => {
  sound.arm()
  if (starting) {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') choice = (choice + choices.length - 1) % choices.length
    if (e.code === 'ArrowDown' || e.code === 'KeyS') choice = (choice + 1) % choices.length
    if (!saved && choice === 0) choice = e.code === 'ArrowUp' || e.code === 'KeyW' ? choices.length - 1 : 1
    drawChoices()
    if (e.code === 'Enter' || e.code === 'Space') choose(choices[choice].dataset.choice)
    e.preventDefault(); return
  }
  if (demo && e.code !== 'Escape') { stopDemo(); toast('YOUR SHIP'); if (e.code === 'KeyP') return }
  else if (e.code === 'KeyP' && mode === 'fly' && !paused) { startDemo(); return }
  if (e.code === 'Escape') { paused = !paused; menu.hidden = !paused; if (paused) { renderCompany(); renderTown() } return }
  if (paused) {
    if (e.code === 'BracketRight') { bank.borrow(craft.time, LOAN_STEP); renderCompany(); saveBank() }
    if (e.code === 'BracketLeft') { bank.repay(craft.time, LOAN_STEP); renderCompany(); saveBank() }
    if (e.code === 'KeyS') { saveGame(); renderCompany() }
    return
  }
  if (mode !== 'fly' || paused) return
  if (phase === 'dark' && elapsed > 1) { phase = 'boot'; phaseAt = elapsed; sound.standby = false; sound.reactor(); return }
  if (phase === 'dark' || phase === 'boot') return
  idleSince = elapsed
  if (e.code === 'KeyR') respawn()
  if (e.code === 'KeyM') sound.muted = !sound.muted
  if (e.code === 'KeyC') chase.reset()
  if (e.code === 'KeyG' && mode === 'fly') scan()
  if (e.code === 'KeyJ' && mode === 'fly') { const r = craft.toggleJet(); toast(r === 'jet' ? 'JET   ·   nose steers, bank to turn, / brakes, J back to hover' : r === 'hover' ? 'HOVER' : r === 'no-air' ? 'NO AIR FOR WINGS' : craft.cruise ? 'IN CRUISE: WINGS ARE OUT ALREADY' : 'NOT ON THE GROUND') }
  if (e.code === 'KeyU' && mode === 'fly') use()
  if (e.code === 'KeyO') orbitAP.engaged = !orbitAP.engaged && craft.state === 'flying'
  if (e.code === 'Tab') { e.preventDefault(); if (bodyTargets.includes(target)) targetIndex = (targetIndex + (e.shiftKey ? bodyTargets.length - 1 : 1)) % bodyTargets.length; target = bodyTargets[targetIndex]; fieldIndex = -1 }
  if (e.code === 'KeyV') nextField()
})
/** A crash never ends the game: a replacement hull on the nearest pad of the body you are on, the excess charged even into the red, the wreck left where it fell. */
function respawn() {
  const wrecked = craft.state === 'crashed'
  const up = craft.pos.clone().normalize()
  let best = pad, bestOn = home, bestC = -2
  if (SETTLED.has(craft.ref.kind)) {
    const t = craft.terrain
    const sites: { x: number; y: number; z: number }[] = []
    const p = padOf(t); if (p) sites.push(p.dir)
    const st = stationOf(t); if (st) for (const sp of st.pads) sites.push(sp.dir)
    for (const o of outpostsOf(t)) sites.push(o.site.dir)
    for (const d of sites) { const c = up.x * d.x + up.y * d.y + up.z * d.z; if (c > bestC) { bestC = c; best = new THREE.Vector3(d.x, d.y, d.z); bestOn = craft.ref } }
  }
  craft.spawnOn(best, new THREE.Vector3(1, 0, 0), 'surface', bestOn)
  if (refView.body !== craft.ref) switchFrame()
  if (wrecked) { bank.charge(craft.time, 'INSURANCE', INSURANCE); saveGame() }
  crashedAt = null; ship.visible = true; sink = 0; chase.orbitYaw = 0
}

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
  // Outposts: where each one is this frame; drawn and lit only within OUTPOST_DRAW of the craft.
  for (const ov of outpostViews) {
    ov.rel.set(ov.o.site.dir.x, ov.o.site.dir.y, ov.o.site.dir.z).multiplyScalar(ov.view.body.radius + ov.o.site.h).applyQuaternion(ov.view.group.quaternion).add(ov.view.rel)
    const d = ov.rel.distanceTo(craft.pos)
    ov.group.visible = d < OUTPOST_DRAW
    if (ov.group.visible) updateBase(ov.bv, t, dayNow)
  }
  // The sun, from the viewer.
  sunDir.copy(sunView.rel).sub(viewPos).normalize()
  sunLight.position.copy(sunView.rel).sub(viewPos)
  farSun.position.copy(sunLight.position)
  // The glare rides the sun's bearing at a fixed distance, sized for the air: full in vacuum, a breath in thick air.
  {
    const rhoHere = craft.atmosphere()
    const strength = sinAppNow > -0.02 ? 1 - 0.75 * Math.min(1, rhoHere * 3) : 0
    glare.visible = strength > 0.02
    if (glare.visible) { glare.position.copy(sunDir).multiplyScalar(400); glare.scale.setScalar(260 * (0.7 + 0.6 * strength)); (glare.material as THREE.SpriteMaterial).opacity = 0.85 * strength }
  }
}

renderer.setAnimationLoop((now) => {
  const rawDt = Math.min(0.1, (now - last) / 1000)
  const dt = paused || starting ? 0 : rawDt; last = now; elapsed += dt
  if (starting) { chase.orbitYaw += 0.02 * rawDt; introEl.hidden = true }
  altimeter.hidden = mode !== 'fly' || starting
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
    // The arrival card: a new reference body, or the opening once the HUD is up.
    {
      const want = mode === 'fly' && (phase === 'off' || phase === 'done' || phase === 'hover' || phase === 'dawn') && elapsed > 0.5 ? craft.ref : null
      if (want && want !== titleBody) { titleBody = want; showTitle(want); sound.fanfare() }
      if (titleEl.classList.contains('on') && elapsed > titleUntil) titleEl.classList.remove('on')
    }
    // The letterbox opens on your climb, not on a clock: held on the pad, opening from 2 to 60 m up.
    {
      const want = starting ? 1 : phase === 'off' || phase === 'done' ? 0 : craft.state === 'landed' ? 1 : 1 - Math.min(1, Math.max(0, (craft.altitude() - 2) / 58))
      barFrac += (want - barFrac) * Math.min(1, 4 * dt)
      if (Math.abs(want - barFrac) < 0.002) barFrac = want
      const h = barFrac > 0 ? `${(barFrac * BAR_VH).toFixed(2)}vh` : '0'
      for (const b of bars) if (b.style.height !== h) b.style.height = h
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
    // The demo drives the ship through the same override the harnesses use.
    if (demoAuto && elapsed > 1 && (phase === 'off' || phase === 'done')) { demoAuto = false; startDemo() }
    if (demo) {
      if (craft.state === 'landed' && pilot.leg === 'down') {
        if (demoStep === 'seam') { if (craft.seamHere()) { demoStep = 'dig'; use() } else demoGo('seam') }
        else if (demoStep === 'dig') { if (digging < 0) { if (craft.canLoad() && (craft.seamHere()?.richness ?? 0) > 0) use(); else demoGo('town') } }
        else if (demoStep === 'town') { if (townHere()) { demoStep = 'sell'; use(); demoWait = elapsed + 3 } else demoGo('town') }
        else if (demoStep === 'sell') { if (elapsed > demoWait) demoStep = 'refuel' }
        else if (demoStep === 'refuel') { if (craft.fuel > 60 || !craft.padHere()) demoGo('seam') }
      }
      const dc = pilot.controls(craft)
      if (pilot.leg === 'cruise') { craft.arrive = pilot.arrive(craft); craft.arriveFloor = true }
      input.override = demoStep === 'dig' || demoStep === 'sell' || demoStep === 'refuel' ? IDLE : dc
      c = input.override
      demoEl.hidden = false; demoEl.textContent = demoCaption(c)
      if (craft.state === 'crashed') stopDemo()
    }
    craft.credit = bank.balance
    craft.step(dt, c)
    // Charge what the pad sold; the loan earns its keep; save now and then.
    if (craft.bought.fuel > 0) { const cost = craft.bought.fuel * FUEL_PRICE; bank.spend(craft.time, 'FUEL', cost, false); pending.fuel += cost; craft.bought.fuel = 0 }
    else if (pending.fuel > 0) { bank.note(craft.time, 'FUEL', -pending.fuel); pending.fuel = 0; saveBank() }
    if (craft.bought.repair > 0) { const cost = craft.bought.repair * REPAIR_PRICE; bank.spend(craft.time, 'REPAIR', cost, false); pending.repair += cost; craft.bought.repair = 0 }
    else if (pending.repair > 0) { bank.note(craft.time, 'REPAIR', -pending.repair); pending.repair = 0; saveBank() }
    bank.accrue(dt, craft.time)
    for (const tw of allTowns()) tickTown(tw, dt)
    // The dig: landed inside a seam, a pod fills over DIG_SECONDS; lifting off abandons it.
    if (digging >= 0) {
      const seam = craft.seamHere()
      if (!seam || craft.state !== 'landed') { digging = -1 }
      else {
        digging += dt
        if (digging >= DIG_SECONDS) {
          const took = Math.min(POD_TONNES, seam.richness); seam.richness -= took; seam.dug = true
          craft.load(seam.good, took); digging = -1
          toast(`${seam.good.toUpperCase()} ${took.toFixed(0)} t ABOARD   ·   ${seam.richness.toFixed(0)} t LEFT`); sound.chime(); saveGame()
        }
      }
    }
    if (toastUntil > 0 && elapsed > toastUntil) { toastEl.hidden = true; toastUntil = 0 }
    if (elapsed - savedAt > 5) { savedAt = elapsed; saveGame() }
    if (input.fire() && !orbitAP.engaged) { const b = craft.fire(); if (b) { sound.shot(); flashUntil[b.side > 0 ? 1 : 0] = now + 60 } }
    morph.flashes[0].visible = now < flashUntil[0]; morph.flashes[1].visible = now < flashUntil[1]
    if (craft.hits.length) { asteroids.hits(craft.hits, craft.time); for (const h of craft.hits) { sound.hit(h.broke); if (h.fuel > 0) sound.chime() }; craft.hits.length = 0 }
    if (refView.body !== craft.ref) switchFrame()
    // A wreck holds the camera on itself, sweeping slowly round, then the respawn.
    if (craft.state === 'crashed') { crashedAt ??= elapsed; chase.orbitYaw += 0.25 * dt; if (elapsed - crashedAt > WRECK_HOLD) respawn() }
    ship.quaternion.copy(craft.quat)
    const flying = craft.state === 'flying'
    morphed += ((craft.cruise || craft.jet ? 1 : 0) - morphed) * Math.min(1, dt / 0.5)
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
    // Bent gear: the hover engine shakes the whole view while it burns.
    if (craft.gearBent && craft.thrusting && craft.state === 'flying') viewPos.add(wtmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3 * craft.damage))
    ship.position.copy(craft.pos).sub(viewPos)
    // Into the water: the hull goes down.
    if (craft.state === 'crashed' && craft.sunk) { sink += 1.4 * dt; ship.position.addScaledVector(wtmp.copy(craft.pos).normalize(), -sink) }
    // The dig: the auger, the heap, the module filling on the ground and hopping to its slot, the ship shaking, dust and the sound.
    {
      const seamNow = digging >= 0 ? craft.seamHere() : null
      const ph = digger.update(digging >= 0 && seamNow ? digging / DIG_SECONDS : -1, dt, seamNow?.good ?? null, craft)
      const slot = craft.cargo.length
      if (ph.on && seamNow && slot < modules.length) {
        const mod = modules[slot]
        mod.visible = true
        ;(mod.material as THREE.MeshLambertMaterial).color.setHex(GOOD_COLOUR[seamNow.good])
        const k = ph.hop * ph.hop * (3 - 2 * ph.hop)
        mod.position.lerpVectors(MODULE_GROUND, MODULE_SLOTS[slot], k)
        const s = ph.hop > 0 ? 1 : 0.2 + 0.8 * ph.fill
        mod.scale.set(s, s, s)
      }
      if (ph.drilling) {
        ship.position.add(wtmp.set(Math.random() - 0.5, 0, Math.random() - 0.5).applyQuaternion(craft.quat).multiplyScalar(0.07))
        digDust -= dt
        if (digDust <= 0) { digDust = 0.09; dust.burst(craft.pos, 2) }
      }
      sound.dig(ph.drilling ? 1 : 0, ph.on ? digging / DIG_SECONDS : 0)
    }
    if (Math.abs(altitude) < 0.05) altitude = 0
    if (!off.has('shadow')) shadow.update(craft)
    if (!off.has('dust')) dust.update(dt, craft.pos, altitude, flame.visible)
    // Touchdown: a puff and a scuff. Lift-off: a puff.
    if (craft.state !== lastState) {
      if (craft.state === 'landed' && craft.atmosphere() >= 0 && !craft.hitRock) { dust.burst(craft.pos, craft.gearBent ? 140 : 70); marks.add(craft.pos.clone().addScaledVector(dir.copy(craft.pos).normalize(), -HULL_CLEARANCE), dir, now / 1000, craft.gearBent ? 4 : 2.6) }
      if (craft.state === 'landed' && lastState === 'flying') saveGame()   // every landing is a save
      if (craft.state === 'flying' && lastState === 'landed') dust.burst(craft.pos, 40)
      // The wreck: into water a splash and the sink; on ground the facets tumble off, a
      // fireball, dust and a scorch. A burn-through or a rock leaves nothing to scatter.
      if (craft.state === 'crashed' && !craft.burned && !craft.hitRock) {
        const up = dir.copy(craft.pos).normalize()
        if (craft.sunk) dust.burst(craft.pos, 160)
        else {
          placeWreck(new Wreck(craft.terrain, craft.pos, craft.quat, craft.contactVel, craft.crashes * 7919 + 1), refView)
          ship.visible = false
          marks.add(craft.pos.clone().addScaledVector(up, -HULL_CLEARANCE), up, now / 1000, 12)
          dust.burst(craft.pos, 240)
          fireball.visible = true; fireAt = elapsed; firePos.copy(craft.pos)
        }
        sound.hit(true)
      }
      lastState = craft.state
    }
    for (const w of wrecks) if (!w.wreck.settled()) { w.wreck.step(dt); syncWreckMeshes(w.wreck, w.meshes) }
    // The boob drifts on; a flying ship on home can hit it (it shoves) or come close enough to name it (once, kept in the save).
    {
      const onHome = craft.ref.id === BOOB_BODY && craft.state === 'flying'
      if (onHome) { boobPos.copy(craft.pos); boobVel.copy(craft.vel) }
      boob.step(dt, craft.time, onHome ? boobPos : undefined, onHome ? boobVel : undefined)
      if (boob.hit) { craft.shove(boobPos, boobVel); sound.hit(false); toast(boob.hit.speed > 20 ? 'THAT WOBBLED' : 'BOOP') }
      if (onHome && boob.sight(craft.pos, craft.time)) { toast('CONTACT   ·   A BIG FLYING BOOB'); sound.chime(); saveBank() }
      syncBoob(boob, boobView, craft.time)
    }
    if (fireball.visible) {
      const a = (elapsed - fireAt) / 0.7
      if (a >= 1) fireball.visible = false
      else {
        fireball.position.copy(firePos).sub(viewPos)
        fireball.scale.setScalar(1.5 + 6 * Math.sqrt(a))
        const fm = fireball.material as THREE.MeshBasicMaterial
        fm.opacity = 0.9 * (1 - a); fm.color.setRGB(1, 0.55 - 0.45 * a, 0.2 - 0.2 * a)
      }
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
    light(lights.v, `V↑ ${vUp.toFixed(1)}`, -vUp, LAND_MAX_VSPEED, armed)
    light(lights.d, `DRIFT ${drift.toFixed(1)}`, drift, LAND_MAX_HSPEED, armed)
    light(lights.t, `TILT ${tilt.toFixed(0)}°`, tilt, LAND_MAX_TILT, armed)
    light(lights.s, `SLOPE ${slope.toFixed(0)}°`, slope, LAND_MAX_SLOPE, armed)
    const here = craft.state === 'landed' ? craft.padHere() : null
    altState.textContent = craft.state === 'landed' ? (here?.station ? `DOCKED  PAD ${here.pad}` : here?.outpost ? `ON THE PAD  ${here.outpost.name.toUpperCase()}` : here ? 'ON THE PAD' : 'DOWN') : craft.state === 'crashed' ? (craft.sunk ? 'SUNK' : craft.burned ? 'BURNED' : 'WRECKED') : `${gearDown > 0.5 ? 'GEAR ↓' : 'GEAR ↑'}${craft.assisting ? '   ASSIST' : ''}`
    altimeter.classList.toggle('cracked', craft.gearBent)
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
      hullEl.textContent = over > 0.05 || craft.damage > 0 ? `HULL ${(over * 100).toFixed(0)}%${craft.damage > 0 ? `   DAMAGE ${(craft.damage * 100).toFixed(0)}%` : ''}${craft.gearBent ? '   GEAR BENT' : ''}${craft.cruise && rho > 0 ? '   RE-ENTRY: flip and brake' : ''}` : ''
      hullEl.className = 'atmos ' + (over > 1 ? 'dry' : over > HULL_WARN ? 'low' : '')
      bankEl.textContent = `${credits(bank.balance)}${bank.loan > 0 ? `   LOAN ${credits(bank.loan)}` : ''}`
      const seamHere = craft.state === 'landed' ? craft.seamHere() : null
      cargoEl.textContent = digging >= 0 ? `DIGGING ${Math.round(100 * digging / DIG_SECONDS)}%` : craft.cargo.length ? `CARGO ${craft.cargo.map((c) => `${c.good.toUpperCase()} ${c.tonnes.toFixed(0)} t`).join(' · ')}` : seamHere ? `ON SEAM  ${seamHere.good.toUpperCase()} ${seamHere.richness.toFixed(0)} t   U digs` : townHere() ? '' : ''
      for (let i = 0; i < modules.length; i++) if (i < craft.cargo.length) { modules[i].visible = true; modules[i].position.copy(MODULE_SLOTS[i]); modules[i].scale.setScalar(1); (modules[i].material as THREE.MeshLambertMaterial).color.setHex(GOOD_COLOUR[craft.cargo[i].good]) } else if (!(digging >= 0 && i === craft.cargo.length)) modules[i].visible = false
      if ((frames & 15) === 0) goalEl.textContent = goalLine()
      bankEl.className = 'atmos' + (bank.balance < 200 ? ' low' : '')
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
    // The nearest outposts are on the compass now; the on-screen marker went with Chris's "words just appear".
    markers.place('outpost', dir, camera, false)
    const eta = closing > 1 && tSurf / closing < 86400 ? `  ETA ${fmtTime(tSurf / closing)}` : ''
    // The diamond stays on the target; its name and distance live on the compass now.
    markers.place('target', tDir, camera, showNav || cleared !== '', `${closing >= 0 ? '↓' : '↑'}${fmtSpeed(Math.abs(closing))}${eta}${cleared}`)
    // The compass strip: every body and station, the nearest outposts here, the cluster if it is the target.
    compassItems.length = 0
    for (const tg of bodyTargets) {
      if (!tg.station && tg.name === craft.ref.name) continue   // the ground under you is not a destination
      const d = wtmp.copy(tg.rel).sub(craft.pos); const len = d.length(); if (len < 1) continue
      compassItems.push({ key: tg.name, name: tg.name, dist: fmtDist(tg.station ? Math.max(0, len - tg.radius) : shownDistance(Math.max(0, len - tg.radius))), d: len, dir: d.divideScalar(len).clone(), kind: tg.station ? 'station' : 'body', selected: tg === tgt })
    }
    const nearHere = outpostViews.filter((ov) => ov.view.body === craft.ref).map((ov) => ({ ov, d: ov.rel.distanceTo(craft.pos) })).sort((a, b) => a.d - b.d).slice(0, 3)
    for (const { ov, d } of nearHere) if (d > 300) compassItems.push({ key: ov.o.name, name: ov.o.name, dist: fmtDist(d), d, dir: wtmp.copy(ov.rel).sub(craft.pos).divideScalar(d).clone(), kind: 'outpost', selected: false })
    if (tgt.field) compassItems.push({ key: tgt.name, name: tgt.name, dist: fmtDist(tSurf), d: tSurf, dir: tDir.clone(), kind: 'field', selected: true })
    if (elapsed < scanUntil) {
      if (scanHit) {
        const d = wtmp.copy(scanHit.rel).sub(craft.pos); const len = d.length()
        compassItems.push({ key: 'scan', name: `${scanHit.seam.good.toUpperCase()} ${scanHit.seam.richness} t`, dist: fmtDist(len), d: len, dir: d.divideScalar(len).clone(), kind: 'seam', selected: false })
        // The beeper: every 2 s at range, every 0.25 s on top of it.
        if (elapsed > scanBeepAt) { scanBeepAt = elapsed + 0.25 + 1.75 * Math.min(1, len / SCAN_RANGE); sound.click() }
      } else compassItems.push({ key: 'scan', name: 'NO SEAM IN RANGE', dist: '', d: Infinity, dir: dir.clone().negate(), kind: 'seam', selected: false })
      if (scanBoob && craft.ref.id === BOOB_BODY) {
        const d = wtmp.copy(boob.pos).sub(craft.pos); const len = d.length()
        compassItems.push({ key: 'boob', name: boobName(), dist: fmtDist(len), d: len, dir: d.divideScalar(len).clone(), kind: 'contact', selected: false })
      }
    }
    compass.update(compassItems, camera, !paused && !starting && (phase === 'off' || phase === 'done'))
    const lc = craft.lastContact
    const vOrb = craft.orbitalSpeed(), vEsc = craft.escapeSpeed(), spd = craft.speed(), vIn = craft.inertialSpeed()
    const apLine = orbitAP.engaged ? `   AUTOPILOT ${orbitAP.phase.toUpperCase()} ${craft.ref.name}  park ${((orbitAP.parkRadius(craft) - craft.terrain.radius) / 1000).toFixed(0)} km at ${orbitAP.parkSpeed(craft).toFixed(0)} m/s` : ''
    const rn = craft.rockNear
    const rockLine = rn.rock && rn.dist < 30000 ? `   ROCK ${fmtDist(rn.dist)}${rn.dist < 2000 ? (rn.rock.ice ? '  ICE' : '  STONE') : ''}${craft.cruise ? '  (F fires)' : '  (cannons stowed in hover)'}` : ''
    const spaceLine = rho < 1 || craft.jet ? `${craft.cruise ? `CRUISE  cap ${fmtSpeed(craft.cap())}` : craft.jet ? `JET  stall ${Math.sqrt((craft.terrain.g * craft.massFactor()) / (JET_LIFT * Math.max(0.05, rho))).toFixed(0)} m/s  J hover` : 'HOVER'}${apLine}   SOI ${craft.ref.name}   orbit ${vOrb.toFixed(0)}   escape ${vEsc.toFixed(0)}   ${craft.cruise ? '' : vIn > vEsc ? '!! ESCAPING !!' : vIn > vOrb ? 'above orbital' : ''}   target ${tgt.name}${tgt.field ? ` (${fieldIndex + 1} of ${nearFields.length} nearest, V)` : ' (Tab)'}${rockLine}\n` : ''
    line = `alt ${(altitude < 500 ? altitude.toFixed(1) : shownDistance(altitude).toFixed(0)).padStart(6)} m   v↑ ${vUp.toFixed(1).padStart(5)} m/s   spd ${fmtSpeed(spd).padStart(9)}   tilt ${tilt.toFixed(0).padStart(2)}°   ${craft.state.toUpperCase()}   landings ${craft.landings}  crashes ${craft.crashes}\n` + spaceLine +
      (craft.state === 'crashed' ? `contact: ${craft.burned ? 'HULL BURNED THROUGH  ' : craft.hitRock ? 'ROCK  ' : ''}v↑ ${lc.vUp.toFixed(1)}  drift ${lc.vH.toFixed(1)}  tilt ${lc.tilt.toFixed(0)}°  slope ${lc.slope.toFixed(0)}°   R to respawn\n` : '') +
      `Esc  menu and controls   ${fps} fps   chunks ${refView.lod?.liveCount ?? 0}`
  } else {
    setGroundClock(t)
    weatherFront = -1; rainNow = 0; cloudNow = 0; windNow = 4
    puffs.update(free.pos, HOME, t)
    boob.step(dt, t); syncBoob(boob, boobView, t)
    dir.copy(free.pos).normalize()
    altitude = free.pos.length() - HOME.radius - height(dir, HOME)
    const speed = free.update(dt, altitude)
    viewPos.copy(free.pos); viewQuat.copy(free.quat)
    const [lo, hi] = planet.levelRange()
    line = `alt ${altitude.toFixed(0)} m   speed ${speed.toFixed(0)} m/s   chunks ${planet.liveCount} (+${planet.pendingCount})   lod ${lo}..${hi}   ${fps} fps\nWASD move  R/F up/down  Q/E roll  drag to look  shift = fast`
    markers.hide()
    compass.update(compassItems, camera, false)
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
  hud.textContent = !starting && (phase === 'off' || phase === 'done') ? line : ''
})
void tmp

// For the harnesses.
;(window as unknown as { __noelite: unknown }).__noelite = {
  mode, planet, craft, input, free, views, asteroids, ship,
  /** The opening's phase and the letterbox, for the probes. */
  phase: () => phase, barFrac: () => barFrac, titleBody: () => titleBody,
  outposts: outpostViews, wrecks, bank, scan, scanHit: () => scanHit, boob, boobView, scanBoob: () => scanBoob, digger, modules, use, digging: () => digging, townHere, towns: allTowns, startDemo, stopDemo, demo: () => demo, demoStep: () => demoStep, pilot, starting: () => starting, sandbox: () => sandbox,
  /** True only once the LOD has updated since the last place() and its queue is empty. */
  ready: () => updates > placedAt + 1 && planet.pendingCount === 0,
  /** Free mode: put the camera at p looking at a. */
  place: (px: number, py: number, pz: number, ax: number, ay: number, az: number) => { free.pos.set(px, py, pz); free.lookAt(new THREE.Vector3(ax, ay, az)); placedAt = updates },
  altitude: () => mode === 'fly' ? craft.altitude() : free.pos.length() - HOME.radius - height(free.pos.clone().normalize(), HOME),
  respawn,
}
