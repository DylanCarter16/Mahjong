// Browser self-verification of the Phase 7 UI (the human can't see it on
// mobile). Drives the real app against vite dev + wrangler dev: solo still
// works, and create-room → lobby → start → table renders. Screenshots each
// milestone so the layout can be eyeballed later.

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.argv[2] ?? 'http://localhost:5174'
const OUT = '/tmp/claude-0/-home-user-Mahjong/473e87cf-c5b0-5ee0-9d68-7058fb876aa0/scratchpad/shots'
mkdirSync(OUT, { recursive: true })

// Chromium path: env override, else the pre-installed browser in this image,
// else let playwright-core resolve its own. Requires: npm i -D playwright-core
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1 }
const ok = (m) => console.log(`✓ ${m}`)

// Mobile viewport — this is a PWA target.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
// Ignore the browser's automatic /favicon.ico probe (no favicon is linked) —
// its URL lives in the console message's LOCATION, not its text.
const ignorable = (t, url = '') => /favicon\.ico/i.test(t) || /favicon\.ico/i.test(url)
page.on('console', (m) => {
  if (m.type() === 'error' && !ignorable(m.text(), m.location()?.url)) errors.push(`${m.text()} @ ${m.location()?.url}`)
})
page.on('pageerror', (e) => { if (!ignorable(String(e))) errors.push(String(e)) })
// Only real HTTP 404s (favicon excluded) count as failures.
page.on('response', (r) => {
  if (r.status() === 404 && !/favicon\.ico/i.test(r.url())) errors.push(`HTTP 404 ${r.url()}`)
})

await page.goto(APP, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/1-menu.png` })
if (await page.getByText('Play solo').count()) ok('menu renders with Play solo + Play with people')
else fail('menu did not render')

// Solo still works (offline path).
await page.getByRole('button', { name: 'Start solo game' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/2-solo.png` })
if (await page.getByText('tiles left').count()) ok('solo table renders (tiles-left counter present)')
else fail('solo table did not render')

// Back to menu, create a room.
await page.getByRole('button', { name: '← Menu' }).click()
await page.getByLabel('Your name').fill('Dylan')
await page.getByRole('button', { name: 'Create room' }).click()
await page.getByRole('button', { name: 'Create & open lobby' }).click()

// Lobby should show a 6-char room code.
await page.waitForSelector('text=Room code', { timeout: 15000 })
await page.screenshot({ path: `${OUT}/3-lobby.png` })
const codeText = await page.locator('button[aria-label^="Room code"]').innerText()
const code = codeText.replace(/[^A-Z0-9]/g, '')
if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) ok(`lobby renders with room code ${code}`)
else fail(`lobby room code looks wrong: "${codeText}"`)

// Host is Dylan in seat 0; start (empty seats → bots).
if (await page.getByText('You are the host').count()) ok('host controls visible')
else fail('host state not shown')
await page.getByRole('button', { name: /Start game/ }).click()

// Table should render: wall counter + our name on our seat.
await page.waitForSelector('text=tiles left', { timeout: 15000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/4-mp-table.png` })
if (await page.getByText(`room ${code}`).count()) ok('multiplayer table renders with room code in header')
else fail('multiplayer table header missing')
if (await page.locator('text=Dylan').count()) ok('real display name shown on the table')
else fail('display name not shown on table')

// Touch-target audit: every button/select/link ≥44px in a dimension.
const small = await page.$$eval('button, select, a, input[type=checkbox]', (els) =>
  els
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ r: el.getBoundingClientRect(), t: (el.textContent || el.tagName).trim().slice(0, 30) }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44 && r.width < 44)
    .map(({ t, r }) => `${t} (${Math.round(r.width)}x${Math.round(r.height)})`),
)
if (small.length === 0) ok('all visible interactive controls ≥44px in a dimension')
else fail(`controls under 44px: ${small.join(', ')}`)

if (errors.length) fail(`console/page errors: ${errors.slice(0, 5).join(' | ')}`)
else ok('no console/page errors during the flow')

await browser.close()
console.log(`\nScreenshots in ${OUT}`)
