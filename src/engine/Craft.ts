// The craft. One rigid body, DESIGN.md §5 "Flight: one model, not two".
//
// Since Stage C (2026-09-02) the truth is heliocentric: `hpos`, `hvel`, `hquat` in
// the sun's inertial frame, gravity summed from every body in the system, and a
// reference body chosen by sphere of influence. Everything outside reads the LOCAL
// VIEW instead: `pos`, `vel`, `quat` in the reference body's rotating frame with a
// ground-relative velocity, which is what the renderer, the camera, the HUD and the
// harness always read. Landed means riding the body: the rest pose is body-fixed and
// the heliocentric state is re-derived from it every step, so lifting off inherits
// the surface velocity without anyone having to remember to add it.
//
// Thrust fires along the body's own up-axis in air (tilt to move, tilt back to
// stop) and along the nose in vacuum (cruise). Integrates at FIXED_DT so a recorded
// input tape replays exactly. No browser dependency: tools/verify-flight.mjs drives
// this straight from Node.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { onRunway, terrainOf, padOf, stationOf, outpostsOf, type Station, type Outpost } from '../world/height.ts'
import { seamsOf, type Seam, type Good } from '../world/seams.ts'
import { groundRadius, surfaceNormal, slopeDeg, setGroundClock, isDry } from '../world/terrain.ts'
import { wind } from '../world/weather.ts'
import { atmosphereDensity } from '../world/atmosphere.ts'
import { SYSTEM, body, bodyPosition, bodyVelocity, bodySpin, type Body } from '../world/system.ts'
import { nearestRock, sweep, fuelYield, breakRock, fieldPosition, fieldVelocity, rockPosition, type Nearest, type Hit, type Rock } from '../world/asteroids.ts'
import {
  DRAG, THRUST_ACCEL, ANG_ACCEL, ANG_DAMP,
  HULL_CLEARANCE, LAND_MAX_VSPEED, LAND_MAX_HSPEED, LAND_MAX_TILT, LAND_MAX_SLOPE, FIXED_DT,
  BOOST_MULT, GROUND_EFFECT_HEIGHT, GROUND_EFFECT_ACCEL_G, GROUND_EFFECT_DAMP, GRAVITY_FALLOFF, RCS_ACCEL,
  CRUISE_ENTER, CRUISE_EXIT, CRUISE_FLOOR, CRUISE_ALIGN_TAU, CRUISE_MAX, CRUISE_FLOOR_SPEED, CRUISE_BRAKE, CRUISE_DECEL, CRUISE_SECONDS, CRUISE_SPOOL,
  FUEL_TANK, FUEL_HOVER_BURN, FUEL_CRUISE_BURN, FUEL_RCS_BURN, FUEL_PAD_REFILL, FUEL_SOLAR_TRICKLE, FUEL_RELIGHT, PAD_RADIUS,
  CRASH_DAMAGE_SCALE, CRASH_MIN_DAMAGE, FUEL_PRICE, REPAIR_PRICE, CARGO_PODS, POD_TONNES, SHIP_TONNES, POD_DRAG, DIVE_ACCEL,
  JET_DRAG, JET_LIFT, JET_LIFT_MAX_G, JET_ALIGN_TAU, JET_MIN_AIR, JET_BANK_MAX_TAN, JET_PITCH_RATE, JET_ROLL_RATE, JET_YAW_RATE, JET_RESPONSE, JET_LEVEL_TAU, JET_LEVEL_DEAD, JET_INDUCED, JET_BOOST_MULT, ROLL_DECEL, ROLL_BRAKE, ROLL_STEER, RUNWAY_HEADING_DEG,
  GUN_RANGE, GUN_COOLDOWN, ICE_REACH, BOLT_SPEED,
  GUN_MUZZLE, HEAT_K, HEAT_RAMP_LO, HEAT_RAMP_HI, HEAT_RAMP_MIN, HEAT_TAU, COOL_RATE, COOL_MIN, HULL_LIMIT, DAMAGE_TAU, HOVER_MAX_SPEED,
} from '../world/config.ts'

/**
 * pitch: nose down positive. roll: right wing down positive. yaw: nose right positive. All -1..1.
 * thrust 0..1 on the main engine, boost 0..1 multiplies it.
 * RCS, body frame, small: lateral (+ right), vertical (− is the top thruster pushing you down), fore (+ rear thruster pushing you forward).
 */
export type Controls = { pitch: number; roll: number; yaw: number; thrust: number; boost: number; lateral: number; vertical: number; fore: number }
export const IDLE: Readonly<Controls> = Object.freeze({ pitch: 0, roll: 0, yaw: 0, thrust: 0, boost: 0, lateral: 0, vertical: 0, fore: 0 })

/** `rolling`: on a runway at speed after a jet landing, slowing on its wheels (DESIGN §10l-2). */
export type CraftState = 'landed' | 'flying' | 'crashed' | 'rolling'

export type Bolt = { pos: THREE.Vector3; vel: THREE.Vector3; dir: THREE.Vector3; dies: number; alive: boolean; side: number }
export type BoltHit = { hit: Hit; broke: boolean; fuel: number }
const BOLT_POOL = 32

const BODY_UP = new THREE.Vector3(0, 1, 0)
const BODY_FWD = new THREE.Vector3(0, 0, -1)
const TWO_PI = Math.PI * 2

/** 1 below CRUISE_FLOOR, 0 above twice it. See Craft.hold. */
function holdAt(alt: number): number { return Math.min(1, Math.max(0, (2 * CRUISE_FLOOR - alt) / CRUISE_FLOOR)) }

/** m/s² at distance r from the body's centre. Readouts (orbital and escape speed); the integrator sums real μ/r² from every body. */
export function gravityAt(r: number, t: Terrain): number {
  return t.g * (t.radius / r) ** GRAVITY_FALLOFF
}

