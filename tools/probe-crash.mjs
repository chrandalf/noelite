// Needs the dev server. Usage: node tools/probe-crash.mjs [outdir]. Drops the ship with the assist
// off three ways (12 m onto the pad, 12 m into the sea, 3.5 m onto the pad) and checks the game's
// side of a crash: the wreck's six pieces in the scene and at rest, the ship hidden then back after
// the respawn with the wreck still there, SUNK in water, GEAR BENT and a cracked panel after a
// hard landing. Writes crash-fire.png, crash-settled.png, crash-sunk.png, crash-bent.png.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const out = process.argv[2] ?? '.'
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const fail = (m) => { console.log('FAIL ' + m); bad++ }
// No wait for the LOD here: the drop starts on the first frame and the hold runs on game time.
const go = async (url) => { await page.goto('http://localhost:5175/' + url, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => globalThis.__noelite !== undefined, { timeout: 30000, polling: 100 }) }
const ready = () => page.waitForFunction(() => globalThis.__noelite.ready() === true, { timeout: 90000, polling: 250 }).catch(() => console.error('WARN: LOD queue did not drain'))
const state = () => page.evaluate(() => globalThis.__noelite.craft.state)
const read = () => page.evaluate(() => { const n = globalThis.__noelite; const w = n.wrecks.at(-1); return { state: n.craft.state, sunk: n.craft.sunk, damage: +n.craft.damage.toFixed(2), gearBent: n.craft.gearBent, shipVisible: n.ship.visible, wrecks: n.wrecks.length, pieces: w ? w.wreck.pieces.length : 0, settled: w ? w.wreck.settled() : null, inScene: w ? w.meshes.every((m) => m.parent !== null) : null, alt: document.getElementById('alt-state').textContent, hull: document.getElementById('hull').textContent, cracked: document.getElementById('altimeter').classList.contains('cracked') } })
const SEA = '-0.052659224122651616,-0.08330237947957568,0.9951320111863758'

await go('?over=home:12&assist=0&t=700')
await page.waitForFunction(() => globalThis.__noelite.craft.state === 'crashed', { timeout: 60000, polling: 100 })
await sleep(300)
await page.screenshot({ path: join(out, 'crash-fire.png') })   // the planet may still be building; the fireball is the point
let r = await read(); console.log('wreck   ', JSON.stringify(r))
if (r.wrecks !== 1 || r.pieces !== 6) fail('a ground wreck should leave one wreck of six pieces')
if (r.shipVisible) fail('the ship should be hidden while its wreck is on the ground')
if (r.alt !== 'WRECKED') fail(`altimeter should say WRECKED, says ${r.alt}`)
if (r.sunk) fail('a pad crash is not sunk')
await page.waitForFunction(() => globalThis.__noelite.wrecks.at(-1).wreck.settled(), { timeout: 60000, polling: 200 }).catch(() => fail('the pieces should come to rest'))
await ready()
await page.screenshot({ path: join(out, 'crash-settled.png') })
r = await read(); console.log('settled ', JSON.stringify(r))
if (r.state !== 'crashed') fail('the camera should still be holding on the wreck when the pieces settle')
await page.waitForFunction(() => globalThis.__noelite.craft.state !== 'crashed', { timeout: 120000, polling: 200 }).catch(() => fail('no respawn inside 120 s'))
await sleep(300)
r = await read(); console.log('respawn ', JSON.stringify(r))
if (!r.shipVisible) fail('the ship should be back after the respawn')
if (r.wrecks !== 1 || !r.inScene) fail('the wreck should persist after the respawn')
if (r.damage !== 0 || r.gearBent) fail('a respawn is a fresh hull')

await go(`?over=home:12:${SEA}&assist=0&t=700`)
await page.waitForFunction(() => globalThis.__noelite.craft.state === 'crashed', { timeout: 60000, polling: 100 })
await sleep(2500); await ready()
await page.screenshot({ path: join(out, 'crash-sunk.png') })
r = await read(); console.log('sunk    ', JSON.stringify(r))
if (!r.sunk || r.alt !== 'SUNK') fail(`a sea crash should be SUNK, got ${r.alt}`)
if (r.wrecks !== 0) fail('a sinking leaves no debris')

await go('?over=home:3.5&assist=0&t=700')
await page.waitForFunction(() => globalThis.__noelite.craft.state !== 'flying', { timeout: 60000, polling: 100 })
await sleep(600); await ready()
await page.screenshot({ path: join(out, 'crash-bent.png') })
r = await read(); console.log('bent    ', JSON.stringify(r))
if (r.state !== 'landed' || !r.gearBent) fail('a 3.5 m drop should be a hard landing with bent gear')
if (!r.hull.includes('GEAR BENT') || !r.cracked) fail('the HUD should show GEAR BENT on a cracked panel')
await browser.close(); process.exit(bad ? 1 : 0)
