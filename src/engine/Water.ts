// The sea, in the Lander idiom: flat facets that ride a few slow waves, coloured by
// the angle you see them at, with the sun glinting off whichever facets face it.
// One material, shared by every body with a sea; the LOD tiles the surface with the
// same chunks the ground uses, at sea level, culled where the ground is dry.
import * as THREE from 'three'

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vP;
  void main() {
    vec3 p = position;
    // Three slow swells, wavelengths of tens of metres, amplitude well under a metre each.
    float w = sin(p.x * 0.031 + uTime * 0.9) + sin(p.y * 0.047 - uTime * 1.3) + sin((p.x + p.z) * 0.019 + uTime * 0.6);
    p += normal * (0.5 * w);
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
  uniform float uDay;
  varying vec3 vP;
  void main() {
    #include <logdepthbuf_fragment>
    // The facet's own normal, from the position derivatives: flat shading that moves.
    vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
    vec3 v = normalize(cameraPosition - vP);
    if (dot(n, v) < 0.0) n = -n;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    float lit = max(dot(n, uSun), 0.0) * 0.75 + 0.25;
    vec3 col = mix(uDeep, uShallow, fresnel) * lit * uDay;
    vec3 h = normalize(uSun + v);
    float glint = pow(max(dot(n, h), 0.0), 120.0) * step(0.0, dot(n, uSun));
    col += vec3(1.0, 0.96, 0.88) * glint * uDay;
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
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uDeep: { value: new THREE.Color(0.06, 0.22, 0.42) },
        uShallow: { value: new THREE.Color(0.30, 0.55, 0.62) },
        uDay: { value: 1 },
      }]),
      fog: true, side: THREE.FrontSide,
    })
    this.material.name = 'water'
  }
  /** `sun`: unit toward the sun in scene space. `day`: 0 at night, 1 in full day. */
  update(time: number, sun: THREE.Vector3, day: number): void {
    const u = this.material.uniforms
    u.uTime.value = time
    ;(u.uSun.value as THREE.Vector3).copy(sun)
    u.uDay.value = 0.12 + 0.88 * day
  }
}