export class Craft {
  /** Local view: the reference body's rotating frame, velocity relative to the ground. */
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  readonly quat = new THREE.Quaternion()
  /** The truth: heliocentric, inertial. */
  readonly hpos = new THREE.Vector3()
  readonly hvel = new THREE.Vector3()
  readonly hquat = new THREE.Quaternion()
  /** Body frame, rad/s. */
  readonly angVel = new THREE.Vector3()
  /** Simulation clock, seconds. The system is a function of it. */
  time = 0
  /** The body whose sphere of influence you are in. Frame, ground, air and altimeter all follow it. */
  ref: Body
  terrain: Terrain
  /** True for the step in which the reference body changed, so the camera can snap to the new frame. */
  refChanged = false
  state: CraftState = 'landed'
  thrusting = false
  /**
   * False near ground or in air: Zarch, thrust along body-up, tilt to move. True in
   * vacuum and high up: cruise, thrust along the nose, velocity follows the nose,
   * / brakes. Switches on density with hysteresis, and never above CRUISE_FLOOR of
   * altitude, so an airless moon still gets a hover landing.
   */
  cruise = false
  /** Jet mode: wings and lift in air, flicked with J. Never together with cruise. */
  jet = false
  private readonly bodyRight = new THREE.Vector3()
  /** Metres to the nearest thing: the reference body's ground below, another body's sphere, or a rock. Drives the thrust gain. */
  proximity = Infinity
  /** Metres to the ground of the reference body, and to the nearest other body's surface. The two cap profiles key off these. */
  private bodyGap = Infinity
  private otherGap = Infinity
  /** Metres to the surface of the target ahead, set by whoever knows the target; Infinity for none. Caps cruise too, so you arrive. */
  arrive = Infinity
  /** True when `arrive` is a body with a hover floor (the floor profile applies), false for a rock field or a station in space. */
  arriveFloor = true
  /** The opening holds you to hover until dawn: cruise will not engage while this is set. */
  cruiseLocked = false
  /**
   * Landing assist, on by default. In hover near the ground it never lets you fall faster
   * than the height allows (it levels the ship and fires the engine, boost if it must),
   * and with your hands off it flies the landing: leans against drift, comes down on a
   * profile, touches at walking pace. Chris, 2026-09-03: "if I dive head first into it,
   * it should auto brake so I don't crash and smooth its way to the surface, it shouldn't
   * be a skill thing if it's that easy to need a restart." The harness turns it off to
   * test raw falls. It cannot help where the engine cannot lift the ship (the giant), or
   * with a dry tank.
   */
  assist = true
  /** True while the assist is overriding the controls, for the HUD. */
  assisting = false
  /** Once the low-level branch has taken the attitude it keeps it until you climb or stop sinking, so a held stick cannot re-tilt the ship between touches of the floor. */
  private assistLatch = false
  /** The assist's wind term, its own scratch: the substep's `tmp` is busy inside level(). */
  private readonly windH = new THREE.Vector3()
  /** Weather on. The harness turns it off for tests that are not about weather. */
  windy = true
  /** The wind at the craft, m/s, local frame. Zero in vacuum. */
  readonly wind = new THREE.Vector3()
  landings = 0
  crashes = 0
  /** Units in the tank, 0..FUEL_TANK. Dry means the engine and the RCS do nothing. */
  fuel = FUEL_TANK
  /** Units per second going out of the tank this substep, for the endurance readout. */
  burn = 0
  /** The nearest surviving rock, refreshed every substep: surface distance and position (heliocentric). */
  readonly rockNear: Nearest = { rock: null, dist: Infinity, pos: new THREE.Vector3() }
  /** The rock you hit, if the last contact was a rock. */
  hitRock: Rock | null = null
  /** Hull temperature, degrees over ambient. Re-entry heating; see config HEAT_*. */
  hull = 0
  /** Hull damage 0..1 from running over HULL_LIMIT. At 1 the hull is gone. Repaired docked. */
  damage = 0
  /** True when the last crash was the hull burning through. */
  burned = false
  /** A hard landing bent the gear: it flies, with a limp and a vibration, until repaired. */
  gearBent = false
  /** The last wreck went into water: no debris, the hull sinks. */
  sunk = false
  /** Credits the company can spend on this ship right now; the game sets it before each step. Pads and repairs stop when it runs out. */
  credit = Infinity
  /** What the ship took at pads since the game last drained it: fuel units and hull repaired (0..1). The game charges these. */
  readonly bought = { fuel: 0, repair: 0 }
  /** The pods on the hull (DESIGN §10): each a good and its tonnes. Mass is felt three ways: thrust, turning and drag. */
  readonly cargo: { good: Good; tonnes: number }[] = []
  cargoTonnes(): number { let t = 0; for (const c of this.cargo) t += c.tonnes; return t }
  /** How much heavier the ship is with what it carries: 1 empty. Divides every acceleration. */
  massFactor(): number { return 1 + this.cargoTonnes() / SHIP_TONNES }
  /** Room for another pod? */
  canLoad(): boolean { return this.cargo.length < CARGO_PODS }
  /** Put a pod aboard; false if there is no room. */
  load(good: Good, tonnes = POD_TONNES): boolean { if (!this.canLoad()) return false; this.cargo.push({ good, tonnes }); return true }
  /** The seam the craft is landed inside, if any. */
  seamHere(): Seam | null {
    if (this.state !== 'landed') return null
    this.up.copy(this.pos).normalize()
    for (const s of seamsOf(this.terrain)) if (Math.acos(Math.min(1, this.up.x * s.dir.x + this.up.y * s.dir.y + this.up.z * s.dir.z)) * this.terrain.radius < s.radius) return s
    return null
  }
  /** Contact velocity in the local frame at the last touchdown or crash, for the debris. */
  readonly contactVel = new THREE.Vector3()
  /** Bolts in flight, heliocentric. A pool; `alive` says which count. */
  readonly bolts: Bolt[] = []
  /** What bolts did this step: a hit, and whether the rock broke and what fuel came home. Cleared by whoever draws them. */
  readonly hits: BoltHit[] = []
  private gunReady = 0
  private gunSide = 1
  /**
   * A field is a frame too. Between the sun (whose frame is at rest) and a Trojan
   * cluster doing 1.6 km/s, "relative velocity" would otherwise mean the rocks stream
   * past you and the cruise assist bleeds your orbital speed away. Within three
   * spreads of a field's centre its velocity blends into the frame's, so arriving at
   * a field matches you to it. In any body's sphere, as that field's velocity over the
   * body's own; the blend also fades with `hold`, so near the ground the ground wins.
   */
  private fieldWeight = 0
  private readonly fieldVel = new THREE.Vector3()
  /** Set by the last contact, for the HUD and the harness. */
  lastContact = { vUp: 0, vH: 0, tilt: 0, slope: 0 }

  private accumulator = 0
  /**
   * How much of the reference body's spin the local frame carries: 1 on the ground and
   * through the air, fading to 0 by twice CRUISE_FLOOR. Drag is against co-rotating air
   * and a landing is judged against the ground; in orbit the frame stops turning, because
   * the sun's co-rotating frame at home's distance moves at 650 km/s and nobody wants that
   * in a speed readout. Position never fades (the scene is drawn in the spinning frame);
   * only what "relative velocity" means.
   */
  private hold = 1
  // Rest pose, body-fixed, held while landed or crashed.
  private readonly restPos = new THREE.Vector3()
  private readonly restQuat = new THREE.Quaternion()
  // The reference body's frame at `time`: centre, velocity, spin, angular velocity (inertial).
  private readonly bPos = new THREE.Vector3()
  private readonly bVel = new THREE.Vector3()
  private readonly spin = new THREE.Quaternion()
  private readonly spinInv = new THREE.Quaternion()
  private readonly omega = new THREE.Vector3()
  // Scratch.
  private readonly rel = new THREE.Vector3()
  private readonly frameVel = new THREE.Vector3()
  private readonly vRel = new THREE.Vector3()
  private readonly localDir = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly bodyUp = new THREE.Vector3()
  private readonly acc = new THREE.Vector3()
  private readonly dq = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly n = new THREE.Vector3()
  private readonly rcs = new THREE.Vector3()
  private readonly nose = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()

  /** `terrain` names the starting body; the craft looks the body up by id. */
  constructor(terrain: Terrain) {
    this.ref = body(terrain.id)
    this.terrain = terrain
  }

  /** Altitude of the hull's feet above the ground directly below. */
  altitude(): number {
    this.up.copy(this.pos).normalize()
    return this.pos.length() - groundRadius(this.up, this.terrain) - HULL_CLEARANCE
  }

  /** Atmospheric density where the craft is, 1 on the deck, 0 in vacuum. */
  atmosphere(): number { return atmosphereDensity(this.altitude() + HULL_CLEARANCE, this.terrain.air) }

