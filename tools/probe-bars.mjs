// Drives the opening: boots the ship, holds Space, and reads the letterbox against altitude.
// Needs the dev server. Usage: node tools/probe-bars.mjs [out.png]. Exits 1 if the bars are not
// full on the pad, ever grow while climbing, or are still there past 80 m; or if the arrival card
// does not name the body once the HUD is up, linger past the climb, or come up again at the moon.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
const read = () => page.evaluate(() => { const n = globalThis.__noelite; return { alt: +n.craft.altitude().toFixed(1), state: n.craft.state, bar: document.querySelector('.bar').style.height, phase: n.phase(), fuel: +n.craft.fuel.toFixed(1), thr: n.craft.thrusting, ctl: n.input.read().thrust } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(1500); const onPad = await read(); console.log('pad  ', onPad)
await page.keyboard.press('KeyW')
await page.waitForFunction(() => globalThis.__noelite.phase() === 'hover', { timeout: 180000, polling: 500 })   // game time runs slow headless
const booted = await read(); console.log('boot ', booted)
let bad = 0
// The arrival card: on with the body's name as the HUD finishes booting, off six game seconds later.
await sleep(2500)
const card = await page.evaluate(() => ({ on: document.getElementById('title').classList.contains('on'), name: document.querySelector('#title h1').textContent, line: document.querySelector('#title p').textContent }))
console.log('card ', card)
await page.screenshot({ path: (process.argv[2] ?? 'bars-open.png').replace(/\.png$/, '-card.png') })
if (!card.on || card.name !== 'Vale' || !card.line.includes('TERRESTRIAL')) { console.log('FAIL the arrival card should name Vale once the HUD is up'); bad++ }
if (parseFloat(onPad.bar) !== 11 || parseFloat(booted.bar) !== 11) { console.log('FAIL bars not full on the pad'); bad++ }
await page.keyboard.down('Space')
let last = 11, gone = null
const t0 = Date.now()
while (Date.now() - t0 < 300000) {
  await sleep(1000); const r = await read(); const vh = parseFloat(r.bar) || 0
  console.log(`+${((Date.now() - t0) / 1000).toFixed(0)}s alt=${r.alt} ${r.state} bar=${r.bar} ph=${r.phase}`)
  if (vh > last + 0.01 && r.state !== 'landed') { console.log('FAIL bars grew while climbing'); bad++ }
  last = vh
  if (vh === 0 && gone === null) gone = r.alt
  if (r.alt > 80 && vh > 0.02) { console.log('FAIL bars still in above 80 m'); bad++ }
  if (r.alt > 100) break
}
await page.keyboard.up('Space')
await page.screenshot({ path: process.argv[2] ?? 'bars-open.png' })
console.log(gone === null ? 'FAIL bars never opened' : `bars gone at ${gone} m`)
const cardLater = await page.evaluate(() => document.getElementById('title').classList.contains('on'))
if (cardLater) { console.log('FAIL the arrival card should have gone by the time you are 100 m up'); bad++ }
// Arriving at the moon gets its own card.
await page.goto('http://localhost:5175/?over=home-1:2000&t=700', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.titleBody?.() !== null, { timeout: 60000, polling: 250 })
const moon = await page.evaluate(() => ({ on: document.getElementById('title').classList.contains('on'), name: document.querySelector('#title h1').textContent, line: document.querySelector('#title p').textContent }))
console.log('moon ', moon)
if (!moon.on || moon.name !== 'Vale I' || !moon.line.includes('AIRLESS')) { console.log('FAIL the moon should get its own card'); bad++ }
await browser.close(); process.exit(bad || gone === null ? 1 : 0)
