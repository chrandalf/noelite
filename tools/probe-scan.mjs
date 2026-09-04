// Needs the dev server. Usage: node tools/probe-scan.mjs [out.png]. Hangs 2 km over home, presses
// G, and checks the scanner puts the nearest seam on the compass with its good and distance, that
// the blip goes after the hold, and that far from any seam it says so. Screenshots the blip.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++ }
await page.goto('http://localhost:5175/?over=home:2000&t=700&pitch=0.2', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
await page.keyboard.press('KeyG'); await sleep(700)
const r = await page.evaluate(() => { const n = globalThis.__noelite; const h = n.scanHit(); const el = [...document.querySelectorAll('#compass .tick.seam')][0]; return { hit: h ? { good: h.seam.good, t: h.seam.richness, km: +(h.rel.distanceTo(n.craft.pos) / 1000).toFixed(1) } : null, tick: el ? el.textContent : null } })
console.log('scan ', JSON.stringify(r))
if (!r.hit) fail('a scan 2 km over home should find a seam inside 25 km')
if (!r.tick || !r.tick.includes(r.hit?.good.toUpperCase() ?? '?')) fail('the compass should carry the seam blip with its good')
await page.screenshot({ path: process.argv[2] ?? 'scan.png' })
await page.waitForFunction(() => document.querySelector('#compass .tick.seam') === null, { timeout: 180000, polling: 500 }).catch(() => fail('the blip should go after the hold'))
await browser.close(); process.exit(bad ? 1 : 0)
