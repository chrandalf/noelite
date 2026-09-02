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
export const DRAG = 0.004
/** m/s² along the craft's own up-axis. Thrust-to-weight ≈ 1.83 at Earth g. */
export const THRUST_ACCEL = 18
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
 * m/s, the cruise cap right next to a body. Near a body the cap is the speed you could
 * brake from before reaching the surface, √(CRUISE_MAX² + 2·CRUISE_DECEL·d); far from
 * anything it is d / CRUISE_SECONDS, so at full speed you are never more than a few
 * seconds from the nearest thing and the same rule reels you in on arrival. Elite
 * Dangerous's supercruise, which is the one that has been played for a decade. With a
 * target ahead the rule keys off the target's surface too. The cap is a hard clamp.
 */
export const CRUISE_MAX = 150
/** m/s², the near-body deceleration profile. Takes over from the linear rule inside ~50 km. */
export const CRUISE_DECEL = 500
/** Seconds. Far-field cap = distance to the nearest surface / this. 7 is the ED "0:06" feel. */
export const CRUISE_SECONDS = 7
/** Seconds of full thrust to reach the cap, whatever the cap is. Engine never the limit. */
export const CRUISE_SPOOL = 4
/** Brake (the / key in cruise) as a fraction of main thrust. */
export const CRUISE_BRAKE = 0.8
