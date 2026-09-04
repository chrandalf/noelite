// Needs the dev server. Usage: node tools/probe-outposts.mjs. Exits 1 if the HUD's outpost marker
// does not name the nearest outpost in range, if one in range is not drawn, or one out of range is.
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'; import { readdirSync, existsSync } from 'node:fs'
const BASE = process.env.NOELITE_URL ?? 'http://localhost:5175'   // a second dev server (npm run dev -- --port 5176) for work alongside play
const chrome = () => { const d = join(process.env.HOME, '.cache/puppeteer/chrome'); for (const b of readdirSync(d).sort().reverse()) { const p = join(d, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p } }
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
let bad = 0
const urls = [BASE + '/?over=home:1000&t=700', BASE + '/?outpost=-3&t=700', BASE + '/?over=home-1:2000&t=700']
for (let k = 0; k < urls.length; k++) {
  const url = urls[k]
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 })
  await new Promise((r) => setTimeout(r, 1500))
  const r = await page.evaluate(() => {
    const n = globalThis.__noelite
    const list = n.outposts.map((ov) => ({ name: ov.o.name, body: ov.view.body.name, km: +(ov.rel.distanceTo(n.craft.pos) / 1000).toFixed(1), drawn: ov.group.visible }))
    const here = list.filter((o) => o.body === n.craft.ref.name).sort((a, b) => a.km - b.km)
    const el = document.querySelector('.nav.outpost')
    return { ref: n.craft.ref.name, nearest: here[0], drawn: list.filter((o) => o.drawn).map((o) => `${o.name} ${o.km} km`), marker: el.hidden ? null : el.textContent }
  })
  console.log(url.replace(BASE + '/', ''), JSON.stringify(r))
  // From over the third outpost, add a case 3 km above it so the marker path runs.
  if (k === 1) { const d = await page.evaluate(() => { const o = globalThis.__noelite.outposts.filter((ov) => ov.view.body.name === 'Vale')[2].o.site.dir; return `${o.x},${o.y},${o.z}` }); urls.push(`${BASE}/?over=home:3000:${d}&t=700`) }
  const near = r.nearest
  if (near && near.km < 40 && near.km > 0.3) {
    if (!r.marker || !r.marker.includes(near.name)) { console.log('FAIL marker does not name the nearest outpost'); bad++ }
    if (!near.drawn) { console.log('FAIL nearest outpost within 25 km is not drawn'); bad++ }
  } else if (r.marker) { console.log('FAIL marker shown with no outpost in range'); bad++ }
  if (r.drawn.some((d) => parseFloat(d.split(' ').at(-2)) > 40)) { console.log('FAIL an outpost beyond 40 km is drawn'); bad++ }
}
await browser.close(); process.exit(bad ? 1 : 0)
