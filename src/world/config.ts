// Every number that is a dial rather than an architectural choice lives here.
// See DESIGN.md §4 for why the planets start small.

/**
 * Metres. Earth at 1:159 (Chris, 2026-09-02: "20x bigger"). Every other body in
 * system.ts is its real-solar-system analogue at the same scale.
 */
export const PLANET_RADIUS = 40_000

/**
 * Metres, roughly peak-to-datum. To scale Everest would be 56 m; this is the one
 * exaggeration besides the atmosphere, because Lander had hills and so do we.
 */
export const TERRAIN_AMPLITUDE = 200

/**
 * The universe is a fixed function of this. Once anything is authored against it
 * (easter eggs, missions) it does not move: bump SEED_VERSION and treat the old
 * universe as gone rather than editing this silently.
 */
export const MASTER_SEED = 0x4e4f454c // "NOEL"
export const SEED_VERSION = 3 // 2: the 1:159 rescale; 3: continuous noise kernel (2026-09-02)

// ---- Flight. Gameplay numbers, not physics. Tune by flying, then by harness. ----

/** m/s² at the surface. Earth's. Falls off with (R/r)² so orbit is weightless. */
export const GRAVITY = 9.81
/**
 * Metres. Drag fades to nothing here; above it the craft coasts. The one thing that
 * cannot be to scale: real air depth is set by temperature and g, not radius, and
 * scaled it would be 30 m. This is about 3x the Kármán line at 1:159.
 */
export const ATMOSPHERE_HEIGHT = 2000
/**
 * Quadratic drag per metre at sea level. Terminal velocity ≈ √(g/DRAG) ≈ 50 m/s, which is a
 * vehicle rather than a feather (0.012 gave 29 m/s, a 53 s climb out of the air, and would
 * have made a 30 m/s wind shove the craft at 11 m/s²; weather made it show, 2026-09-02).
 */
export const DRAG = 0.002
/**
 * m/s² along the craft's own up-axis. Thrust-to-weight ≈ 2.85 at Earth g. Was 18 (1.83) until
 * 2026-09-05, Chris: "this is not flight simulator, it needs to be more arcady ... hovering
 * seems to be the slowest ... we can speed up take off too". With DRAG halved, hover at a
 * 0.85 rad lean tops out near 100 m/s (was 45), a full-thrust climb is 2.2 times quicker,
 * and a 30 m/s wind shoves at a third of what it did. The world's distances are unchanged.
 */
export const THRUST_ACCEL = 28
/** rad/s² from full stick, and the 1/s damping that stops it when you let go. */
export const ANG_ACCEL = 6
export const ANG_DAMP = 4
/** Metres from the craft's centre to its feet. */
export const HULL_CLEARANCE = 1.6
/** What counts as a landing rather than an arrival. */
export const LAND_MAX_VSPEED = 4
export const LAND_MAX_HSPEED = 3
export const LAND_MAX_TILT = 15
export const LAND_MAX_SLOPE = 15
/**
 * Crashes (DESIGN §10). Contact damage is the square of how far the touchdown speed is over
 * the landing limit (vertical or drift, whichever is worse), less one, times this scale; a
 * breach of tilt or slope alone costs CRASH_MIN_DAMAGE. The damage adds to the hull's, so a
 * heat-scarred ship wrecks on a landing a fresh one would walk away from. At 1 the hull
 * comes apart. 6 m/s down is a third of the hull; 9 m/s is the wreck.
 */
export const CRASH_DAMAGE_SCALE = 0.25
export const CRASH_MIN_DAMAGE = 0.1
/** Seconds the camera holds on a wreck before the respawn. */
export const WRECK_HOLD = 6
/** Physics runs at this fixed step so an input tape replays bit for bit. */
export const FIXED_DT = 1 / 120

// ---- Landing feel and boost (from the first flight, 2026-09-01). ----

/** Shift. Thrust multiplier; drag caps it low down, nothing caps it high up. */
export const BOOST_MULT = 2.6
/**
 * Ground effect: the last few metres push back, and harder the faster you fall into them.
 * The push is a fraction of the local surface gravity: a fixed 2.5 m/s² out-pushed the
 * Moon's 1.62 and the craft floated two metres up forever (verify-flight, 2026-09-02).
 */
export const GROUND_EFFECT_HEIGHT = 6
export const GROUND_EFFECT_ACCEL_G = 0.25
export const GROUND_EFFECT_DAMP = 1.2

// ---- Sky and space (from the second flight, 2026-09-01). ----

/**
 * Seconds per full day. Not gravitational, so a gameplay number: 40 minutes puts the
 * equator at 105 m/s, a sixth of orbital speed (Earth's is a seventeenth).
 */
