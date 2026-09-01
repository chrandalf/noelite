#!/usr/bin/env node
// When is dawn, noon, dusk and midnight at a point on home? For ?t= in screenshots.
//   node tools/sun-times.mjs [x y z]   (direction in home's frame, default the +Z pad)
import * as THREE from 'three'
import { body, bodyPosition, bodySpin } from '../src/world/system.ts'
const [x = 0, y = 0, z = 1] = process.argv.slice(2).map(Number)
const up = new THREE.Vector3(x, y, z).normalize()
const home = body('home'), sun = body('sun')
const q = new THREE.Quaternion(), ph = new THREE.Vector3(), ps = new THREE.Vector3()
const elev = (t) => { bodyPosition(home, t, ph); bodyPosition(sun, t, ps); bodySpin(home, t, q).invert(); return up.dot(ps.sub(ph).applyQuaternion(q).normalize()) }
const samples = []
for (let t = 0; t < 1200; t++) samples.push({ t, e: elev(t) })
const noon = samples.reduce((a, b) => (b.e > a.e ? b : a)), midnight = samples.reduce((a, b) => (b.e < a.e ? b : a))
const crossings = samples.filter((p, i) => i > 0 && Math.sign(p.e) !== Math.sign(samples[i - 1].e))
console.log(`start elev ${samples[0].e.toFixed(2)}   noon t=${noon.t} (${noon.e.toFixed(2)})   midnight t=${midnight.t} (${midnight.e.toFixed(2)})   (home spins every ${home.spinPeriod} s)`)
for (const c of crossings) console.log(`  horizon crossing t=${c.t} (${samples[c.t - 1].e > 0 ? 'dusk' : 'dawn'})`)
