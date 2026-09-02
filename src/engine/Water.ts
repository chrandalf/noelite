// The sea, in the Lander idiom: flat facets that ride the swell, coloured by the angle
// you see them at, with the sun glinting off whichever facets face it. Every vertex
// carries its depth, so (Chris, 2026-09-02) the swell only builds in deep water and a
// pond lies flat, the shallows near land get the short breaking ripple with foam on the
// crests running toward the shore, and the tide bulges only where the water is deep.
// One material, shared by every body with a sea; the LOD tiles the surface with the
// same chunks the ground uses, at sea level, culled where the ground is dry.
import * as THREE from 'three'

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uWind;
  uniform float uTide;
  uniform vec3 uMoon;
  attribute float depth;
  varying vec3 vP;
  varying float vDepth;
  varying float vFoam;
  float smooth01(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  void main() {
    vec3 p = position;
    vec3 up = normalize(position);
    float ocean = smooth01(10.0, 30.0, depth);
    // Swell: three slow crossing sets, growing with depth and with the wind.
    float swellAmp = 0.5 * smooth01(4.0, 30.0, depth) * (0.3 + uWind / 20.0);
    float w = sin(p.x * 0.031 + uTime * 0.9) + sin(p.y * 0.047 - uTime * 1.3) + sin((p.x + p.z) * 0.019 + uTime * 0.6);
    // Shore: bands parallel to the depth contours, running in toward the beach and breaking.
    float shore = 1.0 - smooth01(0.0, 8.0, depth);
    float phase = sin(depth * 1.4 - uTime * 2.2);
    // Tide: the moon's two bulges, deep water only.
    float c = dot(up, uMoon);
    float tide = uTide * (1.5 * c * c - 0.5) * ocean;
    p += normal * (swellAmp * w + 0.22 * shore * phase + tide);
    vFoam = shore * smooth01(0.55, 1.0, phase) * (1.0 - smooth01(0.0, 3.5, depth));
    vDepth = depth;
    vec4 wp = modelMatrix * vec4(p, 1.0);
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
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uShoal;
  uniform float uDay;
  varying vec3 vP;
  varying float vDepth;
  varying float vFoam;
  void main() {
    #include <logdepthbuf_fragment>
    // The facet's own normal, from the position derivatives: flat shading that moves.
    vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
    vec3 v = normalize(cameraPosition - vP);
    if (dot(n, v) < 0.0) n = -n;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    float lit = max(dot(n, uSun), 0.0) * 0.75 + 0.25;
    vec3 body = mix(uShoal, uDeep, clamp(vDepth / 25.0, 0.0, 1.0));
    vec3 col = mix(body, uShallow, fresnel) * lit * uDay;
    vec3 h = normalize(uSun + v);
    float glint = pow(max(dot(n, h), 0.0), 120.0) * step(0.0, dot(n, uSun));
    col += vec3(1.0, 0.96, 0.88) * glint * uDay;
    col = mix(col, vec3(0.92, 0.95, 0.97) * (0.4 + 0.6 * uDay), vFoam * 0.85);
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`

export class Water {
  readonly material: THREE.ShaderMaterial
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uWind: { value: 4 },
        uTide: { value: 0 },
        uMoon: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uDeep: { value: new THREE.Color(0.06, 0.22, 0.42) },
        uShallow: { value: new THREE.Color(0.30, 0.55, 0.62) },
        uShoal: { value: new THREE.Color(0.16, 0.42, 0.46) },
        uDay: { value: 1 },
      }]),
      fog: true, side: THREE.FrontSide,
    })
    this.material.name = 'water'
  }
  /** `sun`: unit toward the sun in scene space. `day`: 0 at night, 1 in full day. `wind` m/s. `moon`: body-local unit, or null; `tide` metres. */
  update(time: number, sun: THREE.Vector3, day: number, wind: number, moon: THREE.Vector3 | null, tide: number): void {
    const u = this.material.uniforms
    u.uTime.value = time
    ;(u.uSun.value as THREE.Vector3).copy(sun)
    u.uDay.value = 0.12 + 0.88 * day
    u.uWind.value = wind
    u.uTide.value = moon ? tide : 0
    if (moon) (u.uMoon.value as THREE.Vector3).copy(moon)
  }
}
