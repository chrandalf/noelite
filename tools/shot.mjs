// Headless screenshot of the running dev server. Borrows puppeteer from a sibling
// repo for now; same arrangement night-shift uses. Usage: node tools/shot.mjs out.png [url]
import { createRequire } from 'node:module'
const require = createRequire('/mnt/c/Users/chris/code/80sadventure/package.json')
const puppeteer = require('puppeteer')
import { join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'

// puppeteer pins a Chrome build it never installed. Use the newest one actually on the box.
function chrome() {
  const dir = join(process.env.HOME, '.cache/puppeteer/chrome')
  for (const b of readdirSync(dir).sort().reverse()) {
    const p = join(dir, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p
  }
}

const [out = 'shot.png', url = 'http://localhost:5175/'] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: chrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.setViewport({ width: 960, height: 600 })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()) })
await page.goto(url, { waitUntil: 'domcontentloaded' })
// A Vite error overlay means the app never ran. Say so, loudly, instead of photographing it.
await new Promise((r) => setTimeout(r, 600))
if (await page.$('vite-error-overlay')) {
  const msg = await page.evaluate(() => document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message')?.textContent ?? '')
  console.error('VITE ERROR OVERLAY:', msg.trim().slice(0, 300))
  await browser.close()
  process.exit(2)
}
// Let the LOD queue drain so the picture is of the finished planet, not the build.
await page.waitForFunction(() => globalThis.__noelite?.ready?.() === true, { timeout: 90000, polling: 250 }).catch(() => console.error('WARN: LOD queue did not drain in 90s'))
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: out })
await browser.close()
console.log('wrote', out)
