// Every number that is a dial rather than an architectural choice lives here.
// See DESIGN.md §4 for why the planets start small.

/** Metres. The one dial DESIGN.md says to turn later, not now. */
export const PLANET_RADIUS = 2000

/** Metres, roughly peak-to-datum. Lander had plains; you need somewhere to land. */
export const TERRAIN_AMPLITUDE = 140

/**
 * The universe is a fixed function of this. Once anything is authored against it
 * (easter eggs, missions) it does not move: bump SEED_VERSION and treat the old
 * universe as gone rather than editing this silently.
 */
export const MASTER_SEED = 0x4e4f454c // "NOEL"
export const SEED_VERSION = 1

// ---- Flight. Gameplay numbers, not physics. Tune by flying, then by harness. ----

/** m/s² at the surface. Falls off with (R/r)² so orbit is weightless. */
export const GRAVITY = 7.0
/** Metres. Drag fades to nothing here; above it the craft coasts. */
export const ATMOSPHERE_HEIGHT = 700
/** Quadratic drag per metre at sea level. Terminal velocity ≈ √(g/DRAG) ≈ 24 m/s. */
export const DRAG = 0.012
/** m/s² along the craft's own up-axis. Thrust-to-weight ≈ 1.85. */
export const THRUST_ACCEL = 13
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
