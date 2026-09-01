// Seeded 3D simplex noise, Stefan Gustavson's reference layout, with the
// permutation table shuffled from a 32-bit seed so every planet gets its own.
//
// Only erasable TypeScript in this directory: tools/*.mjs import it straight
// through Node's type stripping. No enums, no parameter properties.

const GRAD3: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
]
const F3 = 1 / 3
const G3 = 1 / 6

/** mulberry32. Small, fast, plenty for shuffling a table and scattering sites. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Simplex3 {
  private readonly perm = new Uint8Array(512)
  private readonly permMod12 = new Uint8Array(512)

  constructor(seed: number) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    const next = rng(seed)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const t = p[i]; p[i] = p[j]; p[j] = t
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]
      this.permMod12[i] = this.perm[i] % 12
    }
  }

  /** Roughly [-1, 1]. */
  noise(x: number, y: number, z: number): number {
    const { perm, permMod12 } = this
    const s = (x + y + z) * F3
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s)
    const t = (i + j + k) * G3
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t)

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3

    const ii = i & 255, jj = j & 255, kk = k & 255
    const gi0 = permMod12[ii + perm[jj + perm[kk]]]
    const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]
    const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]
    const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]

    let n = 0
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
    if (t0 > 0) { t0 *= t0; const g = GRAD3[gi0]; n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0) }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
    if (t1 > 0) { t1 *= t1; const g = GRAD3[gi1]; n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1) }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
    if (t2 > 0) { t2 *= t2; const g = GRAD3[gi2]; n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2) }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
    if (t3 > 0) { t3 *= t3; const g = GRAD3[gi3]; n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3) }
    return 32 * n
  }

  /** Fractal Brownian motion, normalised so the sum stays roughly in [-1, 1]. */
  fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0, amp = 1, freq = 1, norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, z * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return sum / norm
  }
}
