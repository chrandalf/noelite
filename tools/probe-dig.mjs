// Needs the dev server. Usage: node tools/probe-dig.mjs [out.png]. Lands on home's first seam, presses
// U, and checks the dig shows: the auger out, the module filling on the ground, a spoil heap; then that
// the pod is aboard in its slot on the hull and the auger is home. Screenshots mid-dig.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++ }
await page.goto(`${BASE}/?seam=home:0&t=1000&sandbox=1&yaw=2.3&pitch=-0.15`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
await page.keyboard.press('KeyU')
// Game time crawls headless: wait on the dig's progress, not the clock.
await page.waitForFunction(() => globalThis.__noelite.digging() > 1.5, { timeout: 120000, polling: 100 })
const mid = await page.evaluate(() => { const n = globalThis.__noelite; return { dig: +n.digging().toFixed(2), auger: n.digger.group.visible, heaps: n.digger.heapCount(), module: n.modules[0].visible, scale: +n.modules[0].scale.x.toFixed(2), y: +n.modules[0].position.y.toFixed(2), cargo: n.craft.cargo.length, text: document.getElementById('cargo').textContent } })
console.log('mid  ', JSON.stringify(mid))
if (!mid.auger) fail('the auger should be out mid-dig')
if (mid.heaps !== 1) fail('one spoil heap should be growing')
if (!mid.module || mid.scale >= 1 || mid.y > -1) fail('the module should be filling on the ground, part-size')
await page.screenshot({ path: process.argv[2] ?? 'dig.png' })
await page.waitForFunction(() => globalThis.__noelite.craft.cargo.length === 1, { timeout: 120000, polling: 100 })
const end = await page.evaluate(() => { const n = globalThis.__noelite; return { auger: n.digger.group.visible, module: n.modules[0].visible, scale: +n.modules[0].scale.x.toFixed(2), y: +n.modules[0].position.y.toFixed(2), good: n.craft.cargo[0].good, text: document.getElementById('cargo').textContent } })
console.log('done ', JSON.stringify(end))
if (end.auger) fail('the auger should be home once the pod is aboard')
if (!end.module || end.scale !== 1 || end.y < 0.3) fail('the module should sit full size in its slot on top of the hull')
await browser.close(); process.exit(bad ? 1 : 0)
