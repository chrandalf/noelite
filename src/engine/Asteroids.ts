// Rocks on screen. Three seeded potato shapes, stone and ice, instanced, placed
// every frame for the rocks within range of the viewer; beyond that a field is a
// sprinkle of points so you can find it. Plus the gun's tracer, the burst when a
// rock breaks, and the streak of fuel coming home from an ice rock.
import * as THREE from 'three'
import { ROCKS, rockPosition, fieldVelocity, type Rock, type Hit } from '../world/asteroids.ts'
import { rng } from '../world/noise.ts'

/** Metres from the viewer within which a rock gets a mesh, and within which a field shows as points. */
const MESH_RANGE = 80_000
const POINT_RANGE = 1_500_000
const PER_MESH = 512
const BURST_N = 240
const BURST_LIFE = 2.5

function potato(shape: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed()
  const next = rng(0x524f434b + shape * 7919)
  // A few random bumps: each a dent or a boss round a direction, so the same vertex gets the same push wherever it appears.
  const bumps: { d: THREE.Vector3; k: number; w: number }[] = []
  for (let i = 0; i < 9; i++) bumps.push({ d: new THREE.Vector3(next() - 0.5, next() - 0.5, next() - 0.5).normalize(), k: (next() - 0.5) * 0.5, w: 0.5 + next() * 0.8 })
  const squash = new THREE.Vector3(0.8 + 0.4 * next(), 0.7 + 0.5 * next(), 0.8 + 0.4 * next())
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    let r = 1
    for (const b of bumps) { const c = v.dot(b.d); if (c > 0) r += b.k * Math.pow(c, 1 / b.w) }
    v.multiplyScalar(r).multiply(squash)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

export class Asteroids {
  readonly group = new THREE.Group()
  private readonly meshes: THREE.InstancedMesh[] = []
  private readonly points: THREE.Points
  private readonly pointPos: Float32Array
  private readonly tracer: THREE.Line
  private readonly tracerPos: Float32Array
  private tracerUntil = -1
  private readonly streak: THREE.Line
  private readonly streakPos: Float32Array
  private streakUntil = -1
  private readonly streakFrom = new THREE.Vector3()
  /** The field's velocity, so the streak's origin and the tracer ride with the rocks instead of drifting off at 1.6 km/s. */
  private readonly rideVel = new THREE.Vector3()
  private readonly burstPoints: THREE.Points
  private readonly burstPos: Float32Array
  private readonly burstHelio = new Float64Array(BURST_N * 3)
  private readonly burstVel = new Float32Array(BURST_N * 3)
  private readonly burstLife = new Float32Array(BURST_N)
  private burstCursor = 0
  private readonly next = rng(0x4255525354)
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly colour = new THREE.Color()
  /** Rocks with meshes this frame, and the nearest few for the HUD. */
  drawn = 0

  constructor() {
    const stone = new THREE.MeshLambertMaterial({ color: 0x8a8074, fog: false })
    stone.name = 'stone'
    const ice = new THREE.MeshLambertMaterial({ color: 0xd6ecf8, emissive: 0x24384a, fog: false })
    ice.name = 'ice'
    for (let shape = 0; shape < 3; shape++) {
      const g = potato(shape)
      for (const mat of [stone, ice]) {
        const im = new THREE.InstancedMesh(g, mat, PER_MESH)
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        im.frustumCulled = false
        im.count = 0
        this.meshes.push(im)
        this.group.add(im)
      }
    }
    this.pointPos = new Float32Array(ROCKS.length * 3)
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3))
    const pm = new THREE.PointsMaterial({ color: 0xb8b0a4, size: 2, sizeAttenuation: false, fog: false })
    pm.name = 'rock-points'
    this.points = new THREE.Points(pg, pm)
    this.points.frustumCulled = false
    this.group.add(this.points)
    this.tracerPos = new Float32Array(6)
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3))
    const tm = new THREE.LineBasicMaterial({ color: 0xffe08a, fog: false })
    tm.name = 'tracer'
    this.tracer = new THREE.Line(tg, tm)
    this.tracer.frustumCulled = false
    this.tracer.visible = false
    this.group.add(this.tracer)
    this.streakPos = new Float32Array(6)
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3))
    const sm = new THREE.LineBasicMaterial({ color: 0x9fe3ff, fog: false, transparent: true, opacity: 1 })
    sm.name = 'streak'
    this.streak = new THREE.Line(sg, sm)
    this.streak.frustumCulled = false
    this.streak.visible = false
    this.group.add(this.streak)
    this.burstPos = new Float32Array(BURST_N * 3)
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(this.burstPos, 3))
    const bm = new THREE.PointsMaterial({ color: 0xe8e0d0, size: 3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false })
    bm.name = 'burst'
    this.burstPoints = new THREE.Points(bg, bm)
    this.burstPoints.frustumCulled = false
    this.group.add(this.burstPoints)
    for (let i = 0; i < BURST_N; i++) this.burstLife[i] = 0
  }

  /** A shot happened: draw the tracer, and if a rock broke, its burst and (for ice) the fuel streak. */
  shot(shot: { from: THREE.Vector3; to: THREE.Vector3; hit: Hit | null; broke: boolean; fuel: number }, t: number): void {
    this.tracerUntil = t + 0.08
    this.tracerFrom.copy(shot.from); this.tracerTo.copy(shot.to)
    if (shot.hit) fieldVelocity(shot.hit.rock.field, t, this.rideVel); else this.rideVel.set(0, 0, 0)
    if (shot.hit && shot.broke) {
      this.burst(shot.hit.rock, t)
      if (shot.fuel > 0) { this.streakUntil = t + 0.7; this.streakFrom.copy(shot.hit.point) }
    }
  }
  private readonly tracerFrom = new THREE.Vector3()
  private readonly tracerTo = new THREE.Vector3()

  private burst(r: Rock, t: number): void {
    const c = rockPosition(r, t), v = fieldVelocity(r.field, t)
    const n = Math.min(BURST_N, 40 + Math.floor(r.radius))
    for (let i = 0; i < n; i++) {
      const j = this.burstCursor; this.burstCursor = (this.burstCursor + 1) % BURST_N
      const d = new THREE.Vector3(this.next() - 0.5, this.next() - 0.5, this.next() - 0.5).normalize()
      const sp = r.radius * (0.15 + 0.5 * this.next())
      this.burstHelio[j * 3] = c.x + d.x * r.radius * 0.6; this.burstHelio[j * 3 + 1] = c.y + d.y * r.radius * 0.6; this.burstHelio[j * 3 + 2] = c.z + d.z * r.radius * 0.6
      this.burstVel[j * 3] = v.x + d.x * sp; this.burstVel[j * 3 + 1] = v.y + d.y * sp; this.burstVel[j * 3 + 2] = v.z + d.z * sp
      this.burstLife[j] = BURST_LIFE * (0.5 + 0.5 * this.next())
    }
  }

  /**
   * Place everything for this frame. `helio` is the viewer's heliocentric position,
   * `frame`/`qInv` the reference body's centre and inverse spin (scene space is the
   * reference body's rotating frame with the camera at the origin), `viewPos` the
   * camera in that frame, `craftHelio` the craft (for the fuel streak's end).
   */
  update(dt: number, t: number, helio: THREE.Vector3, frame: THREE.Vector3, qInv: THREE.Quaternion, viewPos: THREE.Vector3, craftHelio: THREE.Vector3): void {
    const counts = new Array<number>(this.meshes.length).fill(0)
    let np = 0
    let overflow = 0
    for (const r of ROCKS) {
      if (r.hp <= 0) continue
      rockPosition(r, t, this.p)
      const d = this.p.distanceTo(helio)
      if (d > POINT_RANGE) continue
      this.p.sub(frame).applyQuaternion(qInv).sub(viewPos)
      if (d > MESH_RANGE) {
        this.pointPos[np * 3] = this.p.x; this.pointPos[np * 3 + 1] = this.p.y; this.pointPos[np * 3 + 2] = this.p.z
        np++
        continue
      }
      const k = r.shape * 2 + (r.ice ? 1 : 0)
      const im = this.meshes[k]
      if (counts[k] >= PER_MESH) { overflow++; continue }
      this.q.setFromAxisAngle(r.spinAxis, r.spinRate * t).premultiply(qInv)
      this.s.setScalar(r.radius)
      this.m.compose(this.p, this.q, this.s)
      im.setMatrixAt(counts[k]++, this.m)
    }
    for (let k = 0; k < this.meshes.length; k++) { this.meshes[k].count = counts[k]; this.meshes[k].instanceMatrix.needsUpdate = true }
    this.points.geometry.setDrawRange(0, np)
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    this.drawn = counts.reduce((a, b) => a + b, 0)
    void overflow
    // Tracer and streak ride the field.
    this.tracerFrom.addScaledVector(this.rideVel, dt); this.tracerTo.addScaledVector(this.rideVel, dt); this.streakFrom.addScaledVector(this.rideVel, dt)
    this.tracer.visible = t < this.tracerUntil
    if (this.tracer.visible) {
      this.p.copy(this.tracerFrom).sub(frame).applyQuaternion(qInv).sub(viewPos)
      this.tracerPos[0] = this.p.x; this.tracerPos[1] = this.p.y; this.tracerPos[2] = this.p.z
      this.p.copy(this.tracerTo).sub(frame).applyQuaternion(qInv).sub(viewPos)
      this.tracerPos[3] = this.p.x; this.tracerPos[4] = this.p.y; this.tracerPos[5] = this.p.z
      ;(this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
    // Fuel streak, from where the ice was to the craft, fading.
    this.streak.visible = t < this.streakUntil
    if (this.streak.visible) {
      ;(this.streak.material as THREE.LineBasicMaterial).opacity = Math.min(1, (this.streakUntil - t) / 0.4)
      this.p.copy(this.streakFrom).sub(frame).applyQuaternion(qInv).sub(viewPos)
      this.streakPos[0] = this.p.x; this.streakPos[1] = this.p.y; this.streakPos[2] = this.p.z
      this.p.copy(craftHelio).sub(frame).applyQuaternion(qInv).sub(viewPos)
      this.streakPos[3] = this.p.x; this.streakPos[4] = this.p.y; this.streakPos[5] = this.p.z
      ;(this.streak.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    }
    // Burst fragments: fly on in heliocentric space with the field, fade out.
    let live = 0
    for (let j = 0; j < BURST_N; j++) {
      if (this.burstLife[j] <= 0) { this.burstPos[j * 3] = 0; this.burstPos[j * 3 + 1] = 0; this.burstPos[j * 3 + 2] = 1e12; continue }
      this.burstLife[j] -= dt
      this.burstHelio[j * 3] += this.burstVel[j * 3] * dt; this.burstHelio[j * 3 + 1] += this.burstVel[j * 3 + 1] * dt; this.burstHelio[j * 3 + 2] += this.burstVel[j * 3 + 2] * dt
      this.p.set(this.burstHelio[j * 3], this.burstHelio[j * 3 + 1], this.burstHelio[j * 3 + 2]).sub(frame).applyQuaternion(qInv).sub(viewPos)
      this.burstPos[j * 3] = this.p.x; this.burstPos[j * 3 + 1] = this.p.y; this.burstPos[j * 3 + 2] = this.p.z
      live++
    }
    this.burstPoints.visible = live > 0
    if (live) (this.burstPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    void this.colour
  }
}
