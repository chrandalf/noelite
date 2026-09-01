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
