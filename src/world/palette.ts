// The Lander look, per kind of body: bright bands by height for the living
// worlds, lava for the hot one, greys for rock, latitude stripes for the giant.
// A small per-facet jitter so neighbouring triangles never share a shade.
import type { BodyKind } from './system.ts'

export type RGB = [number, number, number]

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Living worlds, banded by height above the sea in units of the body's amplitude. */
const GREEN: { upTo: number; c: RGB }[] = [
  { upTo: -0.02, c: [0.30, 0.38, 0.32] }, // sea floor (seen only where the water is not drawn)
  { upTo: 0.03, c: [0.80, 0.74, 0.54] }, // sand
  { upTo: 0.35, c: [0.37, 0.75, 0.35] }, // plains, the scaffold green
  { upTo: 0.85, c: [0.28, 0.60, 0.30] }, // lowland forest green
  { upTo: 1.5, c: [0.58, 0.72, 0.34] }, // yellow-green upland
  { upTo: 2.1, c: [0.62, 0.55, 0.36] }, // tan
  { upTo: Infinity, c: [0.60, 0.57, 0.52] }, // stone; snow is by snowline, below
]
const SNOW: RGB = [0.94, 0.95, 0.97]
/**
 * Snowline in amplitudes above the sea: 1.8 at the equator, falling steeply toward the
 * poles so the caps reach the shore. Chris, 2026-09-02: "snow on mountain tops too".
 */
function snowline(lat: number): number { const l2 = lat * lat; return 1.8 - 1.9 * l2 * l2 * l2 }
/** Deep water, for the far sphere; near the ground the water shader draws the sea. */
export const SEA: RGB = [0.08, 0.26, 0.45]
const LAVA: { upTo: number; c: RGB }[] = [
  { upTo: -0.3, c: [0.16, 0.05, 0.04] }, // basalt basins
  { upTo: 0.1, c: [0.42, 0.10, 0.05] },
  { upTo: 0.5, c: [0.70, 0.22, 0.06] },
  { upTo: Infinity, c: [0.95, 0.55, 0.12] }, // glowing crests
]
const ROCK: RGB = [0.46, 0.40, 0.30]
const GIANT_BANDS: RGB[] = [[0.92, 0.86, 0.70], [0.78, 0.62, 0.42], [0.62, 0.38, 0.22], [0.85, 0.75, 0.58]]

function band(table: { upTo: number; c: RGB }[], h: number): RGB {
  for (const b of table) if (h < b.upTo) return b.c
  return table[table.length - 1].c
}

/**
 * `hNorm` = height / amplitude, `aboveNorm` = (height − sea) / amplitude (= hNorm on a dry
 * body), `slope` degrees, `jitter` in [-1, 1], `lat` = dot(p, spin axis) in [-1, 1].
 */
export function terrainColour(kind: BodyKind, hNorm: number, slope: number, jitter: number, lat: number, aboveNorm: number): RGB {
  const k = 1 + 0.07 * jitter
  let base: RGB
  switch (kind) {
    case 'terrestrial': {
      base = mix(band(GREEN, aboveNorm), ROCK, clamp01((slope - 24) / 16))
      // Snow above the line, feathered over a tenth of an amplitude; it does not stick to cliffs.
      const snow = clamp01((aboveNorm - snowline(lat)) / 0.1) * (1 - clamp01((slope - 38) / 12))
      if (aboveNorm > 0.02) base = mix(base, SNOW, snow)
      break
    }
    case 'hot': base = mix(band(LAVA, hNorm), [0.12, 0.09, 0.09], clamp01((slope - 30) / 20)); break
    case 'giant': {
      const i = Math.floor((lat + 1) * 5.5 + jitter * 0.25) & 3
      base = GIANT_BANDS[i]; break
    }
    case 'sun': base = [1, 0.9, 0.6]; break
    default: { // moon, tiny: grey rock, lighter on the heights, darker on the steeps
      const l = 0.32 + 0.28 * clamp01(hNorm * 0.5 + 0.5)
      base = mix([l, l * 0.98, l * 0.95], [0.22, 0.21, 0.2], clamp01((slope - 28) / 18))
    }
  }
  return [base[0] * k, base[1] * k, base[2] * k]
}

/** Deterministic [-1, 1] from a point, so a rebuilt chunk gets the same facets. */
export function facetJitter(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}
