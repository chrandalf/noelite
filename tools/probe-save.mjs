// Needs the dev server. Usage: node tools/probe-save.mjs. Checks the save in the browser: a
// fresh start saves itself on the pad and a plain URL loads it (no opening); a wreck costs the
// insurance excess, puts you back on the nearest pad and survives a reload; a landing on an
// outpost is saved and loads you back there.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'   // a second dev server (npm run dev -- --port 5176) for work alongside play
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0; const fail = (m) => { console.log('FAIL ' + m); bad++ }
const go = async (url) => { await page.goto(BASE + '/' + url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 }) }
const read = () => page.evaluate(() => { const n = globalThis.__noelite; const h = n.craft.padHere(); return { state: n.craft.state, phase: n.phase(), ref: n.craft.ref.name, pad: h ? (h.outpost ? h.outpost.name : h.station ? `station ${h.pad}` : 'home pad') : 'none', fuel: +n.craft.fuel.toFixed(1), balance: +n.bank.balance.toFixed(0), loan: n.bank.loan, ledger: n.bank.ledger.map((e) => e.what), wrecks: n.wrecks.length, saved: localStorage.getItem('noelite.save') !== null, save: document.querySelector('#company .save').textContent } })
const untilTime = (t) => page.waitForFunction((t) => globalThis.__noelite.craft.time > t, { timeout: 180000, polling: 250 }, t)

await go('?reset=1&fuel=30&t=700')
await untilTime(707)   // past the periodic save
let r = await read(); console.log('fresh  ', JSON.stringify(r))
if (!r.saved) fail('a landed ship should have saved itself by now')
await go('')
await sleep(800)
r = await read(); console.log('loaded ', JSON.stringify(r))
if (r.phase !== 'off') fail('a plain URL with a save should skip the opening')
if (r.state !== 'landed' || r.pad !== 'home pad') fail(`should load landed on the home pad, got ${r.state} on ${r.pad}`)
if (r.balance > 2000 || r.balance < 1700) fail('the books should have come back with the fuel charged')
if (!r.save.includes('the home pad')) fail('the menu should say where the last save was')

await go('?over=home:12&assist=0&t=700')
await page.waitForFunction(() => globalThis.__noelite.craft.state === 'crashed', { timeout: 60000, polling: 100 })
const before = await read()
await page.waitForFunction(() => globalThis.__noelite.craft.state !== 'crashed', { timeout: 180000, polling: 200 })
await sleep(500)
r = await read(); console.log('respawn', JSON.stringify(r))
if (!r.ledger.includes('INSURANCE') || before.balance - r.balance !== 500) fail(`a wreck should cost the 500 excess, balance went ${before.balance} → ${r.balance}`)
if (r.state !== 'landed' || r.pad !== 'home pad' || r.wrecks !== 1) fail('after a wreck over the pad you should be back on it with the wreck left')
await go('')
await sleep(800)
r = await read(); console.log('reload ', JSON.stringify(r))
if (r.wrecks !== 1 || !r.ledger.includes('INSURANCE')) fail('the wreck and the excess should survive a reload')

await go('?outpost=2&t=700')
await untilTime(707)
await go('')
await sleep(800)
r = await read(); console.log('outpost', JSON.stringify(r))
if (r.state !== 'landed' || !r.pad.includes('Outpost')) fail(`a save on an outpost should load there, got ${r.pad}`)
if (r.wrecks !== 1) fail('the wreck should still be there')
await browser.close(); process.exit(bad ? 1 : 0)
