// Clouds: a shell of flat faces at cloud height whose cover comes from the weather
// front, refreshed a slice of faces per frame so it drifts with the systems. The same
// field rains on you, so what is overhead is what is falling. Chunky on purpose.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'
import { front, cloudOf } from '../world/weather.ts'

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  attribute float cover;
  varying float vCover;
  varying vec3 vN;
  void main() {
    vCover = cover;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }`
const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #include <fog_pars_fragment>
  uniform vec3 uSun;
  uniform float uDay;
  varying float vCover;
  varying vec3 vN;
  void main() {
    #include <logdepthbuf_fragment>
    if (vCover < 0.02) discard;
    float lit = 0.55 + 0.45 * max(dot(vN, uSun), 0.0);
    vec3 col = mix(vec3(0.62, 0.65, 0.70), vec3(0.97, 0.97, 0.98), lit) * (0.15 + 0.85 * uDay);
    gl_FragColor = vec4(col, vCover * 0.92);
    #include <fog_fragment>
  }`

export class Clouds {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  private readonly cover: Float32Array
  private readonly centres: Float32Array
  private readonly faces: number
  private cursor = 0
  private readonly terrain: Terrain
  private readonly d = new THREE.Vector3()

  /** `height` metres above datum for the shell. */
  constructor(terrain: Terrain, height: number, detail = 5) {
    this.terrain = terrain
    const g = new THREE.IcosahedronGeometry(terrain.radius + height, detail).toNonIndexed()
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    this.faces = pos.count / 3
    this.cover = new Float32Array(pos.count)
    this.centres = new Float32Array(this.faces * 3)
    for (let f = 0; f < this.faces; f++) {
      this.d.set(0, 0, 0)
      for (let k = 0; k < 3; k++) this.d.x += pos.getX(f * 3 + k) / 3, this.d.y += pos.getY(f * 3 + k) / 3, this.d.z += pos.getZ(f * 3 + k) / 3
      this.d.normalize()
      this.centres[f * 3] = this.d.x; this.centres[f * 3 + 1] = this.d.y; this.centres[f * 3 + 2] = this.d.z
    }
    g.setAttribute('cover', new THREE.BufferAttribute(this.cover, 1))
    g.computeVertexNormals()
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 } }]),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    })
    this.material.name = 'clouds'
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.renderOrder = 3
    this.mesh.frustumCulled = false
    this.refresh(0, this.faces)
  }

  /** Recompute `n` faces' cover at `time`, round-robin. */
  refresh(time: number, n = 256): void {
    for (let i = 0; i < n; i++) {
      const f = this.cursor; this.cursor = (this.cursor + 1) % this.faces
      this.d.set(this.centres[f * 3], this.centres[f * 3 + 1], this.centres[f * 3 + 2])
      const c = cloudOf(front(this.d, this.terrain, time))
      const a = c < 0.3 ? 0 : (c - 0.3) / 0.7
      this.cover[f * 3] = this.cover[f * 3 + 1] = this.cover[f * 3 + 2] = a
    }
    ;(this.mesh.geometry.getAttribute('cover') as THREE.BufferAttribute).needsUpdate = true
  }

  update(time: number, sun: THREE.Vector3, day: number): void {
    this.refresh(time)
    const u = this.material.uniforms
    ;(u.uSun.value as THREE.Vector3).copy(sun)
    u.uDay.value = day
  }
}
