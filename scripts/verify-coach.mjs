// Drives the real solo game in a browser to prove the three coach paths the
// owner can't check on a phone:
//   1. the discard coach still answers,
//   2. the CLAIM coach fires on a claimable discard (engine table + prose),
//   3. "Review that round" produces output at round end — and when the proxy
//      fails, an error with a working "Try again" instead of a dead spinner.
//
// The /api/* calls are intercepted, so this spends no tokens and needs no key:
// what's under test is the client wiring, not the model.
//
// Usage: npm run verify:coach [http://localhost:5173]

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5173'
const OUT = '/tmp/claude-0/-home-user-Mahjong/3abb6fed-4c43-5a95-a950-dc08cbd79673/scratchpad/coach'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

let failures = 0
const fail = (m) => { console.error(`✗ ${m}`); failures++ }
const ok = (m) => console.log(`✓ ${m}`)

const browser = await chromium.launch({ executablePath: CH })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
// The 502 below is this script's own stub exercising the failure path.
const expected = (t, url = '') => /favicon/i.test(url) || /Failed to load resource/i.test(t)
page.on('console', (m) => {
  if (m.type() === 'error' && !expected(m.text(), m.location()?.url ?? '')) errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

// --- stubbed proxy -------------------------------------------------------
const seen = { coach: 0, review: 0 }
let reviewMode = 'ok' // 'ok' | 'error'
const prompts = []
await page.route('**/api/coach', async (route) => {
  seen.coach++
  prompts.push(JSON.parse(route.request().postData() ?? '{}'))
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text: 'COACH-PROSE-OK', model: 'stub-model' }),
  })
})
await page.route('**/api/review', async (route) => {
  seen.review++
  if (reviewMode === 'error') {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'upstream said no' }),
    })
  } else {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'REVIEW-PROSE-OK', model: 'stub-model' }),
    })
  }
})

const body = () => page.evaluate(() => document.body.innerText)

await page.goto(APP, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Start solo game' }).click()
await page.waitForSelector('text=tiles left', { timeout: 15000 })

// Open the coach panel and leave it open for the whole round.
await page.getByRole('button', { name: /AI coach/ }).first().click()
await page.waitForTimeout(400)
ok('coach panel opens')

// --- play the round ------------------------------------------------------
const TILE = /of Characters|of Circles|of Bamboo|Wind|Dragon|Plum|Orchid|Bamboo$|Chrysanthemum|Spring|Summer|Autumn|Winter/
let sawClaimTable = false
let sawClaimProse = false
let sawDiscardTable = false
let finished = false

for (let step = 0; step < 700 && !finished; step++) {
  const text = await body()
  if (/Next round →|Wall exhausted|Review this round/.test(text)) { finished = true; break }

  if (/claim it\?/.test(text)) {
    // A claim window — the whole point of A2.
    await page.waitForTimeout(700) // let the stubbed prose land
    const t = await body()
    if (/worth claiming\?/.test(t)) {
      if (!sawClaimTable) { sawClaimTable = true; await page.screenshot({ path: `${OUT}/claim.png` }) }
      if (/shanten/.test(t)) ok('claim window: engine claim table rendered (shanten before → after)')
    }
    if (/COACH-PROSE-OK/.test(t)) sawClaimProse = true
    const pass = page.getByRole('button', { name: 'Pass' })
    if (await pass.count()) await pass.first().click()
    else {
      const anyClaim = page.getByRole('button', { name: /Pung|Chow|Kong|Win!/ })
      if (await anyClaim.count()) await anyClaim.first().click()
    }
    await page.waitForTimeout(200)
    continue
  }

  if (/Your turn — pick a tile to discard/.test(text)) {
    if (/live tiles/.test(text)) sawDiscardTable = true
    // Hand tiles are the only clickable tiles on the table (every other tile
    // renders as a non-interactive element).
    const all = await page.$$('button[aria-label]')
    const hand = []
    for (const el of all) {
      const label = await el.getAttribute('aria-label')
      if (label && TILE.test(label)) hand.push(el)
    }
    if (hand.length === 0) { await page.waitForTimeout(300); continue }
    await hand[hand.length - 1].click()
    await page.waitForTimeout(150)
    continue
  }
  await page.waitForTimeout(250)
}

if (sawDiscardTable) ok('discard coach: local ranked table rendered on my turn')
else fail('never saw the local ranked-discard table on my turn')
if (seen.coach > 0) ok(`discard/claim coach prose requested (${seen.coach} calls to /api/coach)`)
else fail('the coach never fired a request')
if (sawClaimTable) ok('claim coach: shanten-delta table appeared in a claim window')
else fail('never saw the claim table (no claim window reached?)')
if (sawClaimProse) ok('claim coach: model prose streamed under the table')
else fail('claim prose never rendered')
// The claims-phase request must carry the pending discard — that is what makes
// the server build the claim prompt instead of the discard prompt.
if (prompts.some((p) => p?.view?.phase === 'claims' && p?.view?.pendingDiscard))
  ok('claim request posts a claims-phase view (server builds the claim prompt)')
else fail('no claims-phase view was ever posted to /api/coach')

// --- round review --------------------------------------------------------
if (!finished) fail('round never finished — skipping the review checks')
else {
  await page.screenshot({ path: `${OUT}/round-end.png` })
  const dismiss = page.getByRole('button', { name: /Review this round/ })
  if (await dismiss.count()) {
    await dismiss.click()
    ok('end-of-round dialog dismisses to the table (the review CTA is live)')
  } else fail('no "Review this round" button on the win dialog')
  await page.waitForTimeout(300)

  // Failure path first: a 502 must produce a visible error + retry.
  reviewMode = 'error'
  await page.getByRole('button', { name: 'Review that round' }).click()
  await page.waitForTimeout(800)
  const errText = await body()
  if (/Couldn't generate a review/.test(errText)) ok('review failure shows "couldn\'t generate a review"')
  else fail(`review failure did not show the error state: ${errText.slice(0, 200)}`)
  const retry = page.getByRole('button', { name: 'Try again' })
  if (await retry.count()) ok('retry button offered after a failed review')
  else fail('no retry button after a failed review')
  await page.screenshot({ path: `${OUT}/review-error.png` })

  // Then retry into a working proxy.
  reviewMode = 'ok'
  if (await retry.count()) await retry.click()
  await page.waitForTimeout(900)
  const okText = await body()
  if (/REVIEW-PROSE-OK/.test(okText)) ok('retry produces the review text')
  else fail(`retry did not produce review text: ${okText.slice(0, 200)}`)
  if (seen.review >= 2) ok(`review endpoint called ${seen.review}× (fail then retry)`)
  else fail(`review endpoint called ${seen.review}× — retry did not re-request`)
  await page.screenshot({ path: `${OUT}/review-ok.png` })
}

if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`)
else ok('no console errors during the flow')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures ? 1 : 0)
