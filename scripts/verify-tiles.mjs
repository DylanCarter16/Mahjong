// One tile rendering path, everywhere (§D1). Walks the two drills that had the
// dual-rendering bug and asserts, at every width the owner asked about:
//   - the threat pool is drawn with real <TileView> tiles, at a legible size,
//   - no Unicode mahjong-block CHARACTER (U+1F000–U+1F02A) is rendered as text
//     anywhere on the page — that was the second, worse path,
//   - nothing overflows sideways.
//
// Usage: npm run verify:tiles [http://localhost:5175]

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5175'
const OUT = '/tmp/claude-0/-home-user-Mahjong/3abb6fed-4c43-5a95-a950-dc08cbd79673/scratchpad/tiles'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

let failures = 0
const fail = (m) => { console.error(`✗ ${m}`); failures++ }
const ok = (m) => console.log(`✓ ${m}`)

const WIDTHS = [375, 390, 430, 768, 1280]

const browser = await chromium.launch({ executablePath: CH })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

/** Any mahjong-block character sitting in a text node = the old glyph path. */
const glyphText = () =>
  page.evaluate(() => {
    const bad = []
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const hit = [...(n.textContent ?? '')].filter((c) => {
        const cp = c.codePointAt(0)
        return cp >= 0x1f000 && cp <= 0x1f02a
      })
      if (hit.length) bad.push(`${hit.join('')} in "${(n.parentElement?.className || n.parentElement?.tagName || '?').toString().slice(0, 40)}"`)
    }
    return bad
  })

const audit = async (tag) => {
  const bad = await glyphText()
  if (bad.length) fail(`${tag}: text-glyph tiles still rendered — ${bad.slice(0, 3).join(' | ')}`)
  else ok(`${tag}: no text-glyph tiles`)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  if (overflow > 1) fail(`${tag}: horizontal overflow ${overflow}px`)
}

/** Smallest rendered tile inside a container, in CSS px. */
const tileSizes = (selector) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return null
    const svgs = [...root.querySelectorAll('svg')].map((s) => s.getBoundingClientRect().width)
    return svgs.length ? { count: svgs.length, min: Math.min(...svgs) } : null
  }, selector)

// ---------------------------------------------------------------- trainer --
await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.getByRole('button', { name: /Tile efficiency trainer/ }).click()
await page.waitForTimeout(500)
// Expert tier is the one with the threat pool.
await page.selectOption('select', '3')
await page.waitForTimeout(600)

const pool = await tileSizes('.border-danger\\/40 [data-tile-pool]')
if (!pool) fail('threat pool did not render any tiles')
else {
  ok(`threat pool renders ${pool.count} real tiles`)
  if (pool.min >= 32) ok(`threat pool tiles are legible (${Math.round(pool.min)}px wide)`)
  else fail(`threat pool tiles are only ${Math.round(pool.min)}px wide`)
}
await page.screenshot({ path: `${OUT}/trainer-390.png`, fullPage: true })

for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(200)
  await audit(`trainer @${width}`)
}
await page.setViewportSize({ width: 390, height: 844 })

// Answer one hand so the ranked table (the other glyph site) renders.
const tile = page.locator('.bg-felt button').first()
if (await tile.count()) {
  await tile.click()
  await page.waitForTimeout(400)
  await audit('trainer ranked table')
  await page.screenshot({ path: `${OUT}/trainer-table-390.png`, fullPage: true })
}

// ------------------------------------------------------------------- quiz --
await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.getByRole('button', { name: /Discard-reading quiz/ }).click()
await page.waitForTimeout(800)
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(200)
  await audit(`quiz @${width}`)
}
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: `${OUT}/quiz-390.png`, fullPage: true })

// Walk to a safest-tile question, whose options carry tiles.
for (let i = 0; i < 6; i++) {
  const t = await page.evaluate(() => document.body.innerText)
  if (/safest to discard/.test(t)) break
  const opt = page.locator('button.rounded-xl.border').first()
  if (!(await opt.count())) break
  await opt.click()
  await page.waitForTimeout(200)
  const sure = page.getByRole('button', { name: 'Fairly sure' })
  if (await sure.count()) await sure.click()
  await page.waitForTimeout(300)
  const next = page.getByRole('button', { name: /Next question|Continue|See the truth|Show the later/ })
  if (await next.count()) await next.first().click()
  await page.waitForTimeout(400)
}
const t = await page.evaluate(() => document.body.innerText)
if (/safest to discard/.test(t)) {
  await audit('quiz safest-tile options')
  await page.screenshot({ path: `${OUT}/quiz-options-390.png`, fullPage: true })
  ok('reached the safest-tile question (tile-bearing options)')
} else {
  console.log('  · did not reach a safest-tile question in this position')
}

// --------------------------------------------------------------- the table --
await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Start solo game' }).click()
await page.waitForSelector('text=tiles left', { timeout: 15000 })
await page.waitForTimeout(1500)
await audit('solo table')

if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`)
else ok('no console errors')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures ? 1 : 0)
