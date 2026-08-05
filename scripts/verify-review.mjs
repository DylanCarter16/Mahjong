// Browser check of the post-round review: moment cards, and the replayed board
// behind each one. The owner is on a phone and cannot see any of this.
//
// The model call is STUBBED — deliberately. The engine's grading is covered
// exhaustively by unit tests, and what a browser can check that they cannot is
// the part that only exists on screen: that a moment is tappable, that tapping
// it reconstructs a real board from the real log, that stepping a turn moves
// it, and that none of it overflows a 375px phone.
//
// So the stub reads the REAL request body — the actual log the client just
// played — and picks real log indices out of it. Everything the board draws is
// therefore genuine; only the verdicts and sentences are canned.
//
// Requires: vite on :5174 (npm run dev). No key, no server needed.
// Usage: npm run verify:review [http://localhost:5174]

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5174'
const OUT = '/tmp/claude-0/-home-user-Mahjong/3abb6fed-4c43-5a95-a950-dc08cbd79673/scratchpad/review'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

let failures = 0
const fail = (m) => { console.error(`✗ ${m}`); failures++ }
const ok = (m) => console.log(`✓ ${m}`)

const browser = await chromium.launch({ executablePath: CH })
const WIDTHS = [375, 390, 430, 768, 1280]

/** Turn number = how many tiles had hit the table by then. */
const turnAt = (log, i) => log.slice(0, i + 1).filter((a) => a.type === 'discard').length

/**
 * Build a review response from the log the client actually posted. Real
 * indices, real tiles, real turns — canned verdicts and prose.
 */
function stubReview(body) {
  const seat = body.scan?.seat ?? 0
  const own = []
  body.log.forEach((a, i) => {
    if (a.type === 'discard' && a.seat === seat) own.push(i)
  })
  if (own.length === 0) return null

  const picks = [...new Set([own[0], own[Math.floor(own.length / 2)], own[own.length - 1]])]
  const verdicts = ['mistake', 'loose', 'sharp']

  // The "better" tile must be one the player actually held that turn, exactly
  // as the real engine's suggestion always is — otherwise the board correctly
  // refuses to ring it and the check below would be testing the stub's bug.
  const otherTileInHand = (played) => {
    for (const snap of body.scan?.snapshots ?? []) {
      if (snap.phase !== 'discard' || !snap.concealed.includes(played)) continue
      const other = snap.concealed.find((t) => t !== played)
      if (other) return other
    }
    return null
  }

  const moments = picks.map((index, k) => {
    const tile = body.log[index].tile
    const alt = k === 0 ? otherTileInHand(tile) : null
    return {
      index,
      turn: turnAt(body.log, index),
      kind: k === 0 ? 'dealIn' : 'discard',
      verdict: verdicts[k % verdicts.length],
      tile,
      headline: `Stubbed headline for turn ${turnAt(body.log, index)}.`,
      facts: [`Stubbed fact one for turn ${turnAt(body.log, index)}.`, 'Stubbed fact two.'],
      better: alt ? { tile: alt, why: 'Stubbed better line.' } : null,
      replayable: true,
    }
  })

  const text = [
    'SUMMARY: Stubbed one-line round summary.',
    ...moments.map((_, i) => `M${i + 1}: Stubbed narration ${i + 1}.`),
  ].join('\n')

  return {
    text,
    model: 'stub-model',
    review: {
      summary: 'Engine summary fallback.',
      tally: { discards: own.length, sharp: 1, loose: 1, mistakes: 1, dealtIn: false, missedClaims: 0 },
      degraded: [],
      moments,
    },
  }
}

const TILE = /of Characters|of Circles|of Bamboo|Wind|Dragon/

async function playToEnd(page, body) {
  // Budget: a solo round is ~60-100 actions and the runner paces bots in REAL
  // time (300ms draw, 650ms bot), so a round can take two minutes of wall clock
  // before anything has gone wrong. Cutting it finer than this reports "the
  // round never finished" for rounds that were merely slow.
  for (let step = 0; step < 2000; step++) {
    // The table re-renders constantly while bots act, so element handles detach
    // and evaluation contexts get torn down under us. None of that is a product
    // bug — swallow it and take another lap rather than failing the whole run.
    try {
      if (await tick(page, body)) return true
    } catch {
      await page.waitForTimeout(200)
    }
  }
  return false
}