  /** Ground-relative speed: what the pilot feels and what a landing is judged on. */
  speed(): number { return this.vel.length() }
  /** Speed relative to the reference body's centre, not its spin: the one to compare with orbital speed. */
  inertialSpeed(): number { return this.tmp.copy(this.hvel).sub(this.bVel).length() }
  /** Circular orbital speed at the craft's current radius. */
  orbitalSpeed(): number { const r = this.pos.length(); return Math.sqrt(gravityAt(r, this.terrain) * r) }
  /** Speed beyond which gravity never brings you back. */
  escapeSpeed(): number { const r = this.pos.length(); return Math.sqrt(2 * gravityAt(r, this.terrain) * r) }

  /** Contact damage 0..1 for a touchdown at these numbers. Pure, so the harness can hold its shape. */
  static contactDamage(vUp: number, vH: number, tilt: number, slope: number): number {
    const sv = Math.max(0, -vUp) / LAND_MAX_VSPEED, sh = vH / LAND_MAX_HSPEED
    const s = Math.max(sv * sv, sh * sh)
    if (s < 1 && tilt < LAND_MAX_TILT && slope < LAND_MAX_SLOPE) return 0
    return Math.min(1, Math.max(CRASH_MIN_DAMAGE, (s - 1) * CRASH_DAMAGE_SCALE))
  }
  /** Seconds the tank lasts at the current burn; Infinity when nothing is burning. */
  endurance(): number { return this.burn > 0 ? this.fuel / this.burn : Infinity }
  /** The pad under the craft, within PAD_RADIUS along the ground: the home pad (no station, pad 0), a numbered station pad, or an outpost's pad. */
  padHere(): { station: Station | null; pad: number; outpost: Outpost | null } | null {
    this.up.copy(this.pos).normalize()
    const within = (d: { x: number; y: number; z: number }) => Math.acos(Math.min(1, this.up.x * d.x + this.up.y * d.y + this.up.z * d.z)) * this.terrain.radius < PAD_RADIUS
    const site = padOf(this.terrain)
    if (site && within(site.dir)) return { station: null, pad: 0, outpost: null }
    const st = stationOf(this.terrain)
    if (st) for (const p of st.pads) if (within(p.dir)) return { station: st, pad: p.n, outpost: null }
    for (const o of outpostsOf(this.terrain)) if (within(o.site.dir)) return { station: null, pad: 0, outpost: o }
    return null
  }
  /** On any pad, outpost or station. Pads refuel. */
  onPad(): boolean { return this.padHere() !== null }

  /**
   * Attitude assist. Pitch and roll inputs that swing the thrust axis (body up)
   * toward `target` (unit, local frame). A P-controller on angular velocity whose
   * setpoint is the angle error, so it plays the same keys a pilot would.
   */
  aimControls(target: THREE.Vector3, k = 3): { pitch: number; roll: number; yaw: number } {
    this.dq.copy(this.quat).invert()
    this.fwd.copy(target).applyQuaternion(this.dq) // target in body frame
    const clamp = (x: number) => Math.max(-1, Math.min(1, x))
    if (this.cruise) {
      // Aim the nose (-Z). Error axis is fwd × t = (ty, -tx, 0): pitch and yaw, roll free.
      let tx = this.fwd.x, ty = this.fwd.y
      if (this.fwd.z > 0.995 && Math.hypot(tx, ty) < 0.05) ty = 1 // dead astern: pitch up and over
      return { pitch: -clamp(k * ty - this.angVel.x), roll: 0, yaw: -clamp((-k * tx - this.angVel.y) / 0.6) }
    }
    let tx = this.fwd.x, tz = this.fwd.z
    // Dead astern the cross product vanishes and a P-controller balances on the
    // point forever (boost straight up, press retro: exactly this). Pitch over.
    if (this.fwd.y < -0.995 && Math.hypot(tx, tz) < 0.05) { tx = 0; tz = 1 }
    return { pitch: -clamp(k * tz - this.angVel.x), roll: -clamp(-k * tx - this.angVel.z), yaw: 0 }
  }

  /** The cruise speed allowed at distance d from a surface with no hover floor (a rock): brakeable to CRUISE_MAX at it, d / CRUISE_SECONDS far from it. */
  cruiseCap(d: number): number {
    d = Math.max(0, d)
    return Math.max(Math.sqrt(CRUISE_MAX * CRUISE_MAX + 2 * CRUISE_DECEL * d), d / CRUISE_SECONDS)
  }
  /** The cruise speed allowed d metres over a body's ground: CRUISE_FLOOR_SPEED at the hover floor, brakeable above it, d / CRUISE_SECONDS far out. */
  bodyCap(d: number): number {
    d = Math.max(0, d)
    const over = Math.max(0, d - CRUISE_FLOOR)
    return Math.max(Math.sqrt(CRUISE_FLOOR_SPEED * CRUISE_FLOOR_SPEED + 2 * CRUISE_DECEL * over), over / CRUISE_SECONDS)
  }
  /** The cap in force now: the reference body's ground, any other body, the nearest rock, or the target, whichever is tightest. */
  cap(): number {
    return Math.min(this.bodyCap(this.bodyGap), this.bodyCap(this.otherGap), this.cruiseCap(this.rockNear.dist), this.arriveFloor ? this.bodyCap(this.arrive) : this.cruiseCap(this.arrive))
  }

  /** Vertical speed, positive up, relative to the ground. */
  vUp(): number { return this.vel.dot(this.up.copy(this.pos).normalize()) }

  /** Degrees between the craft's up and the local vertical. */
  tilt(): number {
    this.up.copy(this.pos).normalize()
    this.bodyUp.copy(BODY_UP).applyQuaternion(this.quat)
    return (Math.acos(Math.min(1, Math.max(-1, this.bodyUp.dot(this.up)))) * 180) / Math.PI
  }