export const DAY_LENGTH = 2400
/** Readouts only since Stage C (the integrator sums real μ/r² from every body): orbital and escape speed use (R/r)^GRAVITY_FALLOFF. */
export const GRAVITY_FALLOFF = 2

/** Reaction-control thrusters: side, top and rear. m/s², body frame, no boost. Enough to stop, not to go. */
export const RCS_ACCEL = 3.5
/** In hover, / pushes down this hard on top of the RCS: a dive from height, with the assist's floor still under you. Chris, 2026-09-04: "takes ages to get to the ground". */
export const DIVE_ACCEL = 14

// ---- Cruise: how the ship flies once the air runs out (from the third flight, 2026-09-01). ----

/** Density below which the ship switches to cruise, and above which it switches back. Hysteresis. */
export const CRUISE_ENTER = 0.02
export const CRUISE_EXIT = 0.1
/**
 * Metres above the reference body's ground below which you are always in hover, air or
 * not: an airless moon still gets a Zarch landing. Cruise re-engages 20% above it.
 */
export const CRUISE_FLOOR = 2500
/** Seconds for velocity across the nose to bleed away: turn, and your speed comes with you. */
export const CRUISE_ALIGN_TAU = 1.2
/**
 * m/s, the cruise cap right next to a rock (or any surface without a hover floor). Near
 * a surface the cap is the speed you could brake from before reaching it,
 * √(CRUISE_MAX² + 2·CRUISE_DECEL·d); far from anything it is d / CRUISE_SECONDS, so at
 * full speed you are never more than a few seconds from the nearest thing and the same
 * rule reels you in on arrival. Elite Dangerous's supercruise, which is the one that has
 * been played for a decade. With a target ahead the rule keys off the target too. The cap
 * is a hard clamp.
 */
export const CRUISE_MAX = 150
/**
 * m/s at the hover floor over a body: the speed cruise hands you to hover at. The body
 * cap is √(CRUISE_FLOOR_SPEED² + 2·CRUISE_DECEL·(d − CRUISE_FLOOR)), referenced to the
 * floor and not the ground, because the hand-off happens at the floor and hover has
 * 18 m/s² to work with. Chris, 2026-09-03, on the moon: "the craft went in at the wrong
 * angle ... was a hassle not fun". Before this the moon handed you over at 1,600 m/s.
 */
export const CRUISE_FLOOR_SPEED = 60
/** m/s², the near-body deceleration profile. Takes over from the linear rule inside ~50 km. */
export const CRUISE_DECEL = 500
/** Seconds. Far-field cap = distance to the nearest surface / this. 7 is the ED "0:06" feel. */
export const CRUISE_SECONDS = 7
/** Seconds of full thrust to reach the cap, whatever the cap is. Engine never the limit. */
export const CRUISE_SPOOL = 4
/** Brake (the / key in cruise) as a fraction of main thrust. */
export const CRUISE_BRAKE = 0.8

/**
 * Jet mode (Chris, 2026-09-05: "the ability to fly like a mig or fighter jet rather than
 * hover over land, be great fun flying around the mountains ... hover is still best way to
 * land but we need a different mode ... that mode will only work in planets with
 * atmospheres"). J flicks it in air. The engine fires along the nose, the wings give lift
 * that cancels gravity while there is speed for it (auto-trim: no stick to hold), velocity
 * follows the nose, a bank turns you (a coordinated turn from the bank angle), / is a
 * brake, and below the stall speed the wings cannot hold you up and you sink. Everything
 * scales with the air, so thin air stalls faster and no air is no wings.
 */
/** Streamlined drag per metre at sea level: top speed √(THRUST/JET_DRAG) ≈ 237 m/s, 380 with boost. */
export const JET_DRAG = 0.0005
/** Lift per (m/s)² per unit air, per unit mass: the wings hold a g at √(g/JET_LIFT) ≈ 60 m/s in sea-level air, the stall speed. */
export const JET_LIFT = 0.0027
/** The most the wings pull, in g, signed: inverted they push toward the belly, so inverted flight holds. */
export const JET_LIFT_MAX_G = 4
/** Seconds for velocity across the nose to bleed away: where you point is where you go. 0.7 flew 28° nose-high round a loop (research/jet-stunts-2026-09-05.md); 0.2 is 15°. */
export const JET_ALIGN_TAU = 0.2
/** Air below which J does nothing (and the wings fold back to hover under half of it). */
export const JET_MIN_AIR = 0.15
/**
 * The jet's stick (research/jet-stunts-2026-09-05.md, Rocket League's model): each axis chases
 * a target rate of stick × cap, reaching it in about 0.16 s and stopping as fast when the
 * stick centres, with no mass in it, so cargo never slows a roll. Pitch 75°/s is a 4.8 s loop
 * at any speed, roll 240°/s is the F-16 number, yaw 30°/s kicks a hammerhead and no more.
 */