/** One step of play. Returns true once the round is over. */
async function tick(page, body) {
  {
    const text = await body()
    // "Round over" is the table's own marker and survives the win dialog being
    // dismissed; the other two are the dialog itself.
    if (/Review this round|Wall exhausted|Round over/.test(text)) return true
    if (/claim it\?/.test(text)) {
      const pass = page.getByRole('button', { name: 'Pass' })
      if (await pass.count()) await pass.first().click({ timeout: 2000 })
      await page.waitForTimeout(120)
      return false
    }
    if (/Your turn — pick a tile to discard/.test(text)) {
      const tiles = page.locator('button[aria-label]').filter({ hasNotText: /^$/ })
      const n = await tiles.count()
      for (let i = n - 1; i >= 0; i--) {
        const label = await tiles.nth(i).getAttribute('aria-label')
        if (!label || !TILE.test(label)) continue
        await tiles.nth(i).click({ timeout: 2000 })
        await page.waitForTimeout(110)
        return false
      }
    }
    await page.waitForTimeout(120)
    return false
  }
}

async function openReview(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  const body = () => page.evaluate(() => document.body.innerText)

  let posted = null
  await page.route('**/api/review', async (route) => {
    posted = route.request().postDataJSON()
    const payload = stubReview(posted)
    await route.fulfill({
      status: payload ? 200 : 502,
      contentType: 'application/json',
      body: JSON.stringify(payload ?? { error: 'no discards to review' }),
    })
  })

  await page.goto(APP, { waitUntil: 'networkidle' })
  // "Play solo" is a heading on the menu card; the button is the one below it.
  await page.getByRole('button', { name: 'Start solo game' }).click()
  // Wait on the TEXT, not a node: the wide layout renders the wall counter in
  // two places and a strict locator picks a hidden one.
  await page.waitForFunction(() => /tiles left/.test(document.body.innerText), null, { timeout: 20000 })

  const finished = await playToEnd(page, body)
  if (!finished) {
    // Say WHICH thing went wrong. "Never reached the review" covers two very
    // different failures and guessing between them wastes a ten-minute run.
    console.error(`  (round never finished; last screen: ${(await body()).slice(-160).replace(/\n/g, ' | ')})`)
    return { page, ctx, errors, body, posted, reached: false }
  }

  const dismiss = page.getByRole('button', { name: /Review this round/ })
  if (await dismiss.count()) {
    await dismiss.click()
    await page.waitForTimeout(400)
  }
  // The panel auto-opens at round end; if it didn't, open it by hand.
  if (!(await page.getByRole('button', { name: 'Review that round' }).count())) {
    const launcher = page.getByRole('button', { name: /AI coach|Discard table/i })
    if (await launcher.count()) {
      await launcher.first().click()
      await page.waitForTimeout(400)
    }
  }
  const btn = page.getByRole('button', { name: 'Review that round' })
  if (!(await btn.count())) {
    console.error(`  (no "Review that round" button; last screen: ${(await body()).slice(-160).replace(/\n/g, ' | ')})`)
    return { page, ctx, errors, body, posted, reached: false }
  }
  await btn.click()
  await page.waitForTimeout(1200)
  return { page, ctx, errors, body, posted, reached: true }
}

const scrollWidth = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, window.scrollY) // measure unscrolled horizontally
    return document.documentElement.scrollWidth
  })

/**
 * How much WIDER the page got, in pixels, compared with a baseline taken on
 * the same page before the review was opened.
 *
 * Deliberately a delta, not an absolute check. The tablet table layout already
 * overflows by a few pixels at exactly 768px at round end — measured identical
 * with the review never opened — and an absolute check here would keep
 * reporting that pre-existing bug as a review-layout failure. What this gate
 * owns is whether the REVIEW adds overflow.
 */
const widerBy = async (page, baseline) => (await scrollWidth(page)) - baseline

