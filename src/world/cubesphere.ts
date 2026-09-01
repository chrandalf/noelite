// Six faces, each (u, v) ∈ [-1, 1]², onto the unit sphere and back.
//
// The face order and orientation are a convention. Every face's (du × dv)
// points outward so mesh winding is consistent; verify-terrain checks that,
// and that the round trip is exact at edges and corners.
import type { UnitVector } from './height.ts'

/** +X, -X, +Y, -Y, +Z, -Z */
export type Face = 0 | 1 | 2 | 3 | 4 | 5
export const FACES: readonly Face[] = [0, 1, 2, 3, 4, 5]

export function faceToCube(face: Face, u: number, v: number): [number, number, number] {
  switch (face) {
    case 0: return [1, v, -u]
    case 1: return [-1, v, u]
    case 2: return [u, 1, -v]
    case 3: return [u, -1, v]
    case 4: return [u, v, 1]
    case 5: return [-u, v, -1]
  }
}

/**
 * Cube point to unit sphere. Plain normalisation for now. A spherified mapping
 * (less stretch at the corners) can replace this without touching any caller.
 */
export function cubeToUnit(x: number, y: number, z: number): UnitVector {
  const l = Math.hypot(x, y, z)
  return { x: x / l, y: y / l, z: z / l }
}

export function faceToUnit(face: Face, u: number, v: number): UnitVector {
  const [x, y, z] = faceToCube(face, u, v)
  return cubeToUnit(x, y, z)
}

/** Any direction to the face it lands on and where. Inverse of faceToUnit. */
export function cubeToFace(x: number, y: number, z: number): { face: Face; u: number; v: number } {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z)
  if (ax >= ay && ax >= az) {
    return x > 0 ? { face: 0, u: -z / ax, v: y / ax } : { face: 1, u: z / ax, v: y / ax }
  }
  if (ay >= az) {
    return y > 0 ? { face: 2, u: x / ay, v: -z / ay } : { face: 3, u: x / ay, v: z / ay }
  }
  return z > 0 ? { face: 4, u: x / az, v: y / az } : { face: 5, u: -x / az, v: y / az }
}
