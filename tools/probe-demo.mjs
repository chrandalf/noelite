// Needs the dev server. Usage: node tools/probe-demo.mjs [out.png]. ?demo=1 starts the demo: the
// ship lifts off on its own, the caption names the keys it is pressing and where it is going, and a
// key press hands the ship back. (The full loop is the flight harness's job; game time crawls headless.)
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
await page.goto(BASE + '/?demo=1&t=700&reset=1', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.demo?.() === true, { timeout: 60000, polling: 200 })
await page.waitForFunction(() => globalThis.__noelite.craft.altitude() > 20, { timeout: 180000, polling: 250 })
const r = await page.evaluate(() => { const n = globalThis.__noelite; return { alt: +n.craft.altitude().toFixed(0), step: n.demoStep(), leg: n.pilot.leg, caption: document.getElementById('demo').textContent, hidden: document.getElementById('demo').hidden } })
console.log('demo ', JSON.stringify(r))
if (r.hidden || !r.caption.includes('DEMO') || !r.caption.includes('SPACE')) fail('the caption should be up and name SPACE while lifting')
if (!r.caption.includes('seam')) fail('the caption should say where it is going')
await page.screenshot({ path: process.argv[2] ?? 'demo.png' })
await page.keyboard.press('KeyW'); await sleep(300)
const after = await page.evaluate(() => ({ demo: globalThis.__noelite.demo(), hidden: document.getElementById('demo').hidden, override: globalThis.__noelite.input.override }))
if (after.demo || !after.hidden || after.override !== null) fail('a key should hand the ship back')
await browser.close(); process.exit(bad ? 1 : 0)
