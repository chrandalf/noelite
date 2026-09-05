// The dig you can see (Chris, 2026-09-05: "digging needs to have some sort of animation and be
// 4 times quicker"). An auger runs out from under the keel and spins into the ground, a spoil
// heap the colour of the good grows beside the ship, and the cargo module fills on the ground
// then hops up to its slot on the hull. The digger's parts live in the ship's frame; the
// heaps live in the body's frame and stay where they were dug. Same rule as the ship: flat
// polygons, a few colours, no assets.
import * as THREE from 'three'
import type { Craft } from './Craft.ts'
import type { Good } from '../world/seams.ts'
import { groundRadius } from '../world/terrain.ts'
import { HULL_CLEARANCE } from '../world/config.ts'

/** The good's colour: the heap, the module. */
export const GOOD_COLOUR: Record<Good, number> = { water: 0x4d8fd6, timber: 0x7a4f2a, ore: 0x8a4a2a, salt: 0xe8e4d8, crystal: 0x7fe6e0, ice: 0xbfe3f5, helium: 0xd8d8e8, sulphur: 0xd9c23a }

/** The dig's phases, as fractions of DIG_SECONDS: the auger runs out, drills (the module fills), the module hops to its slot, the auger comes home. */
export const DIG_EXTEND = 0.12
export const DIG_HOP = 0.8
export const DIG_HOP_END = 0.92
/** Body-frame spots: where the auger leaves the keel, and where the module sits on the ground while it fills. */
export const AUGER_ROOT = new THREE.Vector3(0.9, -0.4, 0.6)
export const AUGER_REACH = 1.8
export const MODULE_GROUND = new THREE.Vector3(2.1, -HULL_CLEARANCE + 0.3, 0.6)
const HEAPS = 8
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export type DigPhase = { on: boolean; drilling: boolean; fill: number; hop: number }

export class Digger {
  readonly group = new THREE.Group()
  private readonly boom: THREE.Mesh
  private readonly bit: THREE.Mesh
  private readonly heaps: THREE.Mesh[] = []
  private heapCursor = 0
  private heap: THREE.Mesh | null = null
  private readonly tmp = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly UP = new THREE.Vector3(0, 1, 0)

  constructor(heapParent: THREE.Object3D) {
    const metal = new THREE.MeshLambertMaterial({ color: 0x8a8f96 })
    metal.name = 'auger'
    const boomGeo = new THREE.CylinderGeometry(0.14, 0.14, 1, 8)
    boomGeo.translate(0, -0.5, 0)   // hangs from its top
    this.boom = new THREE.Mesh(boomGeo, metal)
    const bitGeo = new THREE.ConeGeometry(0.34, 0.7, 6)
    bitGeo.rotateX(Math.PI)          // point down
    this.bit = new THREE.Mesh(bitGeo, metal)
    this.group.add(this.boom, this.bit)
    this.group.position.copy(AUGER_ROOT)
    this.group.visible = false
    const heapGeo = new THREE.ConeGeometry(1.3, 0.9, 8)
    heapGeo.translate(0, 0.45, 0)    // stands on its base
    for (let i = 0; i < HEAPS; i++) {
      const m = new THREE.MeshLambertMaterial({ color: 0x888888 })
      m.name = 'spoil'
      const h = new THREE.Mesh(heapGeo, m)
      h.visible = false
      heapParent.add(h)
      this.heaps.push(h)
    }
  }

  /** Every heap mesh, so the game can carry them into a new reference frame. */
  heapsAll(): THREE.Mesh[] { return this.heaps }
  /** How many heaps are showing, for the probe. */
  heapCount(): number { return this.heaps.filter((h) => h.visible).length }

  /**
   * `p` is the dig's progress 0..1, or below 0 for no dig. Sets the auger, grows the heap,
   * and returns the phase the caller needs to place the module and shake the ship.
   */
  update(p: number, dt: number, good: Good | null, craft: Craft): DigPhase {
    if (p < 0 || !good) {
      this.group.visible = false
      this.heap = null
      return { on: false, drilling: false, fill: 0, hop: 0 }
    }
    this.group.visible = true
    const out = clamp01(p / DIG_EXTEND) * (1 - clamp01((p - DIG_HOP_END) / (1 - DIG_HOP_END)))
    const len = AUGER_REACH * out
    this.boom.scale.y = Math.max(0.01, len)
    this.bit.position.y = -len - 0.3
    const drilling = p > DIG_EXTEND && p < DIG_HOP
    if (drilling) this.bit.rotation.y += 32 * dt
    const fill = clamp01((p - DIG_EXTEND) / (DIG_HOP - DIG_EXTEND))
    // The heap: claimed when the dig starts, at the spot on the ground beside the ship, and grows with the fill.
    if (!this.heap) {
      this.heap = this.heaps[this.heapCursor]; this.heapCursor = (this.heapCursor + 1) % HEAPS
      this.tmp.copy(MODULE_GROUND).setX(MODULE_GROUND.x + 0.9).applyQuaternion(craft.quat).add(craft.pos)
      this.dir.copy(this.tmp).normalize()
      this.heap.position.copy(this.dir).multiplyScalar(groundRadius(this.dir, craft.terrain) + 0.05)
      this.heap.quaternion.setFromUnitVectors(this.UP, this.dir)
      ;(this.heap.material as THREE.MeshLambertMaterial).color.setHex(GOOD_COLOUR[good])
      this.heap.visible = true
    }
    const s = 0.08 + 0.92 * fill
    this.heap.scale.set(s, s, s)
    return { on: true, drilling, fill, hop: clamp01((p - DIG_HOP) / (DIG_HOP_END - DIG_HOP)) }
  }
}