  /**
   * Put it down at rest in direction `dir` on `on` (default: the current reference body),
   * feet on the ground, nose along `heading` if given. `align: 'surface'` sits it on the
   * slope, so thrust from a tilted pad pushes you sideways, which is honest. `'radial'`
   * is dead level, for harnesses that only want to test landing.
   */
  spawnOn(dir: THREE.Vector3, heading?: THREE.Vector3, align: 'surface' | 'radial' = 'surface', on?: Body): void {
    this.setRef(on ?? this.ref)
    this.up.copy(dir).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE)
    this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(align === 'surface' ? surfaceNormal(this.up, this.terrain, this.n) : this.n.copy(this.up), heading)
    this.rest()
    this.hold = 1
    this.state = 'landed'
    this.thrusting = false
    this.cruise = false
    this.jet = false
    this.fuel = FUEL_TANK
    this.burn = 0
    this.cargo.length = 0   // a fresh hull carries nothing; the save puts its cargo back after this
    this.hitRock = null
    this.hull = 0
    this.damage = 0
    this.burned = false
    this.gearBent = false
    this.sunk = false
    this.accumulator = 0
    this.frameAt(this.time)
    this.syncHelio()
  }

  /** J: wings out in air, or back to hover. Says what happened, for the toast. */
  toggleJet(): 'jet' | 'hover' | 'no-air' | 'no' {
    if (this.jet) { this.jet = false; return 'hover' }
    if (this.state !== 'flying' || this.cruise) return 'no'
    if (this.atmosphere() < JET_MIN_AIR) return 'no-air'
    this.jet = true
    return 'jet'
  }

  /** Something outside the physics moved the ship (the boob shoved it): take the local pose and re-derive the heliocentric state, which the substep integrates. */
  shove(pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.pos.copy(pos)
    this.vel.copy(vel)
    this.frameAt(this.time)
    this.syncHelio()
  }

  /** Hang it in the air `altitude` metres over direction `dir` on `on`, level, at rest relative to the ground (or moving at `velocity`, local frame). */
  placeAbove(on: Body, dir: THREE.Vector3, altitude: number, heading?: THREE.Vector3, velocity?: THREE.Vector3): void {
    this.setRef(on)
    this.up.copy(dir).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE + altitude)
    if (velocity) this.vel.copy(velocity); else this.vel.set(0, 0, 0)
    this.angVel.set(0, 0, 0)
    this.alignTo(this.n.copy(this.up), heading)
    this.hold = holdAt(altitude)
    this.state = 'flying'
    this.thrusting = false
    this.cruise = false
    this.jet = false
    this.accumulator = 0
    this.frameAt(this.time)
    this.syncHelio()
  }

  /**
   * Put it in cruise `gap` metres off rock `r`, nose on it, at rest with its field.
   * The sun is the reference (fields live in its sphere). For ?field= and the harness.
   */
  placeNearRock(r: Rock, gap: number): void {
    this.setRef(body('sun'))
    this.frameAt(this.time)
    rockPosition(r, this.time, this.hpos)
    this.hpos.z += r.radius + gap
    fieldVelocity(r.field, this.time, this.hvel)
    this.hquat.identity()
    this.angVel.set(0, 0, 0)
    this.hold = 0
    this.state = 'flying'
    this.thrusting = false
    this.cruise = true
    this.jet = false
    this.hitRock = null
    this.accumulator = 0
    this.fieldWeight = 1
    fieldVelocity(r.field, this.time, this.fieldVel)
    this.syncLocal()
  }

  /** Advance by real time; integrates in FIXED_DT substeps. Returns substeps taken. */
  step(dt: number, c: Controls): number {
    this.accumulator += Math.min(dt, 0.25)
    let n = 0
    while (this.accumulator >= FIXED_DT) { this.substep(FIXED_DT, c); this.accumulator -= FIXED_DT; n++ }
    return n
  }

  /** One exact substep. The harness calls this directly. */
  substep(h: number, c: Controls): void {
    // A dry tank: the controls still move but nothing answers. In the air the engine dies
    // with the last drop; on the ground it will not light again on less than FUEL_RELIGHT.
    const dry = this.fuel <= 0 || (this.state === 'landed' && this.fuel < FUEL_RELIGHT)
    if (dry && (c.thrust || c.lateral || c.vertical || c.fore)) c = { ...c, thrust: 0, lateral: 0, vertical: 0, fore: 0 }
    this.thrusting = c.thrust > 0
    this.refChanged = false
    setGroundClock(this.time)
    if (this.state === 'rolling') { this.rollStep(h, c); return }
    if (this.state !== 'flying') {
      if (this.state === 'landed' && (c.thrust > 0 || c.vertical > 0)) this.state = 'flying'
      else {
        this.burn = 0
        this.stepBolts(h)
        this.heat(0, 0, h)
        if (this.state === 'landed') {
          const here = this.padHere()
          // A pad sells fuel while the credit lasts; the sun trickles for free everywhere.
          if (here) {
            const take = Math.min(FUEL_TANK - this.fuel, FUEL_PAD_REFILL * h, this.credit / FUEL_PRICE)
            if (take > 0) { this.fuel += take; this.bought.fuel += take; this.credit -= take * FUEL_PRICE }
          }
          this.fuel = Math.min(FUEL_TANK, this.fuel + FUEL_SOLAR_TRICKLE * h)
          // Docked at a station, the hull is patched up, for money.
          if (here?.station) {
            const fix = Math.min(this.damage, 0.05 * h, this.credit / REPAIR_PRICE)
            if (fix > 0) { this.damage -= fix; this.bought.repair += fix; this.credit -= fix * REPAIR_PRICE }
            if (this.damage < 1e-6) { this.damage = 0; this.gearBent = false }
          }
        }
        // Ride the body: the rest pose is body-fixed, the heliocentric state follows it.
        this.time += h
        this.frameAt(this.time)
        this.pos.copy(this.restPos); this.quat.copy(this.restQuat); this.vel.set(0, 0, 0)
        this.syncHelio()
        return
      }
    }
    this.frameAt(this.time)

    // Gravity from every body, and how close the nearest surface is.
    this.acc.set(0, 0, 0)
    this.otherGap = Infinity
    for (const b of SYSTEM) {
      bodyPosition(b, this.time, this.tmp).sub(this.hpos)
      const r2 = this.tmp.lengthSq(), r = Math.sqrt(r2)
      this.acc.addScaledVector(this.tmp, b.mu / (r2 * r))
      if (b !== this.ref) this.otherGap = Math.min(this.otherGap, r - b.radius)
    }
    nearestRock(this.hpos, this.time, this.rockNear)
    this.fieldWeight = 0
    if (this.rockNear.rock && this.hold < 1) {
      const f = this.rockNear.rock.field
      const dc = fieldPosition(f, this.time, this.tmp).distanceTo(this.hpos)
      this.fieldWeight = Math.min(1, Math.max(0, (3 * f.spread - dc) / f.spread)) * (1 - this.hold)
      // The field's velocity over and above the reference body's own.
      if (this.fieldWeight > 0) fieldVelocity(f, this.time, this.fieldVel).sub(this.bVel)
    }
    // A rock is a wall. Inside its surface (plus the hull) you are wreckage; the cap
    // brings you in gently if you aim at one, but nothing stops you flying into it.
    if (this.rockNear.rock && this.rockNear.dist < HULL_CLEARANCE) {
      this.hitRock = this.rockNear.rock
      this.crashOn(this.rockNear.rock, this.rockNear.pos)
      return
    }

    // Where we are relative to the reference body: altitude, air, the frame's velocity.
    this.rel.copy(this.hpos).sub(this.bPos)
    const r = this.rel.length()
    this.up.copy(this.rel).divideScalar(r)
    this.localDir.copy(this.up).applyQuaternion(this.spinInv)
    const alt = r - groundRadius(this.localDir, this.terrain)
    this.bodyGap = Math.max(0, alt)
    this.proximity = Math.max(0, Math.min(this.bodyGap, this.otherGap, this.rockNear.dist))
    const rhoNow = atmosphereDensity(alt, this.terrain.air)
    this.frameVelAt(this.rel, this.frameVel)
    this.vRel.copy(this.hvel).sub(this.frameVel)
    // Into hover on density or the floor, but only once you are slow enough: above
    // HOVER_MAX_SPEED you are still re-entering, in cruise, with the air dragging and the
    // hull heating, and the way out is to flip and brake (DESIGN §8b item 4).
    if (this.cruise ? (rhoNow > CRUISE_EXIT || alt < CRUISE_FLOOR) && (rhoNow <= 0 || this.vRel.length() < HOVER_MAX_SPEED) : rhoNow < CRUISE_ENTER && alt > CRUISE_FLOOR * 1.2 && !this.cruiseLocked) this.cruise = !this.cruise
    // Wings need air: cruise takes over above it, and under half the jet's minimum they fold back to hover.
    if (this.cruise || rhoNow < JET_MIN_AIR * 0.5) this.jet = false
    this.hold = holdAt(alt)
    this.frameVelAt(this.rel, this.frameVel)
    this.vRel.copy(this.hvel).sub(this.frameVel)

    // Landing assist, before attitude and thrust read the controls.
    this.assisting = false
    if (this.assist && !this.cruise && !this.jet && alt < 500 && THRUST_ACCEL > this.terrain.g * 1.1) {
      c = this.assistLanding(c, alt, rhoNow)
      // The assist cannot burn what is not there.
      if (dry && (c.thrust || c.boost)) c = { ...c, thrust: 0, boost: 0 }
    }

    // Attitude. Torque in body frame, exponential damping, first-order quaternion update.
    // Near the ground the attitude holds against the ground, which turns under an
    // inertial craft at 9° a minute on a 40-minute day; by twice CRUISE_FLOOR it holds
    // against the stars. Rotation, not force: blending it is harmless.
    // Loaded, the ship turns as it climbs: slower by its mass.
    const mass = this.massFactor()
    if (this.jet) {
      // The jet's stick: each axis chases stick × cap (see config); with the roll stick centred
      // and the ship upright, the wings level themselves slowly, so inverted flight still holds.
      const k = 1 - Math.exp(-JET_RESPONSE * h)
      let rollWant = -c.roll * JET_ROLL_RATE
      if (Math.abs(c.roll) < 0.05) {
        this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
        this.bodyRight.set(1, 0, 0).applyQuaternion(this.hquat)
        if (this.bodyUp.dot(this.up) > 0) {
          const bank = Math.asin(Math.max(-1, Math.min(1, this.bodyRight.dot(this.up))))
          if (Math.abs(bank) > JET_LEVEL_DEAD) rollWant = -bank / JET_LEVEL_TAU
        }
      }
      this.angVel.x += (-c.pitch * JET_PITCH_RATE - this.angVel.x) * k
      this.angVel.z += (rollWant - this.angVel.z) * k
      this.angVel.y += (-c.yaw * JET_YAW_RATE - this.angVel.y) * k
    } else {
      this.angVel.x -= (c.pitch * ANG_ACCEL * h) / mass
      this.angVel.z -= (c.roll * ANG_ACCEL * h) / mass
      this.angVel.y -= (c.yaw * ANG_ACCEL * 0.6 * h) / mass
      this.angVel.multiplyScalar(Math.exp(-ANG_DAMP * h))
    }
    this.dq.set(this.angVel.x * h * 0.5, this.angVel.y * h * 0.5, this.angVel.z * h * 0.5, 1).normalize()
    this.hquat.multiply(this.dq).normalize()
    const wh = this.omega.length()
    if (this.hold > 0 && wh > 0) {
      this.dq.setFromAxisAngle(this.tmp.copy(this.omega).divideScalar(wh), this.hold * wh * h)
      this.hquat.premultiply(this.dq).normalize()
    }
    if (this.jet) {
      // The coordinated turn: a bank turns the nose about local up at g·tan(bank)/v, the rate
      // a real wing's tilted lift would give, so you roll and it turns; roll level and it stops.
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      this.bodyRight.set(1, 0, 0).applyQuaternion(this.hquat)
      const cosBank = Math.max(0.2, this.bodyUp.dot(this.up))
      const tanBank = Math.max(-JET_BANK_MAX_TAN, Math.min(JET_BANK_MAX_TAN, this.bodyRight.dot(this.up) / cosBank))
      const vFwd = Math.max(30, this.vRel.dot(this.nose.copy(BODY_FWD).applyQuaternion(this.hquat)))
      const turn = (gravityAt(r, this.terrain) * tanBank) / vFwd
      if (Math.abs(turn) > 1e-6) { this.dq.setFromAxisAngle(this.up, turn * h); this.hquat.premultiply(this.dq).normalize() }
    }

    const boostMult = this.jet ? JET_BOOST_MULT : BOOST_MULT
    const mainThrust = (THRUST_ACCEL * c.thrust * (1 + c.boost * (boostMult - 1))) / mass
    const cap = this.cap()
    // What this substep costs. Boost multiplies burn the way it multiplies thrust; the
    // cruise brake burns like the cruise engine; the RCS sips.
    const noseDrive = this.cruise || this.jet
    this.burn = c.thrust * (noseDrive ? FUEL_CRUISE_BURN : FUEL_HOVER_BURN) * (1 + c.boost * (boostMult - 1))
      + (noseDrive && c.vertical < 0 ? FUEL_CRUISE_BURN * CRUISE_BRAKE : 0)
      + FUEL_RCS_BURN * (Math.abs(c.lateral) + (noseDrive ? 0 : Math.abs(c.vertical)) + Math.abs(c.fore))
    this.fuel = Math.max(0, this.fuel - this.burn * h)
    if (this.cruise) {
      // Cruise: the engine fires along the nose, spooled so full thrust reaches whatever
      // the cap is in about CRUISE_SPOOL seconds, and / is a brake on the same scale.
      this.nose.copy(BODY_FWD).applyQuaternion(this.hquat)
      const gain = Math.max(1, cap / (THRUST_ACCEL * CRUISE_SPOOL))
      if (c.thrust > 0) this.acc.addScaledVector(this.nose, mainThrust * gain)
      // The brake takes speed off along the nose and stops at zero: held down at 60 km it
      // used to push you backwards without limit, and the cap only clamps forward
      // (the re-entry harness, 2026-09-03, found the craft at 5 × 10¹⁸ m).
      if (c.vertical < 0) {
        const vPar = this.vRel.dot(this.nose)
        if (vPar > 0) this.acc.addScaledVector(this.nose, -Math.min(THRUST_ACCEL * CRUISE_BRAKE * gain, vPar / h))
      }
    } else if (this.jet) {
      // Jet: the engine along the nose; the wings cancel gravity along body-up while the
      // speed gives them the lift (auto-trim, capped at JET_LIFT_MAX_G); / is a brake on
      // the nose. Under the stall speed the lift falls short and the ship sinks.
      this.nose.copy(BODY_FWD).applyQuaternion(this.hquat)
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      if (c.thrust > 0) this.acc.addScaledVector(this.nose, mainThrust)
      const vFwd = Math.max(0, this.vRel.dot(this.nose))
      const g = gravityAt(r, this.terrain)
      // Signed: upright the wing pushes toward the canopy, inverted toward the belly (a wing
      // at negative alpha), so inverted flight holds too. The cargo rides on the wings: lift
      // per unit mass falls with the mass factor, so a full ship stalls 15% faster.
      const need = g * this.bodyUp.dot(this.up)
      const can = Math.min((JET_LIFT * rhoNow * vFwd * vFwd) / mass, JET_LIFT_MAX_G * g)
      this.acc.addScaledVector(this.bodyUp, Math.max(-can, Math.min(can, need)))
      // Pulling costs speed: induced drag along the flight path with the pitch stick.
      if (c.pitch !== 0 && vFwd > 1) this.acc.addScaledVector(this.nose, -JET_INDUCED * Math.abs(c.pitch))
      if (c.vertical < 0) {
        const vPar = this.vRel.dot(this.nose)
        if (vPar > 0) this.acc.addScaledVector(this.nose, -Math.min(THRUST_ACCEL * CRUISE_BRAKE, vPar / h))
      }
    } else if (c.thrust > 0) {
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      this.acc.addScaledVector(this.bodyUp, mainThrust)
    }
    // RCS: small pushes along the body axes. Translation without tilting. In cruise the
    // top thruster is the brake instead, handled above.
    if (c.lateral || (c.vertical && !noseDrive) || c.fore) {
      this.rcs.set(c.lateral, noseDrive ? 0 : c.vertical, -c.fore).multiplyScalar(RCS_ACCEL / mass).applyQuaternion(this.hquat)
      this.acc.add(this.rcs)
      // The dive: / in hover, off the pad, pushes down toward the ground; the assist's floor still holds.
      if (!noseDrive && c.vertical < 0 && this.state === 'flying') this.acc.addScaledVector(this.up, (-DIVE_ACCEL * -c.vertical) / mass)
    }
    // Ground effect. A cushion in the last few metres, plus damping against
    // descent, both fading to nothing at GROUND_EFFECT_HEIGHT. It is the ground
    // answering back, and it is what makes the last part of a landing readable.
    const feet = alt - HULL_CLEARANCE
    if (feet < GROUND_EFFECT_HEIGHT && !this.jet) {
      const k = 1 - Math.max(0, feet) / GROUND_EFFECT_HEIGHT
      this.acc.addScaledVector(this.up, GROUND_EFFECT_ACCEL_G * this.terrain.g * k)
      const vUp = this.vRel.dot(this.up)
      if (vUp < 0) this.acc.addScaledVector(this.up, -vUp * GROUND_EFFECT_DAMP * k)
    }
    // Drag, against the air, which rides the body and carries the wind.
    if (rhoNow > 0) {
      if (this.windy) wind(this.localDir, this.terrain, this.time, this.wind); else this.wind.set(0, 0, 0)
      this.tmp.copy(this.wind).applyQuaternion(this.spin)
      this.tmp.subVectors(this.vRel, this.tmp)
      const speed = this.tmp.length()
      if (speed > 0) this.acc.addScaledVector(this.tmp, (-(this.jet ? JET_DRAG : DRAG) * rhoNow * speed * (1 + POD_DRAG * this.cargo.length)) / mass)
      this.heat(rhoNow, speed, h)
    } else { this.wind.set(0, 0, 0); this.heat(0, 0, h) }
    if (this.damage >= 1) { this.burnUp(); return }

    this.stepBolts(h)
    this.hvel.addScaledVector(this.acc, h)
    if (this.jet) {
      // Where you point is where you go: velocity across the nose bleeds away, on the velocity relative to the body.
      this.vRel.copy(this.hvel).sub(this.frameVel)
      const vPar = this.vRel.dot(this.nose)
      // The grip is the wing's: full above the stall speed and falling with the square of the
      // lift ratio under it (a quarter of the lift is a sixteenth of the grip), so near the stall
      // the ship mushes and well under it, it drops instead of being steered by wings with no air.
      const ratio = Math.min(1, (JET_LIFT * rhoNow * vPar * vPar) / (gravityAt(r, this.terrain) * this.massFactor()))
      const grip = ratio * ratio
      const bleed = 1 - Math.exp((-h * grip) / JET_ALIGN_TAU)
      this.vRel.addScaledVector(this.nose, -vPar).multiplyScalar(1 - bleed).addScaledVector(this.nose, vPar)
      this.hvel.copy(this.frameVel).add(this.vRel)
    }
    if (this.cruise) {
      // Flight assist: velocity across the nose bleeds away, so where you point is where
      // you go; and above the cap the assist eases you back. Not physics. Very playable.
      // All of it on the velocity relative to the body you are near, never on the orbit.
      this.vRel.copy(this.hvel).sub(this.frameVel)
      const vPar = this.vRel.dot(this.nose)
      const bleed = 1 - Math.exp(-h / CRUISE_ALIGN_TAU)
      this.vRel.addScaledVector(this.nose, -vPar).multiplyScalar(1 - bleed).addScaledVector(this.nose, vPar)
      // The cap is a hard clamp on speed along the nose. Thrust grows with the cap and
      // would otherwise out-muscle any gentle reel-in on a dive.
      if (vPar > cap) this.vRel.addScaledVector(this.nose, cap - vPar)
      this.hvel.copy(this.frameVel).add(this.vRel)
    }
    this.hpos.addScaledVector(this.hvel, h)
    this.time += h
    this.frameAt(this.time)

    // Contact, against the reference body's ground where it is now.
    this.rel.copy(this.hpos).sub(this.bPos)
    const r2 = this.rel.length()
    this.up.copy(this.rel).divideScalar(r2)
    this.localDir.copy(this.up).applyQuaternion(this.spinInv)
    const ground = groundRadius(this.localDir, this.terrain)
    if (r2 - ground < HULL_CLEARANCE) {
      this.hold = 1
      this.frameVelAt(this.rel, this.frameVel)
      this.vRel.copy(this.hvel).sub(this.frameVel)
      const vUp = this.vRel.dot(this.up)
      const vH = Math.sqrt(Math.max(0, this.vRel.lengthSq() - vUp * vUp))
      this.bodyUp.copy(BODY_UP).applyQuaternion(this.hquat)
      const tilt = (Math.acos(Math.min(1, Math.max(-1, this.bodyUp.dot(this.up)))) * 180) / Math.PI
      const slope = slopeDeg(this.localDir, this.terrain)
      this.lastContact = { vUp, vH, tilt, slope }
      this.contactVel.copy(this.vRel).applyQuaternion(this.spinInv)
      this.hpos.copy(this.bPos).addScaledVector(this.up, ground + HULL_CLEARANCE)
      this.angVel.set(0, 0, 0)
      this.syncLocal()
      this.vel.set(0, 0, 0)
      // Contact damage (DESIGN §10): none inside the limits; over them it adds to the hull's.
      // Short of a whole hull it is a hard landing, gear bent; at a whole hull, or any hard
      // contact with water, it is a wreck.
      // A jet landing on a runway (DESIGN §10l-2): inside the strip, within RUNWAY_HEADING_DEG of
      // its heading, sinking under the limit and near level, the speed along the strip is kept
      // and the ship rolls out on its wheels instead of failing the drift limit.
      const rw = this.jet ? onRunway(this.localDir, this.terrain) : null
      if (rw && vUp > -LAND_MAX_VSPEED && tilt < LAND_MAX_TILT) {
        this.nose.copy(BODY_FWD).applyQuaternion(this.hquat).applyQuaternion(this.spinInv)
        const alongCos = Math.abs(this.nose.x * rw.site.along!.x + this.nose.y * rw.site.along!.y + this.nose.z * rw.site.along!.z)
        if (alongCos > Math.cos((RUNWAY_HEADING_DEG * Math.PI) / 180)) {
          this.jet = false
          this.lastContact = { vUp, vH, tilt, slope }
          this.contactVel.copy(this.vRel).applyQuaternion(this.spinInv)
          this.syncLocal()
          this.up.copy(this.pos).normalize()
          this.pos.copy(this.up).multiplyScalar(ground + HULL_CLEARANCE)
          this.vel.copy(this.contactVel).addScaledVector(this.up, -this.contactVel.dot(this.up))
          this.angVel.set(0, 0, 0)
          this.state = 'rolling'
          this.alignTo(surfaceNormal(this.up, this.terrain, this.n), this.vel)
          this.rest()
          this.syncHelio()
          return
        }
      }
      this.jet = false   // wings fold on the ground, landed or wrecked
      const dmg = Craft.contactDamage(vUp, vH, tilt, slope)
      const dry = isDry(this.localDir, this.terrain)
      if (dmg > 0) this.damage = Math.min(1, this.damage + dmg)
      if (dmg === 0 || (this.damage < 1 && dry)) {
        this.state = 'landed'
        this.landings++
        if (dmg > 0) this.gearBent = true
        this.alignTo(surfaceNormal(this.localDir, this.terrain, this.n))
      } else {
        this.state = 'crashed'
        this.sunk = !dry
        this.damage = 1
        this.crashes++
      }
      this.rest()
      this.syncHelio()
      return
    }
    this.syncLocal()
    this.pickRef()
  }

  /**
   * The gun. A bolt leaves the wing nozzle (alternating sides) at BOLT_SPEED along the
   * nose, on top of the ship's own velocity, and dies GUN_RANGE later. One per
   * GUN_COOLDOWN. What it hits is decided in substep as it flies. Returns the bolt, or
   * null if the gun was not ready.
   */
  fire(): Bolt | null {
    // The cannons are out only in cruise (the TIE): nothing fires in hover.
    if (this.state !== 'flying' || !this.cruise || this.time < this.gunReady) return null
    this.gunReady = this.time + GUN_COOLDOWN
    let b = this.bolts.find((x) => !x.alive)
    if (!b) {
      if (this.bolts.length >= BOLT_POOL) return null
      b = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), dir: new THREE.Vector3(), dies: 0, alive: false, side: 1 }
      this.bolts.push(b)
    }
    this.nose.copy(BODY_FWD).applyQuaternion(this.hquat)
    // From the cannon muzzles under the wings, alternate sides.
    this.gunSide = -this.gunSide
    this.tmp.set(GUN_MUZZLE.x * this.gunSide, GUN_MUZZLE.y, GUN_MUZZLE.z).applyQuaternion(this.hquat)
    b.pos.copy(this.hpos).add(this.tmp)
    b.dir.copy(this.nose)
    b.vel.copy(this.hvel).addScaledVector(this.nose, BOLT_SPEED)
    b.dies = this.time + GUN_RANGE / BOLT_SPEED
    b.alive = true
    b.side = this.gunSide
    return b
  }

  /** Fly every live bolt one step; a rock along the way loses a hit, and breaks at zero. */
  private stepBolts(h: number): void {
    for (const b of this.bolts) {
      if (!b.alive) continue
      if (this.time >= b.dies) { b.alive = false; continue }
      // The bolt's path this step, in each field's frame.
      const hit = sweep(b.pos, b.vel, h, this.time)
      if (hit) {
        b.alive = false
        hit.rock.hp--
        let broke = false, fuel = 0
        if (hit.rock.hp <= 0) {
          broke = true
          const reach = rockPosition(hit.rock, this.time, this.tmp).distanceTo(this.hpos)
          if (reach <= ICE_REACH) { fuel = Math.min(fuelYield(hit.rock), FUEL_TANK - this.fuel); this.fuel += fuel }
          breakRock(hit.rock)
        }
        this.hits.push({ hit, broke, fuel })
        continue
      }
      b.pos.addScaledVector(b.vel, h)
    }
  }

  /** The landing assist's controls: the floor on descent speed, and the hands-off landing. `alt` is the hull centre's altitude, `rho` the air here (passed in: atmosphere() calls altitude(), which writes the substep's `up`). */
  private assistLanding(c: Controls, alt: number, rho: number): Controls {
    const feet = Math.max(0, alt - HULL_CLEARANCE)
    const vUp = this.vRel.dot(this.up)
    // The floor on descent: 2 + 0.11·feet until 2026-09-05; with 2.85 g of thrust the ship stops from 19 m/s in ten metres, so steeper (Chris: "it needs to be more arcady").
    const vSafe = 3 + 0.16 * feet
    const handsOff = !c.thrust && !c.boost && !c.pitch && !c.roll && !c.yaw && !c.vertical && !c.lateral && !c.fore
    const level = (lean: number, intoWind = 1) => {
      // Body-up toward local up, leaned against horizontal drift, and into the wind by what
      // the wind's drag needs (drag over g is the tangent of the lean that holds station):
      // a P term on drift alone settles downwind at several m/s in a stiff breeze and the
      // touch is over LAND_MAX_HSPEED. `intoWind` fades that so the touch is nearly upright.
      this.tmp.copy(this.vRel).addScaledVector(this.up, -vUp)
      const vH = this.tmp.length()
      this.fwd.copy(this.up)
      const w = this.wind.length()
      if (w > 0.5 && intoWind > 0) {
        this.windH.copy(this.wind).applyQuaternion(this.spin)
        this.windH.addScaledVector(this.up, -this.windH.dot(this.up))
        const wh = this.windH.length()
        if (wh > 0.5) this.fwd.addScaledVector(this.windH.divideScalar(wh), -Math.min(0.35, (DRAG * rho * wh * wh) / this.terrain.g) * intoWind)
      }
      if (vH > 0.5 && lean > 0) this.fwd.addScaledVector(this.tmp.divideScalar(vH), -Math.min(0.6, vH * lean))
      this.fwd.normalize()
      this.n.copy(this.fwd).applyQuaternion(this.spinInv) // local frame, which aimControls wants
      return { a: this.aimControls(this.n, 4), vH }
    }
    if (vUp < -vSafe) {
      // Falling faster than this height allows: level up and burn. The floor, whatever your hands are doing.
      const { a } = level(0.02)
      this.assisting = true
      return { ...c, pitch: a.pitch, roll: a.roll, yaw: 0, thrust: 1, boost: vUp < -1.6 * vSafe ? 1 : 0 }
    }
    // Tilt from the heliocentric frame we are in: tilt() would overwrite `up`, the substep's scratch.
    const cosTilt = this.n.copy(BODY_UP).applyQuaternion(this.hquat).dot(this.up)
    if (feet >= 60 || vUp >= 0.5) this.assistLatch = false
    if (feet < 60 && vUp < 0.5 && (cosTilt < 0.9945 || this.assistLatch)) {
      this.assistLatch = true
      // Low, sinking and leaned over, whatever your hands are doing: level, kill the drift
      // while holding height, then come down on the profile. The lean against drift fades
      // out over the last 25 m so the touch is upright. Full pitch into the ground was
      // arriving at 2 m/s and 41° and crashing on the tilt.
      const { a, vH } = level(0.02 * Math.min(1, feet / 25), 0.7 + 0.3 * Math.min(1, feet / 10))
      this.assisting = true
      const thrust = (vH > 3 && vUp < 0) || vUp < -(1.2 + 0.07 * feet) ? 1 : c.thrust
      return { ...c, pitch: a.pitch, roll: a.roll, yaw: 0, thrust }
    }
    if (handsOff && feet < 400 && vUp < 0.5) {
      // Hands off and sinking: fly it down. Come down at a fraction of the floor, kill the drift, touch gently.
      const { a, vH } = level(0.03 * Math.min(1, feet / 25 + 0.2), 0.7 + 0.3 * Math.min(1, feet / 10))
      this.assisting = true
      const wantDown = -(2 + 0.14 * feet)
      const thrust = vUp < wantDown || (vH > 2.5 && vUp < 0) ? 1 : 0
      return { ...c, pitch: a.pitch, roll: a.roll, yaw: 0, thrust }
    }
    return c
  }

  /** The hull temperature this air and speed settle to. Public and pure, so the harness can hold its shape. */
  static heatTarget(rho: number, speed: number): number {
    if (rho <= 0 || speed <= 0) return 0
    const ramp = 1 - (1 - HEAT_RAMP_MIN) * Math.min(1, Math.max(0, (rho - HEAT_RAMP_LO) / (HEAT_RAMP_HI - HEAT_RAMP_LO)))
    return HEAT_K * Math.sqrt(rho) * speed * speed * speed * ramp
  }

  /** Move the hull toward its target; damage over the limit. */
  private heat(rho: number, speed: number, h: number): void {
    const target = Craft.heatTarget(rho, speed)
    if (target > this.hull) this.hull += (target - this.hull) * (1 - Math.exp(-h / HEAT_TAU))
    else this.hull = Math.max(target, this.hull - Math.max(COOL_RATE * (this.hull - target), COOL_MIN) * h)
    const over = this.hull / HULL_LIMIT
    if (over > 1) this.damage = Math.min(1, this.damage + ((over * over - 1) / DAMAGE_TAU) * h)
  }

  /** The hull is gone: a crash where you are, flagged as a burn. */
  private burnUp(): void {
    this.frameVelAt(this.rel, this.frameVel)
    this.vRel.copy(this.hvel).sub(this.frameVel)
    this.lastContact = { vUp: -this.vRel.length(), vH: 0, tilt: 0, slope: 0 }
    this.hvel.copy(this.frameVel)
    this.angVel.set(0, 0, 0)
    this.syncLocal()
    this.vel.set(0, 0, 0)
    this.state = 'crashed'
    this.burned = true
    this.damage = 1
    this.crashes++
    this.rest()
    this.syncHelio()
  }

  /** Wreckage against a rock: stop where you are in the reference frame, record the contact, count it. */
  private crashOn(r: Rock, at: THREE.Vector3): void {
    this.frameVelAt(this.rel, this.frameVel)
    this.vRel.copy(this.hvel).sub(this.frameVel)
    const speed = this.vRel.length()
    this.tmp.copy(this.hpos).sub(at).normalize()
    // Sit on the rock's surface, so the wreck is on the rock and not in it.
    this.hpos.copy(at).addScaledVector(this.tmp, r.radius + HULL_CLEARANCE)
    this.lastContact = { vUp: -speed, vH: 0, tilt: 0, slope: 0 }
    this.hvel.copy(this.frameVel)
    this.angVel.set(0, 0, 0)
    this.syncLocal()
    this.vel.set(0, 0, 0)
    this.state = 'crashed'
    this.damage = 1
    this.crashes++
    this.rest()
    this.syncHelio()
  }

  // ---- Frames ----

  /** The reference body's centre, velocity, spin and angular velocity at time t. */
  private frameAt(t: number): void {
    bodyPosition(this.ref, t, this.bPos)
    bodyVelocity(this.ref, t, this.bVel)
    bodySpin(this.ref, t, this.spin)
    this.spinInv.copy(this.spin).invert()
    const w = this.ref.spinPeriod > 0 ? TWO_PI / this.ref.spinPeriod : 0
    this.omega.copy(this.ref.spinAxis).multiplyScalar(w)
  }

  /** Velocity of the local frame at inertial offset `rel` from the body: orbit plus `hold` of the spin. */
  private frameVelAt(rel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.omega).cross(rel).multiplyScalar(this.hold).add(this.bVel)
    if (this.fieldWeight > 0) out.addScaledVector(this.fieldVel, this.fieldWeight)
    return out
  }

  /** Local view from the heliocentric truth, using the frame last computed by frameAt. */
  private syncLocal(): void {
    this.rel.copy(this.hpos).sub(this.bPos)
    this.pos.copy(this.rel).applyQuaternion(this.spinInv)
    this.frameVelAt(this.rel, this.frameVel)
    this.vel.copy(this.hvel).sub(this.frameVel).applyQuaternion(this.spinInv)
    this.quat.copy(this.spinInv).multiply(this.hquat)
  }

  /** Heliocentric truth from the local view, using the frame last computed by frameAt. */
  private syncHelio(): void {
    this.rel.copy(this.pos).applyQuaternion(this.spin)
    this.hpos.copy(this.bPos).add(this.rel)
    this.frameVelAt(this.rel, this.frameVel)
    this.hvel.copy(this.vel).applyQuaternion(this.spin).add(this.frameVel)
    this.hquat.copy(this.spin).multiply(this.quat)
  }

  /**
   * On the runway: the ship slows on its wheels at ROLL_DECEL, harder with / held, steers a
   * little on Q/E, stays on the ground, and stops to 'landed'. Thrust takes it flying again
   * (a touch-and-go). Running off the paving above the drift limit is a wreck.
   */
  private rollStep(h: number, c: Controls): void {
    this.burn = 0
    this.stepBolts(h)
    this.heat(0, 0, h)
    if (c.thrust > 0 || c.vertical > 0) {
      this.state = 'flying'
      this.frameAt(this.time)
      this.syncHelio()
      return
    }
    const speed = this.vel.length()
    const dv = Math.min(speed, (ROLL_DECEL + (c.vertical < 0 ? ROLL_BRAKE : 0)) * h)
    if (speed > 1e-6) this.vel.multiplyScalar((speed - dv) / speed)
    this.up.copy(this.pos).normalize()
    if (c.yaw && speed > 1) { this.dq.setFromAxisAngle(this.up, -c.yaw * ROLL_STEER * h); this.vel.applyQuaternion(this.dq) }
    this.pos.addScaledVector(this.vel, h)
    this.up.copy(this.pos).normalize()
    this.pos.copy(this.up).multiplyScalar(groundRadius(this.up, this.terrain) + HULL_CLEARANCE)
    this.vel.addScaledVector(this.up, -this.vel.dot(this.up))
    if (this.vel.lengthSq() > 0.01) this.alignTo(surfaceNormal(this.up, this.terrain, this.n), this.vel)
    const left = speed - dv
    if (!onRunway(this.up, this.terrain) && left > LAND_MAX_HSPEED) {
      // Off the paving at speed: a wreck, on the same terms as any hard contact.
      this.lastContact = { vUp: 0, vH: left, tilt: 0, slope: 0 }
      this.contactVel.copy(this.vel)
      this.vel.set(0, 0, 0)
      this.state = 'crashed'
      this.damage = 1
      this.crashes++
      this.rest()
    } else if (left < 0.5) {
      this.vel.set(0, 0, 0)
      this.state = 'landed'
      this.landings++
      this.rest()
    }
    this.time += h
    this.frameAt(this.time)
    this.syncHelio()
  }

  private rest(): void { this.restPos.copy(this.pos); this.restQuat.copy(this.quat) }

  private setRef(b: Body): void {
    if (b === this.ref) return
    this.ref = b
    this.terrain = terrainOf(b)
    this.refChanged = true
  }

  /**
   * The deepest body whose sphere of influence holds the craft; the sun otherwise.
   * A little hysteresis on the boundary so the frame never flickers.
   */
  private pickRef(): void {
    let best: Body | null = null
    for (const b of SYSTEM) {
      if (!b.parent) continue
      const d = bodyPosition(b, this.time, this.tmp).distanceTo(this.hpos)
      if (d < b.hill * (b === this.ref ? 1.05 : 0.95) && (!best || b.hill < best.hill)) best = b
    }
    best ??= body('sun')
    if (best !== this.ref) {
      this.setRef(best)
      this.frameAt(this.time)
      this.syncLocal()
    }
  }

  /** Rotate the LOCAL orientation so body-up matches `up`, keeping the current heading (or taking `heading`). */
  private alignTo(up: THREE.Vector3, heading?: THREE.Vector3): void {
    if (heading) this.fwd.copy(heading)
    else this.fwd.copy(BODY_FWD).applyQuaternion(this.quat)
    this.fwd.addScaledVector(up, -this.fwd.dot(up))
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(1, 0, 0).addScaledVector(up, -up.x)
    this.fwd.normalize()
    // Matrix4.lookAt puts -Z toward the target, which is exactly body-forward.
    this.m.lookAt(new THREE.Vector3(), this.fwd, up)
    this.quat.setFromRotationMatrix(this.m)
  }
}
