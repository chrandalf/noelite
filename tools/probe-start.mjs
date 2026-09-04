// Needs the dev server. Usage: node tools/probe-start.mjs [out.png]. The start menu: a plain URL shows
// the starfield and holds the game; with no save the cursor sits on NEW GAME and Enter starts the
// opening; DEMO goes to a sandbox that saves nothing; with a save, CONTINUE is offered first and
// Enter loads it onto its pad.
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
const go = async (url) => { await page.goto(BASE + url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 }); await sleep(600) }
const read = () => page.evaluate(() => { const n = globalThis.__noelite; const on = document.querySelector('#start li.on'); return { starting: n.starting(), shown: !document.getElementById('start').hidden, on: on ? on.dataset.choice : null, cont: document.querySelector('#start li[data-choice=continue]').className, phase: n.phase(), time: +n.craft.time.toFixed(1), sandbox: n.sandbox(), saved: localStorage.getItem('noelite.save') !== null } })

await page.goto(BASE + '/?reset=1', { waitUntil: 'domcontentloaded' }); await sleep(800)   // wipe any save from an earlier probe
await go('/')
let r = await read(); console.log('fresh ', JSON.stringify(r))
if (!r.starting || !r.shown) fail('a plain URL should show the start menu')
if (r.on !== 'new' || !r.cont.includes('off')) fail('with no save the cursor should sit on NEW GAME and CONTINUE be greyed')
await page.screenshot({ path: process.argv[2] ?? 'start.png' })
const t0 = r.time; await sleep(1500); r = await read()
if (r.time !== t0) fail('the game should be frozen behind the menu')
await page.keyboard.press('ArrowDown'); await sleep(100); r = await read()
if (r.on !== 'demo') fail('ArrowDown should move to DEMO')
await page.keyboard.press('ArrowUp'); await sleep(100)
await page.keyboard.press('Enter'); await sleep(500); r = await read(); console.log('new   ', JSON.stringify(r))
if (r.starting || r.shown || r.phase !== 'dark') fail('Enter on NEW GAME should drop the menu and start the opening')

await page.goto(BASE + '/?reset=1', { waitUntil: 'domcontentloaded' }); await sleep(800)   // a new game left on the pad saves itself within five seconds
await go('/'); await page.keyboard.press('ArrowDown'); await sleep(100)
await page.keyboard.press('Enter'); await sleep(600)
r = await read(); const dm = await page.evaluate(() => globalThis.__noelite.demo())
console.log('demo  ', JSON.stringify({ demo: dm, sandbox: r.sandbox, saved: r.saved, starting: r.starting }))
if (!dm || !r.sandbox || r.starting) fail('DEMO should start the demo in place, in a sandbox')
await page.waitForFunction(() => globalThis.__noelite.craft.time > 700 + 6, { timeout: 120000, polling: 250 }).catch(() => {})
r = await read(); if (r.saved) fail('the sandbox should never write a save')

await go('/?fuel=20&t=700'); await page.waitForFunction(() => localStorage.getItem('noelite.save') !== null, { timeout: 60000, polling: 250 })
await go('/')
r = await read(); console.log('saved ', JSON.stringify(r))
if (r.on !== 'continue' || r.cont.includes('off')) fail('with a save CONTINUE should be first and live')
await page.keyboard.press('Enter'); await sleep(500); r = await read()
const where = await page.evaluate(() => ({ state: globalThis.__noelite.craft.state, pad: globalThis.__noelite.craft.padHere() !== null }))
if (r.starting || !where.pad || where.state !== 'landed') fail('CONTINUE should load you onto your pad')
await browser.close(); process.exit(bad ? 1 : 0)