export const JET_PITCH_RATE = 1.31
export const JET_ROLL_RATE = 4.19
export const JET_YAW_RATE = 0.52
export const JET_RESPONSE = 6
/** Wings level themselves with the roll stick centred and the ship upright: seconds, and the dead band in radians. Slow, so a held bank still turns you. */
export const JET_LEVEL_TAU = 2.5
export const JET_LEVEL_DEAD = 0.14
/** m/s² of speed lost along the flight path per unit of pitch stick: pulling costs speed, so the throttle matters in a loop. */
export const JET_INDUCED = 4.5
/** The steepest bank the coordinated turn honours, as tan(bank). */
export const JET_BANK_MAX_TAN = 3
/** The runway rollout: m/s² lost on the wheels, more with / held, rad/s of steer on Q/E, and how far off the strip's heading a touchdown may be. */
export const ROLL_DECEL = 3
export const ROLL_BRAKE = 9
export const ROLL_STEER = 0.35
export const RUNWAY_HEADING_DEG = 15

// ---- Fuel (2026-09-03). The first number that gates reach. ----

/**
 * Tank capacity, units. Everything else is a rate against it. Chris: "we'll need ways to
 * refuel without annoyingly running out of fuel", so the rules are: every pad refills
 * you on touchdown, the ground trickles from sunlight so a dry tank limps home, and
 * the HUD shows endurance and shouts before the tank does.
 */
export const FUEL_TANK = 100
/** Units per second at full hover thrust, no boost. Chris, 2026-09-03, after running dry at the moon: "need fuel to last 4 times as long." 1,600 s of full thrust; hovering at home is 49 minutes. */
export const FUEL_HOVER_BURN = 0.0625
/** Units per second at full cruise throttle. The cap is reached in CRUISE_SPOOL seconds and coasting is free, so a trip is a few seconds of burn. */
export const FUEL_CRUISE_BURN = 0.1
/** Units per second per unit of RCS input. */
export const FUEL_RCS_BURN = 0.005
/** Units per second refilled while landed on a pad. A full tank in 20 s. */
export const FUEL_PAD_REFILL = 5
/** Units per second from the solar cells, only while landed and only off the pad. A dry tank gets 40 s of full thrust after 100 s on the ground. */
export const FUEL_SOLAR_TRICKLE = 0.1
/** Units the engine needs before it will light from the ground. A dry tank waits ten seconds on the sun, a fifth of one on the pad. */
export const FUEL_RELIGHT = 1
/** Metres from a pad's centre that count as on it. The disc is 22 m. */
export const PAD_RADIUS = 20

// ---- Asteroids and the gun (2026-09-03). ----

/** Hits to break a rock: one plus this per metre of radius. A 40 m rock takes two, a 200 m rock six. */
export const ROCK_HP_PER_METRE = 1 / 40
/** Fuel units an ice rock gives per metre of radius, and the most any one rock gives. A 40 m ice rock is a fifth of a tank. */
export const ICE_FUEL_PER_METRE = 0.5

// ---- Money (DESIGN §10e). Credits. Every number here is a first guess for Chris to tune.
/** What you start with, and the loan you start owing (OpenTTD's shape: cash equal to the loan). */
export const START_CASH = 2000
export const START_LOAN = 2000
export const LOAN_MAX = 10_000
export const LOAN_STEP = 500
/** Interest on the loan per game day (DAY_LENGTH), charged continuously. */
export const LOAN_RATE_PER_DAY = 0.02
/** Credits per unit of fuel at a pad; a full tank is FUEL_TANK × this. */
export const FUEL_PRICE = 2
/** Credits to repair a whole hull (damage 1 → 0) at a station. */
export const REPAIR_PRICE = 600
/** The excess on a replacement hull after a wreck. Charged even into the red: a crash never ends the game. */
export const INSURANCE = 500

