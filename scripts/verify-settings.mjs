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

if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`)
else ok('no console errors during the flow')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
process.exit(failures ? 1 : 0)
