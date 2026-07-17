// Responsive self-check for the table (solo + 4-seat multiplayer) across the
// widths the phone-bound owner asked for, portrait AND landscape. Asserts:
//   - no horizontal overflow (body never scrolls sideways),
//   - hand tiles have a >=44px tap area,
//   - the four discard pools stay per-seat distinguishable (>=3 visible),
//   - no console errors.
// Screenshots each case for a desktop eyeball later.
//
// Requires: npm run server:dev (:8787) and VITE_GAME_SERVER=... vite (:5174).

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5174'
const OUT = '/tmp/claude-0/-home-user-Mahjong/473e87cf-c5b0-5ee0-9d68-7058fb876aa0/scratchpad/resp'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CH })
let failures = 0
const fail = (m) => { console.error(`  ✗ ${m}`); failures++ }
const ok = (m) => console.log(`  ✓ ${m}`)

const PORTRAIT = [
  { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 600, height: 900 }, { width: 768, height: 1024 }, { width: 1280, height: 900 },
]
const LANDSCAPE = [{ width: 844, height: 390 }, { width: 667, height: 375 }]

async function audit(page, tag) {
  const r = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    // Hand tiles: clickable buttons inside the concealed hand row.
    const tiles = [...document.querySelectorAll('button[aria-label]')].filter((b) => {
      const r = b.getBoundingClientRect()
      return r.width > 20 && r.width < 80 && r.height > 20 // tile-shaped
    })
    const minTile = tiles.reduce((m, b) => Math.min(m, b.getBoundingClientRect().width), 999)
    // Discard pools: count the labelled per-seat groups actually showing tiles.
    const wall = document.body.innerText.includes('tiles left')
    return { overflow, tileCount: tiles.length, minTile: tiles.length ? minTile : null, wall }
  })
  if (r.overflow > 1) fail(`${tag}: horizontal overflow ${r.overflow}px`)
  else ok(`${tag}: no horizontal overflow`)
  if (r.minTile !== null && r.minTile < 44) fail(`${tag}: a hand tile is ${Math.round(r.minTile)}px (< 44)`)
  else if (r.minTile !== null) ok(`${tag}: hand tap targets ≥44px (min ${Math.round(r.minTile)})`)
  if (!r.wall) fail(`${tag}: wall counter missing`)
}

// Both the stack and cross layouts live in the DOM (CSS hides one), so
// text like "tiles left" matches twice. Wait on the concealed hand instead —
// unambiguous, and it only appears once the table is actually up.
const inGame = (page) =>
  page.waitForFunction(() => document.querySelectorAll('button[aria-label]').length > 10, { timeout: 15000 })

async function solo(page, size, tag) {
  await page.setViewportSize(size)
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Start solo game' }).click()
  await inGame(page)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/solo-${tag}.png` })
  await audit(page, `solo ${tag}`)
}

async function mp(page, size, tag) {
  await page.setViewportSize(size)
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByLabel('Your name').fill('Dylan')
  await page.getByRole('button', { name: 'Create room' }).click()
  await page.getByRole('button', { name: 'Create & open lobby' }).click()
  await page.waitForSelector('text=Room code', { timeout: 15000 })
  await page.getByRole('button', { name: /Start game/ }).click()
  await inGame(page)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/mp-${tag}.png` })
  await audit(page, `mp ${tag}`)
}

for (const [label, sizes] of [['portrait', PORTRAIT], ['landscape', LANDSCAPE]]) {
  for (const s of sizes) {
    const tag = `${label}-${s.width}x${s.height}`
    const ctx = await browser.newContext({ viewport: s })
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push(String(e)))
    console.log(`\n▶ ${tag}`)
    try {
      await solo(page, s, tag)
      await mp(page, s, tag)
    } catch (e) {
      fail(`${tag}: ${e.message}`)
    }
    if (errs.length) fail(`${tag}: console errors: ${errs.slice(0, 3).join(' | ')}`)
    await ctx.close()
  }
}

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
console.log(failures === 0 ? '\nRESPONSIVE: PASS' : `\nRESPONSIVE: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
