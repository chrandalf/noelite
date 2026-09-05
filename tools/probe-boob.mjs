// Needs the dev server. Usage: node tools/probe-boob.mjs [out.png]. Three looks at the boob
// (DESIGN §10i): the free camera 220 m off it for the picture; a ship a kilometre off pressing G,
// which should put UNKNOWN CONTACT on the compass; a ship inside its sight, which should name it.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
import * as THREE from 'three'
import { boobDir, BOOB_RADIUS, BOOB_ALT } from '../src/world/boob.ts'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++ }
const ready = () => page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
// Home's day is 2,400 s and the pad's noon is about 700; the boob starts on the far side, so its noon is half a day on.
const T = 1900
// A point on the ground `m` metres from under the boob, along a tangent, as a direction.
const beside = (m) => { const d = boobDir(T); const ax = Math.abs(d.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0); const tg = new THREE.Vector3().crossVectors(ax, d).normalize(); return d.clone().addScaledVector(tg, m / 40000).normalize() }

// 1. The picture: free camera, 220 m off the skin, a shade above its middle, looking at it.
await page.goto(`${BASE}/?mode=free&t=${T}`, { waitUntil: 'domcontentloaded' }); await ready()
const at = await page.evaluate(() => { const n = globalThis.__noelite; const b = n.boob; const f = { x: 0, y: 0, z: 1 }; const q = n.boobView.group.quaternion; const fx = f.x + 2 * (q.y * (q.x * f.y - q.y * f.x + q.w * f.z) - q.z * (q.z * f.x - q.x * f.z + q.w * f.y)); const fy = f.y + 2 * (q.z * (q.y * f.z - q.z * f.y + q.w * f.x) - q.x * (q.x * f.y - q.y * f.x + q.w * f.z)); const fz = f.z + 2 * (q.x * (q.z * f.x - q.x * f.z + q.w * f.y) - q.y * (q.y * f.z - q.z * f.y + q.w * f.x)); return { pos: [b.pos.x, b.pos.y, b.pos.z], fwd: [fx, fy, fz] } })
const bp = new THREE.Vector3(...at.pos), up = bp.clone().normalize()
if (Math.abs(bp.length() - 40000 - BOOB_ALT) > 400) fail(`the boob should hang about ${BOOB_ALT} m over home, it is at ${(bp.length() - 40000).toFixed(0)} m`)
// In front of it: along the group's +z, where the nipple is.
const side = new THREE.Vector3(...at.fwd).normalize()
const cam = bp.clone().addScaledVector(side, BOOB_RADIUS + 220).addScaledVector(up, 30)
await page.evaluate((c, a) => globalThis.__noelite.place(c[0], c[1], c[2], a[0], a[1], a[2]), cam.toArray(), bp.toArray())
await ready(); await sleep(500)
await page.screenshot({ path: process.argv[2] ?? 'boob.png' })
console.log('picture ', process.argv[2] ?? 'boob.png')

// 2. A kilometre off, G: the compass carries the contact, unnamed.
const d1 = beside(1000)
await page.goto(`${BASE}/?over=home:${BOOB_ALT}:${d1.x},${d1.y},${d1.z}&t=${T}`, { waitUntil: 'domcontentloaded' }); await ready()
await page.keyboard.press('KeyG'); await sleep(700)
const r1 = await page.evaluate(() => { const n = globalThis.__noelite; const el = document.querySelector('#compass .tick.contact'); return { scan: n.scanBoob(), tick: el ? el.textContent : null, dist: +n.boob.distance(n.craft.pos).toFixed(0) } })
console.log('1 km ', JSON.stringify(r1))
if (!r1.scan || !r1.tick) fail('a scan a kilometre from the boob should put it on the compass')
if (r1.tick && !r1.tick.includes('UNKNOWN CONTACT')) fail(`unseen, it is an UNKNOWN CONTACT, not "${r1.tick}"`)

// 3. Inside its sight: it names itself, and G now says so.
const d2 = beside(BOOB_RADIUS + 250)
await page.goto(`${BASE}/?over=home:${BOOB_ALT}:${d2.x},${d2.y},${d2.z}&t=${T}`, { waitUntil: 'domcontentloaded' }); await ready(); await sleep(400)
await page.keyboard.press('KeyG'); await sleep(700)
const r2 = await page.evaluate(() => { const n = globalThis.__noelite; const el = document.querySelector('#compass .tick.contact'); return { tick: el ? el.textContent : null, dist: +n.boob.distance(n.craft.pos).toFixed(0), toast: document.getElementById('toast')?.textContent ?? '' } })
console.log('close', JSON.stringify(r2))
if (!r2.tick || !r2.tick.includes('THE BOOB')) fail(`inside its sight it should be THE BOOB on the compass, got "${r2.tick}"`)
await browser.close(); process.exit(bad ? 1 : 0)