// ------------------------------------------------------- the main flow --
{
  const { page, ctx, errors, body, posted, reached } = await openReview(390)
  if (!reached) {
    fail('never reached the review — the round did not finish or the button was missing')
  } else {
    // The client must be sending the scan input, or the server can never run
    // the scanner and the whole change is inert.
    if (posted?.scan?.snapshots?.length > 0) ok(`client posted ${posted.scan.snapshots.length} captured hands`)
    else fail('the review request carried no captured hands — the recorder is not wired up')
    if (posted?.scan?.seatWinds && posted?.scan?.roundWind) ok('client posted the seat winds and round wind')
    else fail('the review request is missing the scan context')

    const text = await body()
    if (/Stubbed one-line round summary/.test(text)) ok('summary line renders from the narration')
    else fail('no summary line in the review')
    if (!/M1:/.test(text)) ok('raw M-labels are parsed away, not shown')
    else fail('the raw "M1:" label leaked to the screen')
    for (const badge of ['Mistake', 'Loose', 'Sharp']) {
      if (new RegExp(badge).test(text)) ok(`verdict badge "${badge}" renders`)
      else fail(`verdict badge "${badge}" missing`)
    }
    if (/Stubbed narration 1\./.test(text)) ok('per-moment narration lands on its card')
    else fail('narration did not attach to a moment')

    await page.screenshot({ path: `${OUT}/1-review-closed.png`, fullPage: true })

    // --- tapping a moment reconstructs the board ---
    const cards = page.locator('li button[aria-expanded]')
    const n = await cards.count()
    if (n >= 3) ok(`${n} moment cards, each tappable`)
    else fail(`expected at least 3 tappable moments, got ${n}`)

    await cards.first().click()
    await page.waitForTimeout(350)
    const opened = await body()
    if (/Your hand/.test(opened)) ok('tapping a moment opens the replayed board')
    else fail('tapping a moment did not open a board')
    if (/tiles left/.test(opened)) ok('the board states the wall count for that turn')
    else fail('no wall count on the replayed board')
    if (/Previous turn/.test(opened) && /Next turn/.test(opened)) ok('±1 turn stepping is offered')
    else fail('no turn stepping on the replayed board')
    if (/Stubbed fact one/.test(opened)) ok('the engine facts render under the moment')
    else fail('engine facts missing from the opened moment')
    if (/Stubbed better line/.test(opened)) ok('the concrete better discard renders')
    else fail('no better-discard line on the opened moment')
    // Layer 2 on the board itself: the alternative must be visible as a tile in
    // the hand, not only named in a sentence above it.
    if (/the better discard/.test(opened)) ok('the better discard is ringed on the replayed hand')
    else fail('the better discard is named but not shown on the board')

    // The board must contain real tiles, not a text fallback.
    const tilesOnBoard = await page.locator('li[aria-expanded] svg, li svg').count()
    if (tilesOnBoard > 10) ok(`the replayed board draws real tiles (${tilesOnBoard} svg nodes)`)
    else fail(`the replayed board drew almost no tiles (${tilesOnBoard})`)

    await page.screenshot({ path: `${OUT}/2-moment-open.png`, fullPage: true })

    // --- stepping moves the board and can come back ---
    const turnOf = async () => {
      const m = /Turn (\d+) ·/.exec(await body())
      return m ? Number(m[1]) : null
    }
    const before = await turnOf()
    const next = page.getByRole('button', { name: /Next turn/ })
    if (before !== null && (await next.isEnabled())) {
      await next.click()
      await page.waitForTimeout(300)
      const after = await turnOf()
      if (after !== null && after > before) ok(`stepping forward moves the board (turn ${before} → ${after})`)
      else fail(`stepping forward did not change the turn (${before} → ${after})`)

      const back = page.getByRole('button', { name: /Back to turn/ })
      if (await back.count()) {
        await back.click()
        await page.waitForTimeout(300)
        if ((await turnOf()) === before) ok('"back to the moment" returns to the graded turn')
        else fail('"back to the moment" did not return')
      } else fail('no way back to the moment after stepping')
    } else fail('could not step forward from the first moment')

    const prev = page.getByRole('button', { name: /Previous turn/ })
    if (await prev.isEnabled()) {
      const b2 = await turnOf()
      await prev.click()
      await page.waitForTimeout(300)
      const a2 = await turnOf()
      if (a2 !== null && b2 !== null && a2 < b2) ok(`stepping back moves the board (turn ${b2} → ${a2})`)
      else fail(`stepping back did not change the turn (${b2} → ${a2})`)
    } else ok('previous-turn is correctly disabled at the start of the round')

    await page.screenshot({ path: `${OUT}/3-stepped.png`, fullPage: true })

    // --- collapsing ---
    await cards.first().click()
    await page.waitForTimeout(250)
    if (!/Your hand/.test(await body())) ok('tapping again collapses the moment')
    else fail('the moment did not collapse')

    if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`)
    else ok('no console errors through the review flow')

    // ------------------------------------------------- every width --
    // Resized on the page that already has this round's review open, rather
    // than replaying a round per width. The layout is what is under test, and
    // playing five more rounds to look at it made the script slow enough to
    // fail for reasons that had nothing to do with the layout.
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(250)

      // Baseline with the review collapsed, on this same finished round.
      const base = await scrollWidth(page)
      const viewport = await page.evaluate(() => document.documentElement.clientWidth)
      if (base > viewport + 1) {
        console.log(`  · note: the table itself already overflows by ${base - viewport}px at ${width}px`)
      }

      await cards.first().click()
      await page.waitForTimeout(350)
      if (!/Your hand/.test(await body())) {
        fail(`${width}px: the board did not open`)
        continue
      }
      const added = await widerBy(page, base)
      if (added <= 1) ok(`${width}px: the replayed board adds no horizontal overflow`)
      else fail(`${width}px: opening the board widened the page by ${added}px`)

      const small = await page.evaluate(() => {
        const bad = []
        for (const el of document.querySelectorAll('button')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.height < 44 && r.width < 44) {
            bad.push(`${el.textContent?.trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        }
        return bad
      })
      if (small.length === 0) ok(`${width}px: every visible control >=44px in a dimension`)
      else fail(`${width}px: controls under 44px - ${small.slice(0, 3).join(', ')}`)

      await page.screenshot({ path: `${OUT}/w-${width}.png`, fullPage: true })
      await cards.first().click() // collapse before the next width
      await page.waitForTimeout(200)
    }
  }
  await ctx.close()
}

