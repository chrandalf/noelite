// Clouds seen from above: a smooth shell at cloud height whose cover is drawn per pixel
// by noise in the fragment shader, swirled like weather systems, lit by the sun and dark
// on the night side. The first version was an icosahedron with per-face cover refreshed
// 256 faces a frame, and from orbit that read as shimmering triangles (Chris, 2026-09-03:
// "they look a bit fake"). Under the cloud tops the cumulus puffs carry the weather and
// this shell fades out. The noise is Ashima's simplex (MIT), which is code, not an asset.
import * as THREE from 'three'
import type { Terrain } from '../world/height.ts'

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vL;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vL = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
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
  uniform float uCamAlt;
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vL;

  // Simplex noise, Ashima Arts / Stefan Gustavson, MIT.
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }

  void main() {
    #include <logdepthbuf_fragment>
    // The shell is the view from above. Under the cloud tops the cumulus carries the
    // weather and the shell is gone until the camera is well above them.
    float near = smoothstep(4000.0, 9000.0, length(vP - cameraPosition)) * smoothstep(3500.0, 7000.0, uCamAlt);
    if (near < 0.02) discard;
    vec3 p = normalize(vL) + vec3(uSeed);
    float t = uTime * 0.012;
    // Systems: a warped broad field for the swirl, a finer one for texture, drifting.
    vec3 q = p * 4.5 + vec3(t, 0.0, -0.6 * t);
    vec3 w = q + 1.1 * vec3(fbm(q * 0.7 + 3.1), fbm(q * 0.7 - 5.2), fbm(q * 0.7 + 8.9));
    float broad = fbm(w);
    float fine = fbm(p * 19.0 + vec3(2.7 * t, 1.3 * t, 0.0));
    float cover = smoothstep(-0.05, 0.42, broad * 0.8 + fine * 0.35 + 0.05);
    if (cover * near < 0.02) discard;
    // Lit by the sun; the night side goes dark; a little blue in the shadowed tops.
    float sun = dot(normalize(vN), uSun);
    float lit = 0.35 + 0.65 * max(sun, 0.0);
    float dayHere = smoothstep(-0.12, 0.18, sun);
    vec3 col = mix(vec3(0.58, 0.63, 0.72), vec3(0.98, 0.98, 0.99), lit) * (0.06 + 0.94 * dayHere);
    // Thinner toward the edge of a system, and at the limb.
    float edge = smoothstep(0.0, 0.5, cover);
    gl_FragColor = vec4(col, edge * 0.93 * near);
    #include <fog_fragment>
  }`

export class Clouds {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial

  /** `height` metres above datum for the shell. */
  constructor(terrain: Terrain, height: number) {
    const g = new THREE.SphereGeometry(terrain.radius + height, 96, 64)
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 }, uCamAlt: { value: 1e6 }, uTime: { value: 0 }, uSeed: { value: (terrain.seed % 1000) / 37 } }]),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    })
    this.material.name = 'clouds'
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.renderOrder = 3
    this.mesh.frustumCulled = false
  }

  /** `camAlt`: the viewer's altitude over the body, metres. */
  update(time: number, sun: THREE.Vector3, day: number, camAlt: number): void {
    const u = this.material.uniforms
    ;(u.uSun.value as THREE.Vector3).copy(sun)
    u.uDay.value = day
    u.uCamAlt.value = camAlt
    u.uTime.value = time
  }
}
