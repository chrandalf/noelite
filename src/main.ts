// Scaffold only. Proves the flat-shaded pipeline renders and nothing else.
// Step 1 of the build order (cube-sphere with quadtree LOD) replaces this file.
import * as THREE from 'three'

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // Orbit-to-ground spans many orders of magnitude. This is what stops the
  // depth buffer tearing itself apart at range.
  logarithmicDepthBuffer: true,
})
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0a12)

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1e7)
camera.position.set(0, 1.4, 4)

// One hard directional, one weak ambient. That is the whole lighting rig.
scene.add(new THREE.DirectionalLight(0xfff4e0, 2.6).translateOnAxis(new THREE.Vector3(1, 1, 0.6).normalize(), 10))
scene.add(new THREE.AmbientLight(0x4a5a7a, 0.55))

// The facet trick: non-indexed geometry, THEN recomputed normals, so every
// triangle keeps its own flat normal instead of averaging with its neighbours.
const geom = new THREE.IcosahedronGeometry(1.2, 2).toNonIndexed()
geom.computeVertexNormals()

const mesh = new THREE.Mesh(
  geom,
  new THREE.MeshLambertMaterial({ color: 0x5fbf5a, flatShading: true }),
)
scene.add(mesh)

const hud = document.getElementById('hud')!
hud.textContent = 'noelite // scaffold // flat-shaded pipeline live'

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop((t) => {
  mesh.rotation.y = t * 0.0004
  mesh.rotation.x = Math.sin(t * 0.0002) * 0.3
  renderer.render(scene, camera)
})
