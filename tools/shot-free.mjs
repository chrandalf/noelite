// Free-camera shot over the LOD test site. Usage: node tools/shot-free.mjs out.png <altitude m> [t seconds]
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import { height, HOME } from '../src/world/height.ts'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'   // a second dev server (npm run dev -- --port 5176) for work alongside play
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
function chrome() { const dir = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(dir).sort().reverse()) { const p = join(dir, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const [out, altStr, tStr = '600'] = process.argv.slice(2)
const alt = Number(altStr)
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
await page.setViewport({ width: 960, height: 600 })
await page.goto(`${BASE}/?mode=free&t=${tStr}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 200 })
const n = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l } }
const here = n(0.3, 0.2, 1), ahead = n(0.36, 0.22, 1)
const R = HOME.radius, r = R + height(here, HOME) + alt, ra = R + height(ahead, HOME)
await page.evaluate((p, a) => globalThis.__noelite.place(...p, ...a), [here.x * r, here.y * r, here.z * r], [ahead.x * ra, ahead.y * ra, ahead.z * ra])
await page.waitForFunction(() => globalThis.__noelite.ready(), { timeout: 90000, polling: 100 })
await new Promise((r) => setTimeout(r, 1500))
await page.screenshot({ path: out })
console.log('wrote', out)
await browser.close()
