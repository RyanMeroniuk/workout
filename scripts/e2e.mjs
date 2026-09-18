/**
 * End-to-end verification of the things that are easy to get wrong and impossible
 * to eyeball: the app starting genuinely empty, the one-time seed cleanup, creating
 * an exercise mid-workout, IndexedDB surviving a reload, per-exercise history
 * following an exercise across slots, offline operation, and export/import.
 *
 * Run against a production build:  npm run verify
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/workout/'
const SEED_FLAG = 'migration:drop-seed-data-v1'

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

async function hidden(locator, timeout = 1500) {
  return !(await visible(locator, timeout))
}

// ---------------------------------------------------------------- IDB helpers

/**
 * Runs `fn({ getAll, get })` inside the page against the live `slots` database.
 * Factored out because asserting against raw rows — rather than rendered output —
 * is the only way to know a write actually landed.
 */
function readIDB(page, fn) {
  return page.evaluate(async (src) => {
    const open = indexedDB.open('slots')
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    const getAll = (store) =>
      new Promise((res, rej) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
    const get = (store, key) =>
      new Promise((res, rej) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
    const byIndex = (store, index, key) =>
      new Promise((res, rej) => {
        const req = db
          .transaction(store, 'readonly')
          .objectStore(store)
          .index(index)
          .getAll(key)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
    const f = new Function('ctx', `return (${src})(ctx)`)
    const out = await f({ getAll, get, byIndex })
    db.close()
    return out
  }, fn.toString())
}

/** Writes fixture rows and re-arms the migration by deleting its flag. */
function injectLegacyData(page, fixture) {
  return page.evaluate(async (fx) => {
    const open = indexedDB.open('slots')
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    await new Promise((res, rej) => {
      const tx = db.transaction(['exercises', 'workouts', 'sessions', 'meta'], 'readwrite')
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error)
      for (const e of fx.exercises ?? []) tx.objectStore('exercises').put(e)
      for (const w of fx.workouts ?? []) tx.objectStore('workouts').put(w)
      for (const s of fx.sessions ?? []) tx.objectStore('sessions').put(s)
      if (fx.clearFlag) tx.objectStore('meta').delete(fx.flagKey)
    })
    db.close()
  }, fixture)
}

// ---------------------------------------------------------------- UI helpers

const TAB_HEADER = { Home: 'Slots', History: 'History', Library: 'Exercises', Settings: 'Settings' }

async function gotoTab(page, name) {
  await page.locator('.tab').filter({ hasText: name }).click()
  await page.locator('.header-title', { hasText: TAB_HEADER[name] }).waitFor({ timeout: 5000 })
}

async function logSet(page, weight, reps) {
  await page.locator('#w').fill(String(weight))
  await page.locator('#r').fill(String(reps))
  await page.getByRole('button', { name: 'Add set' }).click()
}

/** Home "+" → name the workout → back to Home. */
async function newWorkout(page, name) {
  await page.getByRole('button', { name: 'New workout' }).click()
  await page.locator('.header-title', { hasText: 'Edit workout' }).waitFor()
  await page.getByPlaceholder('Workout name').fill(name)
}

async function addSlot(page, name) {
  await page.getByPlaceholder('New slot, e.g. Rear delts').fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator(`input[value="${name}"]`).waitFor()
}

/** In Edit Workout: open a slot's pool sheet, create an exercise into it, close. */
async function addExerciseToPool(page, slotName, exerciseName) {
  const card = page.locator('.card').filter({ has: page.locator(`input[value="${slotName}"]`) })
  await card.locator('button.btn.sm.ghost').click()
  await page.locator('.sheet').waitFor()
  await page.getByPlaceholder('Exercise name').fill(exerciseName)
  await page.getByRole('button', { name: 'Create and add' }).click()
  await page.locator('.sheet').getByText(exerciseName).first().waitFor()
  await page.locator('.sheet-head').getByRole('button', { name: 'Done' }).click()
  await page.locator('.sheet').waitFor({ state: 'detached' })
}

async function startWorkout(page, name) {
  await page
    .locator('.card')
    .filter({ hasText: name })
    .first()
    .getByRole('button', { name: 'Start' })
    .click()
  await page.getByRole('button', { name: 'Finish workout' }).waitFor()
}

async function finishWorkout(page) {
  await page.getByRole('button', { name: 'Finish workout' }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  // The app navigates home only once the write has committed, and the tab bar is
  // hidden during a session — so this doubles as the signal that the flush landed.
  await page.locator('.tab', { hasText: 'Settings' }).waitFor({ timeout: 10_000 })
}

// ---------------------------------------------------------------- run

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
  // ================================================================ phase 0
  section('First run is completely empty')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('.header-title').waitFor()

  check('Home shows empty state', await visible(page.getByText('No workouts yet', { exact: false })))

  const virgin = await readIDB(page, async ({ getAll, get }) => ({
    exercises: (await getAll('exercises')).length,
    workouts: (await getAll('workouts')).length,
    sessions: (await getAll('sessions')).length,
    flag: !!(await get('meta', 'migration:drop-seed-data-v1')),
  }))
  check(
    'No seeded data written on a virgin install',
    virgin.exercises === 0 && virgin.workouts === 0 && virgin.sessions === 0,
    JSON.stringify(virgin),
  )
  check('Migration flag recorded on virgin install', virgin.flag === true)

  await gotoTab(page, 'Library')
  check('Library shows empty state', await visible(page.getByText('No exercises yet', { exact: false })))
  await gotoTab(page, 'History')
  check('History shows empty state', await visible(page.getByText('No finished workouts yet', { exact: false })))

  // ================================================================ phase 1
  section('One-time seed cleanup migration')

  const finishedAt = Date.now() - 86_400_000
  await injectLegacyData(page, {
    flagKey: SEED_FLAG,
    clearFlag: true,
    exercises: [
      { id: 'incline-bb-bench', name: 'Incline barbell bench', equipment: 'barbell', createdAt: 1 },
      { id: 'dips', name: 'Dips', equipment: 'bodyweight', createdAt: 2 },
      { id: 'bb-curl', name: 'Barbell curl', createdAt: 3 }, // legacy row with NO equipment
      { id: 'lat-pulldown', name: 'Lat pulldown', equipment: 'machine', createdAt: 4 },
    ],
    workouts: [
      {
        id: 'workout-upper',
        name: 'Upper',
        order: 0,
        createdAt: 1,
        slots: [{ id: 'upper-lats', name: 'Lats', exerciseIds: ['lat-pulldown'] }],
      },
      { id: 'workout-full-body', name: 'Full Body', order: 1, createdAt: 2, slots: [] },
      {
        id: 'mine-uuid',
        name: 'My Own',
        order: 2,
        createdAt: 3,
        slots: [{ id: 's1', name: 'Chest', exerciseIds: ['incline-bb-bench'] }],
      },
    ],
    sessions: [
      {
        id: 'sess-1',
        workoutId: 'workout-upper',
        workoutName: 'Upper',
        startedAt: finishedAt,
        finishedAt: finishedAt + 3_600_000,
        skippedSlotIds: [],
        exerciseIds: ['incline-bb-bench'],
        entries: [
          {
            exerciseId: 'incline-bb-bench',
            slotId: 'upper-chest',
            slotName: 'Upper chest',
            sets: [{ id: 'a', weight: 135, reps: 8, done: true }],
          },
        ],
      },
      {
        // DRIFT: entries reference dips + bb-curl, but exerciseIds is empty. An
        // implementation that trusts the by-exercise index would delete both.
        id: 'sess-2',
        workoutId: 'mine-uuid',
        workoutName: 'My Own',
        startedAt: finishedAt,
        finishedAt: finishedAt + 3_600_000,
        skippedSlotIds: [],
        exerciseIds: [],
        entries: [
          {
            exerciseId: 'dips',
            slotId: 's1',
            slotName: 'Chest',
            sets: [{ id: 'b', weight: 0, reps: 12, done: true }],
          },
          {
            exerciseId: 'bb-curl',
            slotId: 's1',
            slotName: 'Chest',
            sets: [{ id: 'c', weight: 60, reps: 10, done: true }],
          },
        ],
      },
    ],
  })

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.header-title').waitFor()

  const afterMigration = await readIDB(page, async ({ getAll, get }) => {
    const workouts = await getAll('workouts')
    const exercises = await getAll('exercises')
    return {
      workoutIds: workouts.map((w) => w.id),
      mineSlots: workouts.find((w) => w.id === 'mine-uuid')?.slots?.length ?? -1,
      exerciseIds: exercises.map((e) => e.id).sort(),
      sessions: (await getAll('sessions')).length,
      flag: !!(await get('meta', 'migration:drop-seed-data-v1')),
    }
  })

  check(
    'Seeded workouts deleted',
    !afterMigration.workoutIds.includes('workout-upper') &&
      !afterMigration.workoutIds.includes('workout-full-body'),
    JSON.stringify(afterMigration.workoutIds),
  )
  check(
    'Your own workout untouched',
    afterMigration.workoutIds.includes('mine-uuid') && afterMigration.mineSlots === 1,
    JSON.stringify(afterMigration),
  )
  check(
    'Unreferenced seeded exercise deleted',
    !afterMigration.exerciseIds.includes('lat-pulldown'),
    JSON.stringify(afterMigration.exerciseIds),
  )
  check(
    'Exercise referenced via exerciseIds survives',
    afterMigration.exerciseIds.includes('incline-bb-bench'),
  )
  check(
    'Exercise referenced ONLY via entries[] survives (index-drift guard)',
    afterMigration.exerciseIds.includes('dips') && afterMigration.exerciseIds.includes('bb-curl'),
    JSON.stringify(afterMigration.exerciseIds),
  )
  check('Logged history never touched', afterMigration.sessions === 2, `${afterMigration.sessions}`)
  check('Migration flag written', afterMigration.flag === true)

  await gotoTab(page, 'History')
  check(
    'Old session still renders via its snapshot name',
    await visible(page.getByText('Upper', { exact: false })),
  )
  await gotoTab(page, 'Library')
  check(
    'Legacy row with no equipment field renders fine',
    await visible(page.getByText('Barbell curl', { exact: false })),
  )

  // idempotence: flag is set now, so re-injecting must NOT be cleaned up again
  await injectLegacyData(page, {
    flagKey: SEED_FLAG,
    clearFlag: false,
    exercises: [{ id: 'lat-pulldown', name: 'Lat pulldown', createdAt: 9 }],
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.header-title').waitFor()
  const rerun = await readIDB(page, async ({ get }) => !!(await get('exercises', 'lat-pulldown')))
  check('Migration does not run twice', rerun === true)

  // clean slate for the rest, via the real UI
  await gotoTab(page, 'Settings')
  await page.getByRole('button', { name: 'Erase all data' }).click()
  await page.getByRole('button', { name: 'Erase everything' }).click()
  await page.getByText('All data erased', { exact: false }).waitFor({ timeout: 10_000 })
  const afterWipe = await readIDB(page, async ({ getAll, get }) => ({
    workouts: (await getAll('workouts')).length,
    flag: !!(await get('meta', 'migration:drop-seed-data-v1')),
  }))
  check('Wipe empties the database', afterWipe.workouts === 0)
  check('Wipe preserves the migration flag', afterWipe.flag === true, JSON.stringify(afterWipe))

  // ================================================================ phase 2
  section('Author a program through the UI')
  await gotoTab(page, 'Home')
  await newWorkout(page, 'Push')
  await addSlot(page, 'Chest')
  await addSlot(page, 'Shoulders')
  await addSlot(page, 'Triceps')
  await addExerciseToPool(page, 'Chest', 'Barbell bench')
  await addExerciseToPool(page, 'Chest', 'Machine chest press')
  check(
    'No equipment picker in the pool editor',
    (await page.getByRole('button', { name: 'dumbbell' }).count()) === 0,
  )

  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()
  check('Authored workout on Home', await visible(page.getByText('Push', { exact: true })))
  check('Slot count shown', await visible(page.getByText('3 slots', { exact: false })))

  // ================================================================ phase 3
  section('Create an exercise mid-workout (the new flow)')
  await startWorkout(page, 'Push')
  await page.getByText('Shoulders').first().click()
  await page.getByPlaceholder('Search or add an exercise').waitFor()
  check(
    'Empty slot explains the create flow',
    await visible(page.getByText('Nothing in this slot yet', { exact: false })),
  )

  await page.getByPlaceholder('Search or add an exercise').fill('Lateral raise')
  check('Create button offered', await visible(page.getByRole('button', { name: 'Create "Lateral raise"' })))
  await page.getByRole('button', { name: 'Create "Lateral raise"' }).click()
  await page.locator('#w').waitFor()
  check('Logger opens straight onto the new exercise', await visible(page.getByText('Lateral raise')))

  await logSet(page, 20, 15)
  check('Logged a set on the new exercise', (await page.locator('.set-row').count()) === 1)

  const pool = await readIDB(page, async ({ getAll }) => {
    const w = (await getAll('workouts')).find((x) => x.name === 'Push')
    const slot = w?.slots.find((s) => s.name === 'Shoulders')
    const ex = await getAll('exercises')
    const lat = ex.find((e) => e.name === 'Lateral raise')
    return {
      inPool: !!(lat && slot?.exerciseIds.includes(lat.id)),
      hasEquipment: lat ? 'equipment' in lat : null,
    }
  })
  check('New exercise persisted into the slot pool', pool.inPool === true, JSON.stringify(pool))
  check('New exercise has no equipment field', pool.hasEquipment === false)

  // dedupe guard — different case must NOT offer to create a second record
  await page.getByRole('button', { name: 'Swap exercise' }).click()
  await page.locator('.sheet').waitFor()
  await page.getByPlaceholder('Search or add an exercise').fill('lateral raise')
  check(
    'Case-different duplicate is not offered for creation',
    await hidden(page.getByRole('button', { name: /^Create "/ })),
  )
  check(
    'Existing exercise offered instead',
    await visible(page.locator('.sheet').getByText('Lateral raise')),
  )
  await page.locator('.sheet-head').getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Back' }).click()

  // ================================================================ phase 4
  section('Logging, persistence, and per-exercise history')
  await page.getByText('Chest').first().click()
  await page.getByText('Barbell bench').first().click()
  await page.locator('#w').waitFor()
  check(
    'First-time message for an unlogged exercise',
    await visible(page.getByText('First time doing this one', { exact: false })),
  )
  await logSet(page, 135, 8)
  await logSet(page, 135, 6)
  check('Two sets logged', (await page.locator('.set-row').count()) === 2)
  check('Weight prefilled from previous set', (await page.locator('#w').inputValue()) === '135')
  await page.getByRole('button', { name: 'More weight' }).click()
  check('2.5 lb stepper', (await page.locator('#w').inputValue()) === '137.5')
  await page.getByRole('button', { name: 'Back' }).click()
  await finishWorkout(page)

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.header-title').waitFor()
  check('Last-session date on Home', await visible(page.getByText('last Today', { exact: false })))

  const ids = await readIDB(page, async ({ getAll }) => {
    const map = {}
    for (const e of await getAll('exercises')) map[e.name] = e.id
    return map
  })
  const persisted = await readIDB(page, async ({ getAll, byIndex }) => {
    const sessions = await getAll('sessions')
    const bench = (await getAll('exercises')).find((e) => e.name === 'Barbell bench')
    return {
      sessions: sessions.length,
      sets: sessions.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.length, 0), 0),
      indexHits: bench ? (await byIndex('sessions', 'by-exercise', bench.id)).length : -1,
      denorm: sessions[0]?.exerciseIds?.length ?? -1,
    }
  })
  check('Session persisted', persisted.sessions === 1, JSON.stringify(persisted))
  check('All sets persisted', persisted.sets === 3, JSON.stringify(persisted))
  check('by-exercise multiEntry index resolves', persisted.indexHits === 1, JSON.stringify(persisted))
  check('Denormalized exerciseIds written', persisted.denorm === 2, JSON.stringify(persisted))

  await startWorkout(page, 'Push')
  await page.getByText('Chest').first().click()
  await page.getByText('Barbell bench').first().click()
  await page.locator('#w').waitFor()
  check('"Last time" shows previous sets', await visible(page.getByText('135 × 8', { exact: false })))
  const refill = await page.locator('#w').inputValue()
  check('Weight prefilled from last session', refill === '135', `got "${refill}"`)

  // same exercise, different slot — history must follow the exercise
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByText('Triceps').first().click()
  await page.getByPlaceholder('Search or add an exercise').fill('Barbell bench')
  await page.getByText('Barbell bench').first().click()
  await page.locator('#w').waitFor()
  check(
    'History follows the exercise across slots',
    await visible(page.getByText('135 × 8', { exact: false })),
  )

  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Discard' }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).last().click()
  await page.locator('.tab', { hasText: 'Settings' }).waitFor({ timeout: 10_000 })

  // ================================================================ phase 5
  section('Exercise detail + graph')
  await gotoTab(page, 'Library')
  await page.getByPlaceholder('Search exercises').fill('Barbell bench')
  await page.getByText('Barbell bench', { exact: true }).first().click()
  await page.getByText('Last time').waitFor()
  check('Detail opens', await visible(page.getByText('Progress')))
  check('SVG chart rendered', (await page.locator('.chart svg polyline').count()) > 0)
  await page.getByRole('button', { name: 'Top set' }).click()
  check('Metric toggle works', (await page.locator('.chart svg polyline').count()) > 0)
  check('Slot membership shown', await visible(page.getByText('Push · Chest', { exact: false })))

  // ================================================================ phase 6
  section('Editing: slots, pools, reorder')
  await gotoTab(page, 'Home')
  await page.getByRole('button', { name: 'Edit Push' }).click()
  await page.locator('.header-title', { hasText: 'Edit workout' }).waitFor()

  const firstBefore = await page.locator('.card input').first().inputValue()
  await page.getByRole('button', { name: 'Move down' }).first().click()
  const firstAfter = await page.locator('.card input').first().inputValue()
  check(
    'Slot reorder works',
    firstBefore === 'Chest' && firstAfter === 'Shoulders',
    `${firstBefore} -> ${firstAfter}`,
  )
  await page.getByRole('button', { name: 'Move up' }).nth(1).click()

  await addSlot(page, 'Forearms')
  check('Slot added', await visible(page.locator('input[value="Forearms"]')))
  await addExerciseToPool(page, 'Forearms', 'Wrist curl')
  check('Exercise created into pool', await visible(page.getByText('Wrist curl')))

  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()

  // workout reorder needs a second workout to move against; delete it afterwards so
  // the export counts below stay predictable
  await newWorkout(page, 'Temp')
  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()
  const before = await page.locator('.card strong').allTextContents()

  await page.getByRole('button', { name: 'Edit Temp' }).click()
  await page.getByRole('button', { name: 'Move workout up' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()
  const after = await page.locator('.card strong').allTextContents()
  check(
    'Workout reorder works',
    before[0] === 'Push' && after[0] === 'Temp',
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  )

  await page.getByRole('button', { name: 'Edit Temp' }).click()
  await page.getByRole('button', { name: 'Delete workout' }).click()
  await page.getByRole('button', { name: 'Delete workout', exact: true }).last().click()
  await page.locator('.header-title', { hasText: 'Slots' }).waitFor()
  const remaining = await page.locator('.card strong').allTextContents()
  check('Workout delete works', remaining.length === 1 && remaining[0] === 'Push', JSON.stringify(remaining))

  // ================================================================ phase 7
  section('Offline (service worker)')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  check('Service worker registered', await page.evaluate(() => !!navigator.serviceWorker.controller))

  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.card').first().waitFor({ timeout: 10_000 })
  check('App boots offline', await visible(page.getByText('Push', { exact: true })))

  await startWorkout(page, 'Push')
  await page.getByText('Chest').first().click()
  await page.getByText('Machine chest press').first().click()
  await page.locator('#w').waitFor()
  await logSet(page, 90, 12)
  check('Can log a set offline', (await page.locator('.set-row').count()) === 1)

  // creating an exercise offline is the whole point of a local-only app
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByText('Forearms').first().click()
  await page.getByPlaceholder('Search or add an exercise').fill('Reverse curl')
  await page.getByRole('button', { name: 'Create "Reverse curl"' }).click()
  await page.locator('#w').waitFor()
  await logSet(page, 45, 12)
  check('Can create an exercise offline', (await page.locator('.set-row').count()) === 1)

  await page.getByRole('button', { name: 'Back' }).click()
  await finishWorkout(page)
  await ctx.setOffline(false)

  await page.reload({ waitUntil: 'networkidle' })
  const offline = await readIDB(page, async ({ getAll }) => {
    const s = await getAll('sessions')
    return { total: s.length, finished: s.filter((x) => x.finishedAt !== null).length }
  })
  check('Offline session persisted and finished', offline.total === 2 && offline.finished === 2, JSON.stringify(offline))

  // ================================================================ phase 8
  section('Export / wipe / import round-trip')
  await gotoTab(page, 'Settings')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export all data (JSON)' }).click()
  const download = await dl
  const path = await download.path()
  const bundle = JSON.parse(readFileSync(path, 'utf8'))

  check('Export is a valid bundle', bundle.format === 'slots-export')
  check('Export version is 2', bundle.version === 2, `got ${bundle.version}`)
  check('Exported exercises carry no equipment field', bundle.exercises.every((e) => !('equipment' in e)))
  check('Export contains both sessions', bundle.sessions.length === 2, `${bundle.sessions.length}`)
  check('Export contains the authored workout', bundle.workouts.length === 1, `${bundle.workouts.length}`)

  await page.getByRole('button', { name: 'Erase all data' }).click()
  await page.getByRole('button', { name: 'Erase everything' }).click()
  await page.getByText('All data erased', { exact: false }).waitFor({ timeout: 10_000 })

  await page.setInputFiles('input[type=file]', path)
  await page.getByRole('button', { name: 'Replace my data' }).click()
  await page.getByText('Backup restored', { exact: false }).waitFor({ timeout: 10_000 })
  const restored = await readIDB(page, async ({ getAll }) => ({
    sessions: (await getAll('sessions')).length,
    workouts: (await getAll('workouts')).length,
  }))
  check('Import restores everything', restored.sessions === 2 && restored.workouts === 1, JSON.stringify(restored))

  await page.reload({ waitUntil: 'networkidle' })
  await gotoTab(page, 'History')
  check('Restored data survives reload', (await page.locator('.card').count()) >= 2)

  // a v1 backup — written before `equipment` was removed — must still import
  section('Legacy v1 backup import')
  const v1Path = join(tmpdir(), 'slots-v1-backup.json')
  writeFileSync(
    v1Path,
    JSON.stringify({
      format: 'slots-export',
      version: 1,
      exportedAt: Date.now(),
      exercises: [{ id: 'old-1', name: 'Old Bench', equipment: 'barbell', createdAt: 1 }],
      workouts: [
        {
          id: 'old-w',
          name: 'Legacy',
          order: 0,
          createdAt: 1,
          slots: [{ id: 'old-s', name: 'Chest', exerciseIds: ['old-1'] }],
        },
      ],
      sessions: [
        {
          id: 'old-sess',
          workoutId: 'old-w',
          workoutName: 'Legacy',
          startedAt: finishedAt,
          finishedAt: finishedAt + 1000,
          skippedSlotIds: [],
          exerciseIds: ['old-1'],
          entries: [
            {
              exerciseId: 'old-1',
              slotId: 'old-s',
              slotName: 'Chest',
              sets: [{ id: 'z', weight: 100, reps: 5, done: true }],
            },
          ],
        },
      ],
    }),
  )

  await gotoTab(page, 'Settings')
  await page.setInputFiles('input[type=file]', v1Path)
  await page.getByRole('button', { name: 'Replace my data' }).click()
  await page.getByText('Backup restored', { exact: false }).waitFor({ timeout: 10_000 })
  const v1 = await readIDB(page, async ({ get }) => {
    const e = await get('exercises', 'old-1')
    return { name: e?.name, hasEquipment: e ? 'equipment' in e : null }
  })
  check('v1 backup imports', v1.name === 'Old Bench', JSON.stringify(v1))
  check('v1 equipment field stripped on import', v1.hasEquipment === false, JSON.stringify(v1))

  await gotoTab(page, 'Library')
  check('Imported legacy exercise renders', await visible(page.getByText('Old Bench')))
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
