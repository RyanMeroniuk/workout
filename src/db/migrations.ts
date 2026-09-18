import { getDB } from './db'
import type { ID, Session } from './types'

/**
 * One-time data migrations, run on boot before the first paint.
 *
 * Each migration records a flag in the `meta` store so it runs exactly once.
 * Flag keys are permanent — never reuse one, and give any future cleanup its own.
 */

const DROP_SEED_FLAG = 'migration:drop-seed-data-v1'

/**
 * Ids of the default program Slots used to ship. This is a FROZEN COPY, deliberately
 * not imported from anywhere: the module that defined it has been deleted, and a
 * migration that depends on live app code breaks the next time the app is refactored.
 *
 * Extracted programmatically from the old src/db/seed.ts — 45 ids, no duplicates. A
 * hand-typed list with one typo would leave that exercise permanently uncleanable,
 * because this runs once and then never again.
 */
const SEEDED_WORKOUT_IDS: readonly ID[] = ['workout-upper', 'workout-full-body']

const SEEDED_EXERCISE_IDS: readonly ID[] = [
  'incline-bb-bench', 'incline-db-press', 'incline-machine-press', 'low-high-cable-fly',
  'flat-bb-bench', 'flat-db-press', 'machine-chest-press', 'cable-fly', 'dips',
  'lat-pulldown', 'neutral-cable-pulldown', 'db-row', 'pull-ups', 'machine-pullover',
  'chest-supported-row', 'seated-cable-row', 'bb-row', 't-bar-row',
  'ohp', 'seated-db-press', 'machine-shoulder-press',
  'db-lateral-raise', 'cable-lateral-raise', 'machine-lateral-raise',
  'reverse-pec-deck', 'cable-reverse-fly', 'db-rear-delt-fly', 'face-pull',
  'bb-curl', 'db-curl', 'incline-db-curl', 'cable-curl', 'preacher-curl',
  'cable-pushdown', 'overhead-cable-ext', 'skull-crusher',
  'bb-squat', 'leg-press', 'hack-squat', 'goblet-squat', 'leg-extension',
  'rdl', 'db-rdl', 'seated-leg-curl', 'lying-leg-curl',
]

/**
 * Every exercise id any session points at.
 *
 * Reads BOTH `Session.exerciseIds` and `entries[].exerciseId`. The `by-exercise` index
 * would be faster, but it is built over `exerciseIds` — the denormalized field. If that
 * ever drifts from `entries[]` (a hand-edited backup, which repo.parseBundle explicitly
 * tolerates), an index probe misses and we would permanently delete an exercise that
 * history still references. `entries[]` is the source of truth; the union is the safe read.
 */
function referencedExerciseIds(sessions: Session[]): Set<ID> {
  const ids = new Set<ID>()
  for (const s of sessions) {
    for (const id of s.exerciseIds) ids.add(id)
    for (const e of s.entries) ids.add(e.exerciseId)
  }
  return ids
}

/**
 * Deletes the default program Slots used to seed on first launch, so the app starts
 * empty and everything in it is something you made.
 *
 * Keeps any seeded exercise you have actually logged against, so no history is orphaned.
 * That check is deliberately more permissive than `historyFor()`, which ignores unfinished
 * sessions and undone sets: an in-progress session pointing at a deleted exercise renders
 * a blank logger mid-workout.
 *
 * Runs as a single transaction so a failure rolls back whole and simply retries next launch.
 */
async function dropSeedData(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['exercises', 'workouts', 'sessions', 'meta'], 'readwrite')

  const meta = tx.objectStore('meta')
  if (await meta.get(DROP_SEED_FLAG)) {
    await tx.done
    return
  }

  const sessionStore = tx.objectStore('sessions')
  const workoutStore = tx.objectStore('workouts')
  const exerciseStore = tx.objectStore('exercises')

  // Skip the scan entirely for anyone who installed but never logged.
  const sessions = (await sessionStore.count()) > 0 ? await sessionStore.getAll() : []
  const referenced = referencedExerciseIds(sessions)

  for (const id of SEEDED_WORKOUT_IDS) {
    // Deleting a missing key is a no-op, so no existence check needed.
    void workoutStore.delete(id)
  }

  let deletedExercises = 0
  for (const id of SEEDED_EXERCISE_IDS) {
    if (referenced.has(id)) continue
    void exerciseStore.delete(id)
    deletedExercises++
  }

  // A live session on a workout we just deleted is unloggable — workoutById returns
  // undefined, the slot list renders empty, and the only way out is Discard.
  let deletedSessions = 0
  for (const s of sessions) {
    if (s.finishedAt === null && SEEDED_WORKOUT_IDS.includes(s.workoutId)) {
      void sessionStore.delete(s.id)
      deletedSessions++
    }
  }

  void meta.put({
    key: DROP_SEED_FLAG,
    ranAt: Date.now(),
    deletedExercises,
    deletedSessions,
  })

  await tx.done
}

export async function runPendingMigrations(): Promise<void> {
  await dropSeedData()
}
