// Proves the §B display/house-rule split in a real multiplayer room, which is
// the thing the owner cannot check from a phone:
//   B1 — settings are reachable MID-GAME in multiplayer, and toggling a display
//        preference changes only this device's view (no message on the wire).
//   B2 — "beginner aids allowed" is a host rule; when the host turns it off the
//        personal toggle is disabled and says why.
//   B3 — with the coach disallowed the launcher is GONE, not present-and-dead,
//        but the free local table still has an entry point while aids are on.
//
// Requires: npm run server:dev (:8787) and VITE_GAME_SERVER=... vite (:5174).
// Usage: npm run verify:settings [http://localhost:5174]

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5174'
const OUT = '/tmp/claude-0/-home-user-Mahjong/3abb6fed-4c43-5a95-a950-dc08cbd79673/scratchpad/settings'
mkdirSync(OUT, { recursive: true })
const CH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

let failures = 0
const fail = (m) => { console.error(`✗ ${m}`); failures++ }
const ok = (m) => console.log(`✓ ${m}`)

const browser = await chromium.launch({ executablePath: CH })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.location()?.url ?? '')) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

// Every frame the client sends the room. A display toggle must not add one.
const sent = []
page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(String(f.payload))))

const body = () => page.evaluate(() => document.body.innerText)

// Lobby rule checkboxes are controlled by the SERVER's echo (the host proposes,
// the room confirms), so a click doesn't flip them synchronously — click, then
// wait for the confirmed state.
async function setLobbyRule(id, value) {
  const box = page.locator(`#${id}`)
  if ((await box.isChecked()) !== value) await box.click()
  await page.waitForFunction(
    ([sel, want]) => document.querySelector(sel)?.checked === want,
    [`#${id}`, value],
    { timeout: 10000 },
  )
}

async function createRoom({ coach, aids }) {
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.getByLabel('Your name').fill('Dylan')
  await page.getByRole('button', { name: 'Create room' }).click()
  await page.getByRole('button', { name: 'Create & open lobby' }).click()
  await page.waitForSelector('text=Room code', { timeout: 20000 })
  await setLobbyRule('coach', coach)
  await setLobbyRule('aids-allowed', aids)
  await page.getByRole('button', { name: /Start game/ }).click()
  await page.waitForSelector('text=tiles left', { timeout: 20000 })
  await page.waitForTimeout(600)
}

// --------------------------------------------------- pre-game solo setup --
// Rules chosen from the MENU must apply to the very first hand. Mid-game they
// can only land on the next round, which is right for a hand in progress and
// wrong as a first experience.
await page.goto(APP, { waitUntil: 'networkidle' })
{
  const menu = await body()
  if (/faan min/.test(menu) && /flowers/.test(menu) && /bots:/.test(menu))
    ok('pre-game: the solo card shows the rules you are about to be dealt')
  else fail(`pre-game: no rules summary on the menu — "${menu.slice(0, 120)}"`)

  if (/aids off/.test(menu)) ok('pre-game: beginner aids default to OFF')
  else fail('pre-game: beginner aids are not off by default')

  await page.getByRole('button', { name: '⚙ Change' }).click()
  await page.waitForTimeout(300)
  const panel = await body()
  // innerText carries the CSS uppercase transform, hence the /i.
  if (/Rules \(applied when you start\)/i.test(panel)) ok('pre-game: rules are editable before any game exists')
  else fail('pre-game: the panel does not offer rules before the game')
  await page.selectOption('#faan-min', '1')
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/pre-game-settings.png` })
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: 'Start solo game' }).click()
  await page.waitForSelector('text=tiles left', { timeout: 15000 })
  const table = await body()
  if (/min 1 faan/.test(table)) ok('pre-game: the FIRST hand is dealt under the rules just chosen')
  else fail(`pre-game: the first hand ignored the chosen rules — "${(table.match(/min \d+ faan/) || ['none'])[0]}"`)

  // And the mid-game escape hatch: change a rule, deal it now.
  await page.getByRole('button', { name: /Settings/ }).click()
  await page.waitForTimeout(300)
  await page.selectOption('#faan-min', '3')
  const applyNow = page.getByRole('button', { name: 'Deal a new game with these rules' })
  if (await applyNow.count()) {
    await applyNow.click()
    await page.waitForSelector('text=tiles left', { timeout: 15000 })
    await page.waitForTimeout(600)
    if (/min 3 faan/.test(await body())) ok('mid-game: "deal a new game with these rules" applies them immediately')
    else fail('mid-game: the redeal did not pick up the new rules')
  } else fail('mid-game: no way to apply rule changes without waiting for the next round')
  await page.screenshot({ path: `${OUT}/solo-redealt.png` })
}

// ---------------------------------------------------------------- B1 + B2 --
await createRoom({ coach: true, aids: true })
ok('multiplayer table reached (coach on, aids on)')

const gear = page.getByRole('button', { name: 'Settings' })
if (await gear.count()) ok('B1: settings reachable mid-game in multiplayer')
else fail('B1: no settings control on the multiplayer table')
await gear.click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/mp-settings.png` })