// ---- Cargo and the dig (DESIGN §10, §10e-2, §10g). Guesses, all of them.
/** Pods the hull carries, tonnes per pod, and the dry ship's tonnes the pods are felt against. */
export const CARGO_PODS = 3
export const POD_TONNES = 4
/** The empty ship. With three 4 t pods the mass factor is 1.33: 13.5 m/s² of thrust against 9.8 of gravity. At 12 t it was 2, thrust 9, and a full ship could not hover (Chris, 2026-09-05: "the weight is keeping the ship too low"). */
export const SHIP_TONNES = 36
/** Drag area grows this much per pod. */
export const POD_DRAG = 0.15
/** Seconds to dig one pod out of a seam, landed inside its radius. */
export const DIG_SECONDS = 3
/** Credits per tonne a town pays at base for each good; a town short of it pays up to 60% more. */
export const GOOD_PRICE = { water: 20, timber: 35, ore: 60, salt: 30, crystal: 480, ice: 45, helium: 220, sulphur: 90 } as const
/** A town takes goods it has no use for at this share of base. */
export const UNWANTED_SHARE = 0.5
/** Seconds of a production cycle: population and building are reckoned per cycle. */
export const CYCLE = 200
export const ICE_FUEL_MAX = 60
/** Metres a bolt flies before it dies, the seconds between shots, and how fast a bolt leaves the gun (relative to the ship). Chris, 2026-09-03: "need to see more a projectile shot." */
export const GUN_RANGE = 3000
export const GUN_COOLDOWN = 0.2
export const BOLT_SPEED = 900
/** Metres from a breaking ice rock within which its fuel reaches you. Beyond that it is lost to space. */
export const ICE_REACH = 3000

// ---- Re-entry: hull heating (2026-09-03). After XRVessels' twenty years of tuning, via the research report. ----

/**
 * Hull heat is an equilibrium temperature the hull rises toward, not an integral: stable
 * at any step. Target = HEAT_K · √ρ · v³ · ramp(ρ). The square root is Sutton-Graves (the
 * real heat flux goes as √ρ, and it is what makes thin air bite on a shallow entry); the
 * ramp is XRVessels' conductive-cooling fraction, which falls to HEAT_RAMP_MIN in thick
 * air so fast flight near the deck warms the hull without cooking it. Degrees over ambient.
 */
export const HEAT_K = 4e-5
export const HEAT_RAMP_LO = 0.07
export const HEAT_RAMP_HI = 0.9
export const HEAT_RAMP_MIN = 0.095
/** Seconds for the hull to rise most of the way to its target. */
export const HEAT_TAU = 2
/** Cooling: this fraction of the excess a second, never slower than COOL_MIN degrees a second. */
export const COOL_RATE = 0.02
export const COOL_MIN = 0.4
/** Degrees over ambient the hull takes; warning and critical as fractions of it; the glow starts at HULL_GLOW. */
export const HULL_LIMIT = 1000
export const HULL_WARN = 0.8
export const HULL_GLOW = 0.39
/** Over the limit, damage accrues at ((T/limit)² − 1) / DAMAGE_TAU a second; at 1 the hull is gone. The expectation of XRVessels' dice. */
export const DAMAGE_TAU = 8
/** Ground-relative m/s above which hover will not engage: you are still re-entering, flip and brake. */
export const HOVER_MAX_SPEED = 250

/** Cloud base as a fraction of the atmosphere's depth. 0.38 of a 2 km air is 760 m: low enough to fly under and look up at. Chris, 2026-09-03: "the clouds being too high and they need rain coming from them." */
export const CLOUD_BASE_FRAC = 0.38

/** Where the bolts leave the ship, body frame, for the right-hand cannon (mirror x for the left). Only in cruise, when the cannons are out. */
export const GUN_MUZZLE = { x: 2.2, y: -0.35, z: -3.4 }

/**
 * The readouts for distances to other places are multiplied by this, the model's scale
 * (1:159), so the moon reads 384,000 km away and the sun 149 million, while altitude,
 * speed and anything near the ship stay honest metres. Chris, 2026-09-03: "can the distant
 * numbers appear to be real ... it's about scale realism without the actual size."
 */
export const DISPLAY_SCALE = 159
/**
 * The scale is not a step. The factor on a shown distance grows with the log of the
 * distance, 1 below DISPLAY_SCALE_FROM and the full DISPLAY_SCALE by DISPLAY_SCALE_TO,
 * so 100 m over the pad reads 100 m, the top of the air reads a few kilometres, a parked
 * orbit reads tens, and the moon reads 384,000 km with no seam between. Chris, 2026-09-03:
 * "would it scale better if it was log scale? ... begin to expand it when it gets to
 * 500 m." Altitude and distances to other bodies and clusters; never speed, never ETA,
 * never anything on the same body.
 */
export const DISPLAY_SCALE_FROM = 500
export const DISPLAY_SCALE_TO = 100_000
export function shownDistance(d: number): number {
  if (d <= DISPLAY_SCALE_FROM) return d
  const x = Math.min(1, (Math.log(d) - Math.log(DISPLAY_SCALE_FROM)) / (Math.log(DISPLAY_SCALE_TO) - Math.log(DISPLAY_SCALE_FROM)))
  // Geometric: the factor's logarithm ramps, so the start is gentle (two percent of 159 would already be ×4).
  return d * Math.pow(DISPLAY_SCALE, Math.pow(x, 1.6))
}
