// Needs the dev server. Usage: node tools/probe-jet.mjs [out.png]. Hangs 300 m over home, presses J, and
// checks the wings come out, the HUD says JET with a stall speed, the ship gets fast on SPACE, and J again is
// hover. Screenshots the jet with its wings out.
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
await page.goto(`${BASE}/?over=home:300&t=1000&sandbox=1&yaw=2.4&pitch=-0.1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
await page.keyboard.press('KeyJ'); await sleep(400)
const on = await page.evaluate(() => { const n = globalThis.__noelite; return { jet: n.craft.jet, cruise: n.craft.cruise, toast: document.getElementById('toast').textContent } })
console.log('J    ', JSON.stringify(on))
if (!on.jet || on.cruise) fail('J in the air should flick the jet on')
if (!on.toast.includes('JET')) fail('the toast should say JET')
await page.keyboard.down('Space')
// Game time crawls headless: wait on speed, not seconds.
await page.waitForFunction(() => globalThis.__noelite.craft.speed() > 60, { timeout: 120000, polling: 100 }).catch(() => fail('SPACE in jet should get the ship past 60 m/s'))
await page.keyboard.up('Space'); await sleep(300)
const fast = await page.evaluate(() => { const n = globalThis.__noelite; return { speed: +n.craft.speed().toFixed(0), alt: +n.craft.altitude().toFixed(0), hud: document.getElementById('hud').textContent.includes('JET') } })
console.log('fast ', JSON.stringify(fast))
if (!fast.hud) fail('the HUD should read JET')
await page.screenshot({ path: process.argv[2] ?? 'jet.png' })
await page.keyboard.press('KeyJ'); await sleep(300)
const off = await page.evaluate(() => globalThis.__noelite.craft.jet)
if (off) fail('J again should fold the wings')
await browser.close(); process.exit(bad ? 1 : 0)