const panel = await body()
for (const label of ['Numbered tiles', 'Beginner aids', 'Reduce motion']) {
  if (panel.includes(label)) ok(`B1: "${label}" is togglable mid-game`)
  else fail(`B1: "${label}" missing from the mid-game panel`)
}
if (/Minimum faan|Flowers & seasons/.test(panel)) fail('B1: rule controls leaked into the multiplayer panel')
else ok('B1: no rule controls in the multiplayer panel (host owns those)')

// A display toggle must be purely local: no frame goes out.
const before = sent.length
await page.getByLabel('Numbered tiles').uncheck()
await page.waitForTimeout(600)
if (sent.length === before) ok('B1: toggling a display preference sent nothing on the wire')
else fail(`B1: display toggle sent ${sent.length - before} socket frame(s): ${sent.slice(before).join(' ')}`)
await page.getByRole('button', { name: 'Close settings' }).click()
await page.waitForTimeout(300)

// ---------------------------------------------------------------- B2 lock --
await createRoom({ coach: true, aids: false })
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForTimeout(300)
const locked = await body()
const aidsBox = page.getByLabel('Beginner aids')
if (await aidsBox.isDisabled()) ok('B2: host lock disables the personal beginner-aid toggle')
else fail('B2: personal aid toggle still editable with the host rule off')
if (/Turned off by the host for this room/.test(locked)) ok('B2: the lock says why')
else fail('B2: no explanation for the disabled toggle')
await page.screenshot({ path: `${OUT}/mp-aids-locked.png` })
await page.getByRole('button', { name: 'Close settings' }).click()

// ---------------------------------------------------------------- B3 gates --
// coach off + aids off  → no launcher at all
await createRoom({ coach: false, aids: false })
if ((await page.getByRole('button', { name: /AI coach/ }).count()) === 0)
  ok('B3: coach launcher gone when the room disallows the coach')
else fail('B3: coach launcher still present in a no-coach room')
if ((await page.getByRole('button', { name: /Discard table/ }).count()) === 0)
  ok('B3: no local-table launcher either when aids are also disallowed')
else fail('B3: a launcher appeared with both gates closed')
await page.screenshot({ path: `${OUT}/mp-no-coach-no-aids.png` })

// coach off + aids on → free local table, no AI wording
await createRoom({ coach: false, aids: true })
const tableBtn = page.getByRole('button', { name: /Discard table/ })
if (await tableBtn.count()) ok('B3: local discard table still offered when only the coach is off')
else fail('B3: the free local table vanished with the coach rule')
if ((await page.getByRole('button', { name: /AI coach/ }).count()) === 0) ok('B3: no AI launcher in that room')
else fail('B3: AI launcher present although the coach is disallowed')
await tableBtn.click()
await page.waitForTimeout(400)
const opened = await body()
if (/Analyse my hand|Review that round/.test(opened)) fail('B3: model buttons offered in a no-coach room')
else ok('B3: opened panel offers no model calls')
await page.screenshot({ path: `${OUT}/mp-table-only.png` })

// ------------------------------------------------- A1: multiplayer review --
// The multiplayer half of the dead review button: the win dialog covers the
// coach panel, and its "review" action used to be a no-op, so the round review
// was unreachable in a room. Play a real round out and check it dismisses.
await createRoom({ coach: true, aids: true })
await page.route('**/api/review', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text: 'MP-REVIEW-OK', model: 'stub-model' }),
  }),
)
const TILE = /of Characters|of Circles|of Bamboo|Wind|Dragon/
let done = false
for (let step = 0; step < 900 && !done; step++) {
  const text = await body()
  if (/Review this round|Wall exhausted|Waiting for host/.test(text)) { done = true; break }
  if (/claim it\?/.test(text)) {
    const pass = page.getByRole('button', { name: 'Pass' })
    if (await pass.count()) await pass.first().click()
    await page.waitForTimeout(150)
    continue
  }
  if (/Your turn — pick a tile to discard/.test(text)) {
    const hand = []
    for (const el of await page.$$('button[aria-label]')) {
      const label = await el.getAttribute('aria-label')
      if (label && TILE.test(label)) hand.push(el)
    }
    if (hand.length) {
      await hand[hand.length - 1].click()
      await page.waitForTimeout(120)
      continue
    }
  }
  await page.waitForTimeout(200)
}
if (!done) fail('A1/mp: the round never finished — review not checked')
else {
  await page.screenshot({ path: `${OUT}/mp-round-end.png` })
  const dismiss = page.getByRole('button', { name: /Review this round/ })
  if (await dismiss.count()) {
    await dismiss.click()
    await page.waitForTimeout(400)
    const after = await body()
    if (/Review this round/.test(after)) fail('A1/mp: the win dialog did not dismiss')
    else ok('A1/mp: the end-of-round dialog dismisses to the table')
    const reviewBtn = page.getByRole('button', { name: 'Review that round' })
    if (await reviewBtn.count()) {
      await reviewBtn.click()
      await page.waitForTimeout(900)
      if (/MP-REVIEW-OK/.test(await body())) ok('A1/mp: "Review that round" produces output in a room')
      else fail('A1/mp: the review produced nothing')
      await page.screenshot({ path: `${OUT}/mp-review.png` })
    } else fail('A1/mp: no review button under the dismissed dialog')
  } else fail('A1/mp: no dismiss action on the multiplayer win dialog')
}

if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`)
else ok('no console errors during the flow')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures ? 1 : 0)
