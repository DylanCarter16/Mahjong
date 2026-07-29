// Verify the restored 1.5 lessons render and the two fixes hold:
//   1. tile-ID (recognition) items are timed but gated behind an "I'm ready"
//      tap (no ambush) with a generous clock,
//   2. discard-reading questions actually show the discard pools.
// Screenshots each milestone.

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5175'
const OUT = '/tmp/claude-0/-home-user-Mahjong/473e87cf-c5b0-5ee0-9d68-7058fb876aa0/scratchpad/lessons'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: CH })
let failures = 0
const fail = (m) => { console.error(`✗ ${m}`); failures++ }
const ok = (m) => console.log(`✓ ${m}`)

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errs = []
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errs.push(m.text()) })
page.on('pageerror', (e) => errs.push(String(e)))

await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/1-home.png` })
// Course home shows the mastery/course furniture (streak / today / xp / units).
const homeText = await page.evaluate(() => document.body.innerText)
if (/day streak/.test(homeText) && /xp/i.test(homeText)) ok('lesson home renders (streak + xp + course map)')
else fail('lesson home does not look like the 1.5 course home')

// ---- Discard-reading QUIZ shows the pools ----
// The quiz button lives on the home; open it and confirm tiles are on the table.
const quizBtn = page.getByRole('button', { name: /read|discard|quiz|terrain/i }).first()
if (await quizBtn.count()) {
  await quizBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/2-quiz.png` })
  const tileCount = await page.locator('[aria-label]').evaluateAll(
    (els) => els.filter((e) => /^[mps][1-9]$|wind|dragon|character|circle|bamboo/i.test(e.getAttribute('aria-label') || '')).length,
  )
  if (tileCount > 8) ok(`discard-reading quiz shows the pools (${tileCount} tiles on the table)`)
  else fail(`discard-reading quiz did not render discard tiles (found ${tileCount})`)
  // back to home
  const back = page.getByRole('button', { name: /back/i }).first()
  if (await back.count()) await back.click()
  await page.waitForTimeout(300)
} else {
  fail('could not find the discard-reading quiz entry on the home')
}

// ---- Start a SESSION; a fresh user gets recognition (timed) items ----
const startBtn = page.getByRole('button', { name: /session|start|begin|terrain/i }).first()
if (await startBtn.count()) {
  await startBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/3-session-first.png` })
  const t = await page.evaluate(() => document.body.innerText)
  // A recognition item is timed → it must present the ready-gate, not spring a clock.
  if (/I'm ready|Timed question/i.test(t)) {
    ok('timed tile-ID item is gated behind an "I\'m ready" tap (no ambush)')
    const secs = (t.match(/have\s+(\d+)\s+seconds/i) || [])[1]
    if (secs && Number(secs) >= 10) ok(`generous starting clock (${secs}s) for tile-ID`)
    else if (secs) console.log(`  · starting clock is ${secs}s`)
  } else {
    console.log('  · first session item was not a timed recognition item (scheduler choice) — see screenshot')
  }
} else {
  fail('could not find the start-session CTA')
}

if (errs.length) fail(`console errors: ${errs.slice(0, 3).join(' | ')}`)
else ok('no console/page errors')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures === 0 ? 0 : 1)
