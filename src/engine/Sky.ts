// Sky dome, stars, sun. All at the scene root, which under camera-relative
// rendering means they are centred on the viewer for free. The dome is a
// gradient from horizon to zenith keyed on the local up and the sun; it goes
// orange toward a low sun, navy at night, and transparent in vacuum so the
// stars show through. Nothing here writes depth; the terrain draws over it.
import * as THREE from 'three'
import { rng } from '../world/noise.ts'
import { dayFactor, smoothstep } from '../world/sun.ts'

const DOME_R = 5e4
const STAR_R = 1e5

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`
const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uUp;
  uniform vec3 uSun;
  uniform float uDensity;
  uniform float uDay;
  uniform vec3 uSunCol;
  varying vec3 vDir;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float h = dot(d, uUp);
    float sunElev = dot(uSun, uUp);
    vec3 zenith  = mix(vec3(0.02, 0.03, 0.08), vec3(0.30, 0.55, 0.90), uDay);
    vec3 horizon = mix(vec3(0.05, 0.06, 0.12), vec3(0.62, 0.78, 0.95), uDay);
    // Dusk band: strongest toward the sun when it sits on the horizon.
    float dusk = 1.0 - smoothstep(0.0, 0.35, abs(sunElev));
    vec3 dh = normalize(d - uUp * h + 1e-4);
    vec3 sh = normalize(uSun - uUp * sunElev + 1e-4);
    float towardSun = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0);
    horizon = mix(horizon, vec3(0.95, 0.45, 0.18), dusk * (0.25 + 0.75 * towardSun * towardSun));
    vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
    if (h < 0.0) col = horizon * (1.0 + h * 0.6);
    // The sun itself: a hard disc and a soft glow, drawn here rather than as a
    // mesh so it lives in a shader that is known to validate everywhere.
    float s = max(dot(d, uSun), 0.0);
    float disc = smoothstep(0.99984, 0.99993, s);
    float glow = pow(s, 60.0) * (0.25 + 0.75 * uDay) * (0.4 + 0.6 * uDensity);
    float alpha = uDensity * (0.35 + 0.65 * uDay);
    col += uSunCol * glow * 0.9;
    col = mix(col, uSunCol, disc);
    alpha = max(alpha, max(disc, glow * 0.8));
    gl_FragColor = vec4(col, alpha);
  }`

export class Sky {
  readonly group = new THREE.Group()
  /** Representative horizon colour, for the fog. */
  readonly horizon = new THREE.Color()
  private readonly dome: THREE.ShaderMaterial
  private readonly stars: THREE.PointsMaterial

  constructor() {
    this.dome = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uDensity: { value: 1 }, uDay: { value: 1 }, uSunCol: { value: new THREE.Color(1, 0.96, 0.86) } },
      side: THREE.BackSide, transparent: true, depthWrite: false,
    })
    this.dome.name = 'skydome'
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 24), this.dome)
    dome.renderOrder = -2
    dome.frustumCulled = false

    const N = 2600, next = rng(0x5741)
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      let x: number, y: number, s: number
      do { x = next() * 2 - 1; y = next() * 2 - 1; s = x * x + y * y } while (s >= 1 || s === 0)
      const f = 2 * Math.sqrt(1 - s)
      pos[i * 3] = x * f * STAR_R; pos[i * 3 + 1] = y * f * STAR_R; pos[i * 3 + 2] = (1 - 2 * s) * STAR_R
      const b = 0.45 + 0.55 * next() ** 2, warm = next()
      col[i * 3] = b * (0.85 + 0.15 * warm); col[i * 3 + 1] = b * (0.85 + 0.1 * warm); col[i * 3 + 2] = b * (1.0 - 0.15 * warm)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.stars = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false })
    this.stars.name = 'stars'
    const stars = new THREE.Points(sg, this.stars)
    stars.renderOrder = -3 // before the dome, which covers them by day and carries the sun disc
    stars.frustumCulled = false

    this.group.add(stars, dome)
  }

  /** `up`: viewer's local vertical. `sun`: unit toward the sun. `density`: atmosphere where the viewer is. Returns the day factor. */
  update(up: THREE.Vector3, sun: THREE.Vector3, density: number): number {
    const sunElev = up.dot(sun)
    const day = dayFactor(sunElev)
    const u = this.dome.uniforms
    ;(u.uUp.value as THREE.Vector3).copy(up)
    ;(u.uSun.value as THREE.Vector3).copy(sun)
    u.uDensity.value = density
    u.uDay.value = day

    this.stars.opacity = 1 - density * (0.15 + 0.85 * day)

    const low = (1 - smoothstep(-0.05, 0.22, sunElev)) * density // reddens only through air
    ;(u.uSunCol.value as THREE.Color).setRGB(1.0, 0.96 - 0.4 * low, 0.86 - 0.7 * low)

    // Mirror of the shader's horizon term, without the azimuth, for the fog colour.
    const dusk = 1 - smoothstep(0, 0.35, Math.abs(sunElev))
    const r = (0.05 + (0.62 - 0.05) * day) * (1 - dusk * 0.5) + 0.95 * dusk * 0.5
    const g = (0.06 + (0.78 - 0.06) * day) * (1 - dusk * 0.5) + 0.45 * dusk * 0.5
    const b = (0.12 + (0.95 - 0.12) * day) * (1 - dusk * 0.5) + 0.18 * dusk * 0.5
    this.horizon.setRGB(r, g, b)
    return day
  }
}
