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
// The rule under test changed (§C1): the timed warning must appear ONCE for the
// session, and then no full-screen modal may reappear between timed items.
const startBtn = page.getByRole('button', { name: 'Start a session' }).first()
if (await startBtn.count()) {
  await startBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/3-session-first.png` })
  const t = await page.evaluate(() => document.body.innerText)
  if (/questions are timed|questions in this session are timed/i.test(t)) {
    ok('session warns ONCE about the timed questions ahead')
    const secs = (t.match(/(\d+)\s+seconds each/i) || [])[1]
    if (secs && Number(secs) >= 10) ok(`generous starting clock (${secs}s) for tile-ID`)
    else if (secs) console.log(`  · starting clock is ${secs}s`)
    await page.getByRole('button', { name: 'Start' }).click()
    await page.waitForTimeout(400)
  } else {
    console.log('  · this session had no timed items (scheduler choice) — see screenshot')
  }

  if (/I'm ready/i.test(await page.evaluate(() => document.body.innerText)))
    fail('the per-question "I\'m ready" modal is back')
  else ok('no per-question ready modal')

  // Answer up to three items and confirm no modal appears between them; timed
  // ones must carry the persistent badge and a count-in instead.
  let sawBadge = false
  let modalBetween = false
  for (let i = 0; i < 3; i++) {
    const txt = await page.evaluate(() => document.body.innerText)
    if (/⏱ timed/.test(txt)) sawBadge = true
    if (/I'm ready/i.test(txt)) modalBetween = true
    const opts = page.locator('button.rounded-xl.border')
    if (await opts.count()) await opts.first().click()
    else break
    await page.waitForTimeout(400)
    const cont = page.getByRole('button', { name: /Continue|Guessing/ })
    if (await cont.count()) await cont.first().click()
    await page.waitForTimeout(500)
  }
  if (sawBadge) ok('timed items carry the persistent ⏱ badge')
  if (modalBetween) fail('a ready modal appeared between questions')
  else ok('no modal between questions in a run')
  await page.screenshot({ path: `${OUT}/4-session-run.png` })
} else {
  fail('could not find the start-session CTA')
}

// ---- Targeted practice by concept (§C2) ----
await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Learn', exact: true }).click()
await page.waitForTimeout(400)
const practice = page.getByRole('button', { name: /^Practise / }).first()
if (await practice.count()) {
  const label = await practice.getAttribute('aria-label')
  ok(`practice-by-concept entry point present (e.g. "${label}")`)
  await practice.click()
  await page.waitForTimeout(700)
  const t = await page.evaluate(() => document.body.innerText)
  if (/Practising:/.test(t)) ok('a focused practice session starts on the chosen skill')
  else fail('focused practice did not start')
  await page.screenshot({ path: `${OUT}/5-practice.png` })
} else {
  fail('no practice-by-concept entry point on the course home')
}

if (errs.length) fail(`console errors: ${errs.slice(0, 3).join(' | ')}`)
else ok('no console/page errors')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures === 0 ? 0 : 1)
