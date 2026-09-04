// Needs the dev server. Usage: node tools/probe-loop.mjs [out.png]. The first loop in the browser:
// start landed on a seam, press U, a pod comes aboard and the seam remembers; then at an outpost
// with three pods, press U, the town pays and stocks it and the pause menu's TOWN block says so.
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
const go = async (url) => { await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 }); await sleep(500) }
const read = () => page.evaluate(() => { const n = globalThis.__noelite; const s = n.craft.seamHere(); return { state: n.craft.state, seam: s ? { good: s.good, t: s.richness } : null, cargo: n.craft.cargo.map((c) => `${c.good} ${c.tonnes}`), digging: n.digging(), cargoEl: document.getElementById('cargo').textContent, balance: Math.round(n.bank.balance), ledger: n.bank.ledger.map((e) => e.what), town: n.townHere()?.name ?? null, mass: +n.craft.massFactor().toFixed(2) } })

await go('/?seam=home:0&t=700&reset=1')
let r = await read(); console.log('seam   ', JSON.stringify(r))
if (r.state !== 'landed' || !r.seam) fail('should start landed on a seam')
if (!r.cargoEl.includes('ON SEAM')) fail('the panel should say ON SEAM')
const t0 = r.seam.t
await page.keyboard.press('KeyU'); await sleep(300)
r = await read()
if (!(r.digging >= 0) || !r.cargoEl.includes('DIGGING')) fail('U on a seam should start a dig')
await page.waitForFunction(() => globalThis.__noelite.craft.cargo.length === 1, { timeout: 300000, polling: 500 })
r = await read(); console.log('dug    ', JSON.stringify(r))
if (r.seam.t !== t0 - 4 || !r.cargoEl.includes('CARGO') || r.mass !== 1.33) fail('a pod of 4 t should be aboard, the seam 4 t down, the mass up a third')
await page.screenshot({ path: (process.argv[2] ?? 'loop.png').replace(/\.png$/, '-dig.png') })

await go('/?outpost=1&t=700')
await page.evaluate(() => { const c = globalThis.__noelite.craft; c.cargo.length = 0; c.load('timber'); c.load('timber'); c.load('salt') })
r = await read(); console.log('town   ', JSON.stringify(r))
if (!r.town) fail('should be landed at a town')
const before = r.balance
await page.keyboard.press('KeyU'); await sleep(400)
r = await read(); console.log('sold   ', JSON.stringify(r))
if (r.cargo.length !== 0 || !r.ledger.includes('SALE') || r.balance - before < 300) fail(`the sale should empty the hull and pay: ${before} → ${r.balance}`)
await page.keyboard.press('Escape'); await sleep(300)
const town = await page.evaluate(() => ({ hidden: document.getElementById('town').hidden, text: document.querySelector('#town pre').textContent }))
console.log('menu   ', JSON.stringify(town).slice(0, 300))
if (town.hidden || !town.text.includes('STOCK') || !town.text.includes('timber')) fail('the pause menu should show the town with timber in stock')
await page.screenshot({ path: process.argv[2] ?? 'loop.png' })
await browser.close(); process.exit(bad ? 1 : 0)
