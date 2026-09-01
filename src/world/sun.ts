// Day-factor helpers. Where the sun *is* comes from the system (src/world/system.ts).
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 0 at night, 1 in full day, from the sine of the sun's (apparent) elevation. */
export function dayFactor(sunElev: number): number {
  return smoothstep(-0.12, 0.25, sunElev)
}
