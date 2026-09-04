// A wreck: the hull's six facets tumbling off as little rigid bodies, in the reference
// body's local frame, with the body's gravity, a bounce and a slide, until they rest.
// Chris, 2026-09-02: "more realistic crashes". DESIGN §10. Pure enough for the flight
// harness: no Three scene here, only vectors; the meshes are built by buildWreckMeshes.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { groundRadius } from '../world/terrain.ts'
import { rng } from '../world/noise.ts'
import { HULL_FACETS } from './craftMesh.ts'

export type Piece = { pos: THREE.Vector3; vel: THREE.Vector3; quat: THREE.Quaternion; spin: THREE.Vector3; size: number; resting: boolean }

const RESTITUTION = 0.3
const SLIDE = 0.55
const REST_SPEED = 0.6
/** A piece sits this far above the ground so it does not z-fight the terrain. */
const LIFT = 0.25

export class Wreck {
  readonly pieces: Piece[] = []
  readonly at = new THREE.Vector3()
  age = 0
  private readonly up = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private readonly dq = new THREE.Quaternion()

  /**
   * `pos`, `quat`, `vel` are the craft's at contact, local frame. Each facet leaves from
   * its own centroid, carrying part of the contact velocity plus a kick along its own
   * normal and up, so a belly-flop scatters flat and a nose-in throws the tail high.
   */
  readonly terrain: Terrain
  constructor(terrain: Terrain, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3, seed = 1) {
    this.terrain = terrain
    this.at.copy(pos)
    const next = rng(seed >>> 0)
    const up = this.up.copy(pos).normalize()
    for (const [pa, pb, pc] of HULL_FACETS) {
      const a = new THREE.Vector3(...pa), b = new THREE.Vector3(...pb), c = new THREE.Vector3(...pc)
      const centroid = a.clone().add(b).add(c).divideScalar(3)
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
      if (normal.dot(centroid) < 0) normal.negate()
      const p: Piece = {
        pos: centroid.clone().applyQuaternion(quat).add(pos),
        vel: vel.clone().multiplyScalar(0.35).addScaledVector(normal.applyQuaternion(quat), 3 + 5 * next()).addScaledVector(up, 4 + 7 * next()),
        quat: quat.clone(),
        spin: new THREE.Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(6 + 8 * next()),
        size: Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) * 0.5,
        resting: false,
      }
      this.pieces.push(p)
    }
  }

  /** The pieces' resting poses, for the save. */
  toJSON(): { at: number[]; pieces: { pos: number[]; quat: number[] }[] } {
    return { at: this.at.toArray(), pieces: this.pieces.map((p) => ({ pos: p.pos.toArray(), quat: p.quat.toArray() })) }
  }

  /** A wreck back from the save: every piece at rest where it was. */
  static restore(terrain: Terrain, j: { at: number[]; pieces: { pos: number[]; quat: number[] }[] }): Wreck {
    const at = new THREE.Vector3().fromArray(j.at)
    const w = new Wreck(terrain, at, new THREE.Quaternion(), new THREE.Vector3(), 1)
    for (let i = 0; i < w.pieces.length && i < j.pieces.length; i++) {
      const p = w.pieces[i]
      p.pos.fromArray(j.pieces[i].pos); p.quat.fromArray(j.pieces[i].quat); p.vel.set(0, 0, 0); p.spin.set(0, 0, 0); p.resting = true
    }
    return w
  }

  /** True once every piece has come to rest. */
  settled(): boolean { return this.pieces.every((p) => p.resting) }

  step(dt: number): void {
    this.age += dt
    const g = this.terrain.g
    for (const p of this.pieces) {
      if (p.resting) continue
      this.dir.copy(p.pos).normalize()
      p.vel.addScaledVector(this.dir, -g * dt)
      p.pos.addScaledVector(p.vel, dt)
      const floor = groundRadius(this.dir, this.terrain) + LIFT + p.size * 0.3
      const r = p.pos.length()
      if (r < floor) {
        // Bounce: the radial part reflects and loses most of itself, the rest slides and loses some.
        p.pos.copy(this.dir).multiplyScalar(floor)
        const vn = p.vel.dot(this.dir)
        if (vn < 0) {
          p.vel.addScaledVector(this.dir, -vn)      // tangential only
          p.vel.multiplyScalar(SLIDE)
          p.vel.addScaledVector(this.dir, -vn * RESTITUTION)
          p.spin.multiplyScalar(0.5)
        }
        if (p.vel.length() < REST_SPEED) { p.resting = true; p.vel.set(0, 0, 0); p.spin.set(0, 0, 0) }
      }
      const w = p.spin.length()
      if (w > 1e-6) { this.dq.setFromAxisAngle(this.tmp.copy(p.spin).divideScalar(w), w * dt); p.quat.premultiply(this.dq) }
    }
  }
}

/** One flat triangle per facet, in the wreck's frame; call syncWreckMeshes each frame. */
export function buildWreckMeshes(): THREE.Mesh[] {
  return HULL_FACETS.map(([pa, pb, pc, colour]) => {
    const a = new THREE.Vector3(...pa), b = new THREE.Vector3(...pb), c = new THREE.Vector3(...pc)
    const centroid = a.clone().add(b).add(c).divideScalar(3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a.sub(centroid).toArray(), ...b.sub(centroid).toArray(), ...c.sub(centroid).toArray()], 3))
    g.computeVertexNormals()
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour[0] * 0.6, colour[1] * 0.6, colour[2] * 0.6), side: THREE.DoubleSide })
    m.name = 'wreck'
    return new THREE.Mesh(g, m)
  })
}

export function syncWreckMeshes(w: Wreck, meshes: THREE.Mesh[]): void {
  for (let i = 0; i < meshes.length; i++) { meshes[i].position.copy(w.pieces[i].pos); meshes[i].quaternion.copy(w.pieces[i].quat) }
}
