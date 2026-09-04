// Needs the dev server. Usage: node tools/probe-bank.mjs [out.png]. Starts on the pad with a
// fifth of a tank and fresh books, and checks: the panel shows the balance, refuelling is
// charged and booked as FUEL, the pause menu lists it, ] borrows 500, and the company survives
// a reload. Screenshots the pause menu with the ledger.
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
const read = () => page.evaluate(() => { const b = globalThis.__noelite.bank; return { balance: +b.balance.toFixed(1), loan: b.loan, ledger: b.ledger.map((e) => `${e.what} ${Math.round(e.amount)}`), panel: document.getElementById('bank').textContent, fuel: +globalThis.__noelite.craft.fuel.toFixed(1), time: +globalThis.__noelite.craft.time.toFixed(1) } })

await page.goto(BASE + '/?fuel=20&t=700&reset=1', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 })
await sleep(500)
const start = await read(); console.log('start ', JSON.stringify(start))
if (start.balance > 2000 || start.balance < 1980 || start.loan !== 2000 || !start.panel.includes('LOAN 2,000 cr')) fail('fresh books should show about 2,000 cr and a 2,000 loan')
await page.waitForFunction(() => globalThis.__noelite.craft.time > 700 + 8, { timeout: 120000, polling: 250 })
const later = await read(); console.log('later ', JSON.stringify(later))
const fuelSold = later.fuel - 20
if (!(fuelSold > 20)) fail('the pad should have sold fuel by now')
await page.waitForFunction(() => globalThis.__noelite.craft.fuel >= 100, { timeout: 120000, polling: 250 }); await sleep(800)
const full = await read(); console.log('full  ', JSON.stringify({ balance: full.balance, ledger: full.ledger }))
const fuelLines = full.ledger.filter((l) => l.startsWith('FUEL'))
if (fuelLines.length !== 1) fail(`one fill should be one FUEL line, got ${fuelLines.length}`)
if (!(Math.abs(full.ledger.find((l) => l.startsWith('FUEL')).split(' ')[1]) > 140)) fail('the FUEL line should be the whole fill, about 160 cr')
const charged = 2000 - later.balance
if (!(charged > fuelSold * 2 * 0.8 && charged < fuelSold * 2 * 1.2 + 2)) fail(`charge ${charged.toFixed(1)} should be about 2 cr a unit for ${fuelSold.toFixed(1)} units`)
await page.keyboard.press('Escape'); await sleep(300)
const menu = await page.evaluate(() => ({ shown: !document.getElementById('menu').hidden, text: document.querySelector('#company pre').textContent }))
if (!menu.shown || !menu.text.includes('FUEL') || !menu.text.includes('BALANCE')) fail('the pause menu should show the company with the FUEL line')
await page.keyboard.press('BracketRight'); await sleep(200)
const borrowed = await read()
if (borrowed.loan !== 2500 || Math.round(borrowed.balance - full.balance) < 490) fail('] should borrow 500')
await page.screenshot({ path: process.argv[2] ?? 'bank.png' })
await page.keyboard.press('Escape')
await sleep(6000)   // past the 5 s save
await page.goto(BASE + '/?fuel=20&t=700', { waitUntil: 'domcontentloaded' })   // no reset this time
await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 })
const after = await read(); console.log('reload', JSON.stringify({ balance: after.balance, loan: after.loan, ledger: after.ledger.length }))
if (after.loan !== 2500 || after.ledger.length < 2) fail('the company should survive a reload')
await browser.close(); process.exit(bad ? 1 : 0)
