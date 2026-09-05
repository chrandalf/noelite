// Needs the dev server. Usage: node tools/probe-streaks.mjs [out.png]. Hangs 60 km over home (vacuum, cruise),
// shoves the ship to 20 km/s along its nose, and checks the warp streaks come up and were off before. Screenshots.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++ }
await page.goto(`${BASE}/?over=home:60000&t=1000&sandbox=1&pitch=0.3`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
await sleep(800)
const before = await page.evaluate(() => { const n = globalThis.__noelite; return { cruise: n.craft.cruise, streaks: n.streaks.lines.visible, level: +n.streaks.level.toFixed(2) } })
console.log('still', JSON.stringify(before))
if (!before.cruise) fail('60 km up should be cruise')
if (before.streaks) fail('at rest there should be no streaks')
await page.evaluate(() => { const n = globalThis.__noelite; const T = globalThis.THREE_FOR_PROBE; const nose = n.craft.quat; const v = { x: 0, y: 0, z: -1 }; const q = nose; const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z; const d = { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x }; const vel = n.craft.vel.clone().set(d.x * 20000, d.y * 20000, d.z * 20000); n.craft.shove(n.craft.pos, vel); void T })
await sleep(1500)
const after = await page.evaluate(() => { const n = globalThis.__noelite; return { speed: +n.craft.speed().toFixed(0), streaks: n.streaks.lines.visible, level: +n.streaks.level.toFixed(2), opacity: +n.streaks.lines.material.opacity.toFixed(2) } })
console.log('fast ', JSON.stringify(after))
if (!after.streaks || after.level < 0.15) fail('at cruise speed in vacuum the streaks should be up')   // the cap holds the shove to what the height allows, ~8 km/s here
await page.screenshot({ path: process.argv[2] ?? 'streaks.png' })
await browser.close(); process.exit(bad ? 1 : 0)
