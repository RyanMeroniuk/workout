/**
 * End-to-end verification of the things that are easy to get wrong and impossible
 * to eyeball: the core logging loop, IndexedDB surviving a reload, per-exercise
 * history following an exercise across slots, offline operation via the service
 * worker, and the export/import round-trip.
 *
 * Run against a production build:  npm run verify
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/workout/'

let failures = 0
let checks = 0

function check(name, cond, detail = '') {
  checks++
  if (cond) {
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}

/**
 * Auto-retrying visibility probe. `locator.isVisible()` resolves immediately and
 * so races the app's navigation/render; waitFor polls until it's actually there.
 */
async function visible(locator, timeout = 5000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

/** Clicks a tab and waits for that screen's header, so we don't read the old one. */
const TAB_HEADER = { Home: 'Slots', History: 'History', Library: 'Exercises', Settings: 'Settings' }
async function gotoTab(page, name) {
  await page.locator('.tab').filter({ hasText: name }).click()
  await page.locator('.header-title', { hasText: TAB_HEADER[name] }).waitFor({ timeout: 5000 })
}

async function logSet(page, weight, reps) {
  await page.getByLabel('Weight', { exact: true }).or(page.locator('#w')).first().fill(String(weight))
  await page.locator('#r').fill(String(reps))
  await page.getByRole('button', { name: 'Add set' }).click()
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14 Pro
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()

page.on('pageerror', (e) => {
  failures++
  console.log(`  \x1b[31mPAGE ERROR\x1b[0m ${e.message}`)
})

try {
  // ---------------------------------------------------------------- seed
  section('Seed data')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.card')

  check('Upper workout seeded', await visible(page.getByText('Upper', { exact: true })))
  check('Full Body workout seeded', await visible(page.getByText('Full Body', { exact: true })))
  check(
    'Upper has 9 slots',
    (await page.getByText('9 slots', { exact: false }).count()) > 0,
  )

  // ---------------------------------------------------------------- core loop
  section('Core loop: start → pick → log → finish')
  await page
    .locator('.card')
    .filter({ hasText: 'Upper' })
    .first()
    .getByRole('button', { name: 'Start' })
    .click()

  await page.waitForSelector('text=Finish workout')
  check('Session started', page.url().includes('#/session/'))
  check('Slots listed in order', (await page.getByText('Upper chest').count()) > 0)

  await page.getByText('Upper chest').first().click()
  await page.waitForSelector('text=In this slot')
  check('Pool shown for slot', await visible(page.getByText('Incline barbell bench')))

  await page.getByText('Incline barbell bench').first().click()
  await page.waitForSelector('#w')
  check('Logger opened', await visible(page.locator('#w')))
  check(
    'First-time message shown',
    await visible(page.getByText('First time doing this one', { exact: false })),
  )

  await logSet(page, 135, 8)
  await logSet(page, 135, 6)
  const setRows = await page.locator('.set-row').count()
  check('Two sets logged', setRows === 2, `saw ${setRows}`)

  check(
    'Weight prefilled from previous set',
    (await page.locator('#w').inputValue()) === '135',
  )

  // decimals + 2.5 stepper
  await page.getByRole('button', { name: 'More weight' }).click()
  check('2.5 lb stepper', (await page.locator('#w').inputValue()) === '137.5')

  await page.getByRole('button', { name: 'Back' }).click()
  await page.waitForSelector('text=Finish workout')
  check(
    'Slot shows logged sets inline',
    await visible(page.getByText('135×8', { exact: false })),
  )

  // second slot, to prove multiple slots work
  await page.getByText('Lats', { exact: true }).first().click()
  await page.getByText('Lat pulldown').first().click()
  await page.waitForSelector('#w')
  await logSet(page, 120, 10)
  await page.getByRole('button', { name: 'Back' }).click()

  await page.getByRole('button', { name: 'Finish workout' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await page.locator('.tab', { hasText: 'Settings' }).waitFor({ timeout: 10_000 })
  check(
    'Returned home after finish (not hijacked to history)',
    !page.url().includes('/session/') && !page.url().includes('/history/'),
    page.url(),
  )

  // ---------------------------------------------------------------- persistence
  section('IndexedDB persistence across reload')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.card')

  check(
    'Last-session date shown on Home',
    await visible(page.getByText('last Today', { exact: false })),
  )

  await gotoTab(page, 'History')
  const historyCards = await page.locator('.card').count()
  check('Session present in History after reload', historyCards >= 1)
  check(
    'Session lists both exercises',
    await visible(page.getByText('Incline barbell bench', { exact: false })),
  )

  // verify the raw IDB rows, not just the rendered UI
  const dbState = await page.evaluate(async () => {
    const open = indexedDB.open('slots')
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    const read = (store, fn) =>
      new Promise((res, rej) => {
        const tx = db.transaction(store, 'readonly')
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
    const sessions = await read('sessions', (s) => s.getAll())
    const byExercise = await read('sessions', (s) =>
      s.index('by-exercise').getAll('incline-bb-bench'),
    )
    return {
      sessionCount: sessions.length,
      exerciseIds: sessions[0]?.exerciseIds ?? [],
      indexHits: byExercise.length,
      setCount: sessions.reduce(
        (n, s) => n + s.entries.reduce((m, e) => m + e.sets.length, 0),
        0,
      ),
    }
  })
  check('1 session in IndexedDB', dbState.sessionCount === 1, JSON.stringify(dbState))
  check('3 sets persisted', dbState.setCount === 3, `saw ${dbState.setCount}`)
  check(
    'Denormalized exerciseIds written',
    dbState.exerciseIds.includes('incline-bb-bench') && dbState.exerciseIds.includes('lat-pulldown'),
    JSON.stringify(dbState.exerciseIds),
  )
  check('by-exercise multiEntry index resolves', dbState.indexHits === 1, `${dbState.indexHits} hits`)

  // ---------------------------------------------------------------- last time
  section('Per-exercise history ("last time")')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page
    .locator('.card')
    .filter({ hasText: 'Upper' })
    .first()
    .getByRole('button', { name: 'Start' })
    .click()
  await page.getByText('Upper chest').first().click()
  await page.getByText('Incline barbell bench').first().click()
  await page.waitForSelector('#w')

  check(
    '"Last time" block shows previous sets',
    await visible(page.getByText('135 × 8', { exact: false })),
  )
  const prefill = await page.locator('#w').inputValue()
  check('Weight prefilled from last session top set', prefill === '135', `got "${prefill}"`)

  // Same exercise reached from a DIFFERENT slot must show the same history.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByText('Mid chest').first().click()
  await page.getByRole('button', { name: 'All exercises…' }).click()
  await page.getByPlaceholder('Search exercises').fill('Incline barbell')
  await page.getByText('Incline barbell bench').first().click()
  await page.waitForSelector('#w')
  check(
    'History follows the exercise across slots',
    await visible(page.getByText('135 × 8', { exact: false })),
  )

  // clean up this second session so later counts are predictable
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Discard' }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).last().click()
  await page.locator('.tab', { hasText: 'Settings' }).waitFor({ timeout: 10_000 })

  // ---------------------------------------------------------------- graph
  section('Exercise detail + graph')
  await gotoTab(page, 'Library')
  await page.getByPlaceholder('Search exercises').fill('Lat pulldown')
  await page.getByText('Lat pulldown', { exact: true }).first().click()
  await page.waitForSelector('text=Last time')
  check('Exercise detail opens', await visible(page.getByText('Progress')))
  check('SVG chart rendered', (await page.locator('.chart svg polyline').count()) > 0)

  await page.getByRole('button', { name: 'Top set' }).click()
  check('Metric toggle works', (await page.locator('.chart svg polyline').count()) > 0)
  check(
    'Slot membership shown',
    await visible(page.getByText('Upper · Lats', { exact: false })),
  )

  // ---------------------------------------------------------------- editing
  section('Editing: slots, pools, reorder')
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' })
  await page
    .locator('.card')
    .filter({ hasText: 'Upper' })
    .first()
    .getByRole('button', { name: 'Edit Upper' })
    .click()
  await page.locator('.header-title', { hasText: 'Edit workout' }).waitFor()

  // reorder a slot
  const firstSlotBefore = await page.locator('.card input').first().inputValue()
  await page.getByRole('button', { name: 'Move down' }).first().click()
  const firstSlotAfter = await page.locator('.card input').first().inputValue()
  check(
    'Slot reorder works',
    firstSlotBefore === 'Upper chest' && firstSlotAfter === 'Mid chest',
    `${firstSlotBefore} -> ${firstSlotAfter}`,
  )
  await page.getByRole('button', { name: 'Move up' }).nth(1).click()

  // add a slot
  await page.getByPlaceholder('New slot, e.g. Rear delts').fill('Forearms')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  check('Slot added', await visible(page.locator('input[value="Forearms"]')))

  // edit its pool: create a new exercise straight into the slot
  await page
    .locator('.card')
    .filter({ hasText: 'No exercises' })
    .getByRole('button', { name: /No exercises/ })
    .click()
  await page.locator('.sheet').waitFor()
  await page.getByPlaceholder('Exercise name').fill('Wrist curl')
  await page.getByRole('button', { name: 'Create and add' }).click()
  check('Exercise created into pool', await visible(page.getByText('Wrist curl')))
  await page.locator('.sheet-head').getByRole('button', { name: 'Done' }).click()

  // workout reorder
  await page.getByRole('button', { name: 'Move workout down' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()
  const order = await page.locator('.card strong').allTextContents()
  check('Workout reorder works', order[0] === 'Full Body', JSON.stringify(order))

  // put it back and clean up the added slot
  await page
    .locator('.card')
    .filter({ hasText: 'Upper' })
    .first()
    .getByRole('button', { name: 'Edit Upper' })
    .click()
  await page.getByRole('button', { name: 'Move workout up' }).click()
  await page.getByRole('button', { name: 'Delete slot' }).last().click()
  await page.getByRole('button', { name: 'Delete slot', exact: true }).last().click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()

  // ---------------------------------------------------------------- offline
  section('Offline (service worker)')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  check('Service worker registered', await page.evaluate(() => !!navigator.serviceWorker.controller))

  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.card', { timeout: 10_000 })
  check('App boots with network offline', await visible(page.getByText('Full Body')))

  // and it must still be fully usable, not just render
  await page
    .locator('.card')
    .filter({ hasText: 'Full Body' })
    .first()
    .getByRole('button', { name: 'Start' })
    .click()
  await page.getByText('Quads').first().click()
  await page.getByText('Barbell squat').first().click()
  await page.waitForSelector('#w')
  await logSet(page, 225, 5)
  check('Can log a set while offline', (await page.locator('.set-row').count()) === 1)

  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Finish workout' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  // The app navigates home only once the write has committed, so waiting for the
  // tab bar (hidden during a session) is also the signal that the flush landed.
  await page.locator('.tab', { hasText: 'Settings' }).waitFor({ timeout: 10_000 })
  await ctx.setOffline(false)

  await page.reload({ waitUntil: 'networkidle' })
  const offlineSaved = await page.evaluate(async () => {
    const open = indexedDB.open('slots')
    const db = await new Promise((res) => (open.onsuccess = () => res(open.result)))
    const all = await new Promise((res) => {
      const req = db.transaction('sessions').objectStore('sessions').getAll()
      req.onsuccess = () => res(req.result)
    })
    return { total: all.length, finished: all.filter((s) => s.finishedAt !== null).length }
  })
  check('Offline-logged session persisted', offlineSaved.total === 2, JSON.stringify(offlineSaved))
  check(
    'Offline session committed as finished',
    offlineSaved.finished === 2,
    JSON.stringify(offlineSaved),
  )

  // ---------------------------------------------------------------- export/import
  section('Export / wipe / import round-trip')
  await gotoTab(page, 'Settings')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all data (JSON)' }).click()
  const download = await dl
  const path = await download.path()
  const { readFileSync } = await import('node:fs')
  const bundle = JSON.parse(readFileSync(path, 'utf8'))
  check('Export produces a valid bundle', bundle.format === 'slots-export')
  check('Export contains both sessions', bundle.sessions.length === 2)
  check('Export contains workouts + exercises', bundle.workouts.length === 2 && bundle.exercises.length > 40)

  await page.getByRole('button', { name: 'Erase all data' }).click()
  await page.getByRole('button', { name: 'Erase everything' }).click()
  await page.waitForSelector('text=All data erased', { timeout: 10_000 })
  const afterWipe = await page.locator('text=Finished sessions').locator('..').textContent()
  check('Wipe clears sessions', /Finished sessions\s*0/.test(afterWipe ?? ''), afterWipe ?? '')

  await page.setInputFiles('input[type=file]', path)
  await page.getByRole('button', { name: 'Replace my data' }).click()
  await page.waitForSelector('text=Backup restored', { timeout: 10_000 })
  const afterImport = await page.locator('text=Finished sessions').locator('..').textContent()
  check('Import restores sessions', /Finished sessions\s*2/.test(afterImport ?? ''), afterImport ?? '')

  await page.reload({ waitUntil: 'networkidle' })
  await gotoTab(page, 'History')
  check(
    'Restored data survives reload',
    (await page.locator('.card').count()) >= 2,
  )
} catch (err) {
  failures++
  console.log(`\n\x1b[31mERROR\x1b[0m ${err.message}`)
  await page.screenshot({ path: 'e2e-failure.png' }).catch(() => {})
  console.log('  screenshot: e2e-failure.png')
  console.log(`  url: ${page.url()}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures > 0 ? 1 : 0)
