#!/usr/bin/env node
// LOD instrument. Drives the running dev server through a scripted descent
// from orbit to the deck and asserts what DESIGN.md §6 promises: the live
// chunk count stays bounded, the finest level is reached on the ground, the
// coarsest is used in orbit, and the tree is stable at rest (no flicker).
//
//   node tools/verify-lod.mjs [${BASE}/]
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import { height, HOME } from '../src/world/height.ts'
import { MAX_LEVEL } from '../src/world/lod.ts'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'   // a second dev server (npm run dev -- --port 5176) for work alongside play

const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
function chrome() {
  const dir = join(process.env.HOME, '.cache/puppeteer/chrome')
  for (const b of readdirSync(dir).sort().reverse()) { const p = join(dir, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p }
}

const base = process.argv[2] ?? BASE + '/'
const url = base + (base.includes('?') ? '&' : '?') + 'mode=free'
const MAX_CHUNKS = 400
const R = HOME.radius
let pass = 0, fail = 0
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`) } else { fail++; console.log(`  FAIL ${name}  ${detail}`) } }

const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.setViewport({ width: 800, height: 500 })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 200 })

// Descent along one direction, looking ahead along the surface.
const n = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l } }
const here = n(0.3, 0.2, 1), ahead = n(0.36, 0.22, 1)
const hHere = height(here, HOME), hAhead = height(ahead, HOME)
const profile = [70000, 40000, 20000, 10000, 5000, 2400, 1200, 500, 160, 40, 8, 2] // 20x the 2 km profile; orbit to deck
let worst = 0
for (const alt of profile) {
  const r = R + hHere + alt
  const t0 = Date.now()
  await page.evaluate((p, a) => globalThis.__noelite.place(...p, ...a), [here.x * r, here.y * r, here.z * r], [ahead.x * (R + hAhead), ahead.y * (R + hAhead), ahead.z * (R + hAhead)])
  await page.waitForFunction(() => globalThis.__noelite.ready(), { timeout: 90000, polling: 100 })
  const built = Date.now() - t0
  const a = await page.evaluate(() => { const p = globalThis.__noelite.planet; return { live: p.liveCount, range: p.levelRange(), alt: globalThis.__noelite.altitude() } })
  await new Promise((res) => setTimeout(res, 400))
  const b = await page.evaluate(() => globalThis.__noelite.planet.liveCount)
  worst = Math.max(worst, a.live)
  check(`alt ${String(alt).padStart(4)} m: ${String(a.live).padStart(3)} chunks, lod ${a.range[0]}..${a.range[1]}, built in ${built} ms`, a.live <= MAX_CHUNKS && a.live === b, a.live !== b ? `UNSTABLE ${a.live} → ${b}` : '')
  if (alt === profile[0]) check('orbit uses level 0', a.range[0] === 0, `min level ${a.range[0]}`)
  if (alt === profile[profile.length - 1]) check(`deck reaches level ${MAX_LEVEL}`, a.range[1] === MAX_LEVEL, `max level ${a.range[1]}`)
}
check(`live chunks never exceed ${MAX_CHUNKS}`, worst <= MAX_CHUNKS, `peak ${worst}`)
check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
console.log(`\n${pass}/${pass + fail} checks`)
process.exit(fail ? 1 : 0)