// ------------------------------------------------------ layer 3: patterns --
// Rounds are banked at every round end, whether or not a review is requested,
// so the check is: play two rounds, and the entry point must appear with real
// counts behind it. This is the wiring unit tests cannot see.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  const body = () => page.evaluate(() => document.body.innerText)

  // This block runs WITHOUT a key, and opening the coach panel fires a prefetch.
  // Stub every model call so the run measures the patterns layer rather than
  // the absence of an API key.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'stubbed coach answer', model: 'stub-model' }),
    }),
  )

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Start solo game' }).click()
  await page.waitForFunction(() => /tiles left/.test(document.body.innerText), null, { timeout: 20000 })

  const stored = () =>
    page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('mahjong.progress.v1') ?? '{}').rounds ?? []
      } catch {
        return []
      }
    })

  let rounds = 0
  for (let r = 0; r < 3 && rounds < 2; r++) {
    if (!(await playToEnd(page, body))) break
    await page.waitForTimeout(500)
    rounds = (await stored()).length
    const next = page.getByRole('button', { name: /Next round|Review this round/ })
    if (await next.count()) {
      await next.first().click()
      await page.waitForTimeout(500)
    }
    const deal = page.getByRole('button', { name: /Next round/ })
    if (await deal.count()) {
      await deal.first().click()
      await page.waitForTimeout(800)
    }
  }

  const banked = await stored()
  if (banked.length >= 1) ok(`${banked.length} round(s) banked to storage without asking for a review`)
  else fail('no rounds were banked — the patterns layer will never have data')

  if (banked.length > 0) {
    const r = banked[0]
    if (typeof r.discards === 'number' && typeof r.leaks === 'object') ok('the banked record has the expected shape')
    else fail(`the banked record is malformed: ${JSON.stringify(r).slice(0, 120)}`)
    // Compact by design — a log would balloon the storage key.
    if (JSON.stringify(r).length < 400) ok('the banked record is compact (no log stored)')
    else fail(`the banked record is too large: ${JSON.stringify(r).length} bytes`)
  }

  // Seed enough history for the entry point, then check it renders.
  await page.evaluate(() => {
    const key = 'mahjong.progress.v1'
    const state = JSON.parse(localStorage.getItem(key) ?? '{}')
    const one = { day: '2026-01-01', discards: 12, sharp: 1, loose: 2, mistakes: 1, leaks: { fedThreat: 2 } }
    state.rounds = [one, { ...one, leaks: { fedThreat: 1, dealtIn: 1 } }, { ...one, leaks: { fedThreat: 1 } }]
    localStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Start solo game' }).click()
  await page.waitForFunction(() => /tiles left/.test(document.body.innerText), null, { timeout: 20000 })

  const launcher = page.getByRole('button', { name: /coach|Discard table|Analyse/i })
  if (await launcher.count()) {
    await launcher.first().click()
    await page.waitForTimeout(400)
  }
  const patterns = page.getByRole('button', { name: 'Your patterns' })
  if (await patterns.count()) {
    ok('the patterns entry point appears once there is history')
    await patterns.click()
    await page.waitForTimeout(400)
    const text = await body()
    if (/Feeding the seat that was pushing/.test(text)) ok('a recurring leak is named')
    else fail(`no leak named in the patterns view — "${text.slice(-200)}"`)
    if (/in 3 of 3 rounds/.test(text)) ok('the leak shows its count and its denominator')
    else fail('the leak does not show how often it happened out of how many rounds')
    if (/Worth drilling in Learn/.test(text)) ok('the patterns view points back at the lessons')
    else fail('no link back to the lesson concepts')
    const patternsBase = await page.evaluate(() => document.documentElement.clientWidth)
    if ((await scrollWidth(page)) <= patternsBase + 1) ok('the patterns view fits the phone width')
    else fail('the patterns view overflows horizontally')
    await page.screenshot({ path: `${OUT}/4-patterns.png`, fullPage: true })
  } else fail('no "Your patterns" entry point after three recorded rounds')

  if (errors.length) fail(`console errors in the patterns flow: ${errors.slice(0, 2).join(' | ')}`)
  else ok('no console errors in the patterns flow')
  await ctx.close()
}

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures ? 1 : 0)
