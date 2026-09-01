// The atmosphere is one number: density by altitude. Drag, sky colour, haze,
// the rim glow and the HUD readout all key off it, so "out of the atmosphere"
// means the same thing to the physics as it does to your eyes.
import * as THREE from 'three'
import { PLANET_RADIUS, ATMOSPHERE_HEIGHT } from './config.ts'

/** 1 at the surface, 0 at ATMOSPHERE_HEIGHT and above. Smoothstep between. */
export function atmosphereDensity(altitude: number): number {
  const x = 1 - Math.min(1, Math.max(0, altitude / ATMOSPHERE_HEIGHT))
  return x * x * (3 - 2 * x)
}

// Rim-lit shell at the top of the atmosphere. Front faces only, so from inside
// it is culled and the sky colour does the job; from orbit it is the halo.
// Includes Three's log-depth chunks so it sits correctly against the terrain.
const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`
const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform vec3 uSun;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vP);
    float rim = 1.0 - abs(dot(n, v));
    float glow = pow(rim, 2.2);
    float day = clamp(dot(n, uSun) * 0.7 + 0.45, 0.0, 1.0);
    gl_FragColor = vec4(uColor * day, glow * 0.9);
  }`

export function buildAtmosphereShell(sunDir: THREE.Vector3, colour: THREE.Color): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uColor: { value: colour.clone() }, uSun: { value: sunDir.clone().normalize() } },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  })
  mat.name = 'atmosphere'
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_RADIUS + ATMOSPHERE_HEIGHT, 48, 32), mat)
  mesh.renderOrder = 4
  return mesh
}
