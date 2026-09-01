// The Lander look: bright, saturated bands by height, rock on the steep bits,
// and a small per-facet jitter so neighbouring triangles never share a shade.
export type RGB = [number, number, number]

const BANDS: { upTo: number; c: RGB }[] = [
  { upTo: -45, c: [0.18, 0.42, 0.30] }, // low, dark green
  { upTo: -10, c: [0.28, 0.60, 0.30] },
  { upTo: 25, c: [0.37, 0.75, 0.35] }, // plains, the scaffold green
  { upTo: 55, c: [0.58, 0.72, 0.34] }, // yellow-green upland
  { upTo: 80, c: [0.62, 0.55, 0.36] }, // tan
  { upTo: Infinity, c: [0.80, 0.77, 0.70] }, // pale stone
]
const ROCK: RGB = [0.46, 0.40, 0.30]

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** h in metres, slope in degrees, jitter in [-1, 1]. */
export function terrainColour(h: number, slope: number, jitter: number): RGB {
  let base = BANDS[BANDS.length - 1].c
  for (const b of BANDS) if (h < b.upTo) { base = b.c; break }
  const t = clamp01((slope - 24) / 16) // rock blends in across 24°..40°
  const k = 1 + 0.07 * jitter
  return [
    (base[0] * (1 - t) + ROCK[0] * t) * k,
    (base[1] * (1 - t) + ROCK[1] * t) * k,
    (base[2] * (1 - t) + ROCK[2] * t) * k,
  ]
}

/** Deterministic [-1, 1] from a point, so a rebuilt chunk gets the same facets. */
export function facetJitter(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}
