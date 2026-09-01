#!/usr/bin/env node
// When is dawn, noon, dusk and midnight at a point? For ?t= in screenshots.
//   node tools/sun-times.mjs [x y z]   (direction, default the +Z pad)
import * as THREE from 'three'
import { sunDirection } from '../src/world/sun.ts'
import { DAY_LENGTH } from '../src/world/config.ts'
const [x = 0, y = 0, z = 1] = process.argv.slice(2).map(Number)
const up = new THREE.Vector3(x, y, z).normalize(), s = new THREE.Vector3()
const samples = []
for (let t = 0; t < DAY_LENGTH; t++) samples.push({ t, e: up.dot(sunDirection(t, s)) })
const noon = samples.reduce((a, b) => (b.e > a.e ? b : a)), midnight = samples.reduce((a, b) => (b.e < a.e ? b : a))
const crossings = samples.filter((p, i) => i > 0 && Math.sign(p.e) !== Math.sign(samples[i - 1].e))
console.log(`start elev ${samples[0].e.toFixed(2)}   noon t=${noon.t} (${noon.e.toFixed(2)})   midnight t=${midnight.t} (${midnight.e.toFixed(2)})`)
for (const c of crossings) console.log(`  horizon crossing t=${c.t} (${samples[c.t - 1].e > 0 ? 'dusk' : 'dawn'})`)
