import { getDB } from './db'
import { buildSeedData } from './seed'
import type { Exercise, ExportBundle, ID, Session, Workout } from './types'

export const EXPORT_VERSION = 1

export function uid(): ID {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Keeps the denormalized index field in sync. Call on every session write. */
export function withExerciseIds(session: Session): Session {
  const ids = new Set<ID>()
  for (const entry of session.entries) ids.add(entry.exerciseId)
  return { ...session, exerciseIds: [...ids] }
}

export interface Snapshot {
  exercises: Exercise[]
  workouts: Workout[]
  sessions: Session[]
}

/** One transaction, whole database. This is the app's only read from disk. */
export async function loadAll(): Promise<Snapshot> {
  const db = await getDB()
  const tx = db.transaction(['exercises', 'workouts', 'sessions'], 'readonly')
  const [exercises, workouts, sessions] = await Promise.all([
    tx.objectStore('exercises').getAll(),
    tx.objectStore('workouts').getAll(),
    tx.objectStore('sessions').getAll(),
  ])
  await tx.done
  return { exercises, workouts, sessions }
}

export async function seedIfEmpty(): Promise<boolean> {
  const db = await getDB()
  const count = await db.count('workouts')
  if (count > 0) return false

  const { exercises, workouts } = buildSeedData()
  const tx = db.transaction(['exercises', 'workouts'], 'readwrite')
  for (const e of exercises) void tx.objectStore('exercises').put(e)
  for (const w of workouts) void tx.objectStore('workouts').put(w)
  await tx.done
  return true
}

// ---------- writes ----------

export async function putExercise(e: Exercise) {
  const db = await getDB()
  await db.put('exercises', e)
}

export async function deleteExercise(id: ID) {
  const db = await getDB()
  await db.delete('exercises', id)
}

export async function putWorkout(w: Workout) {
  const db = await getDB()
  await db.put('workouts', w)
}

export async function putWorkouts(ws: Workout[]) {
  const db = await getDB()
  const tx = db.transaction('workouts', 'readwrite')
  for (const w of ws) void tx.store.put(w)
  await tx.done
}

export async function deleteWorkout(id: ID) {
  const db = await getDB()
  await db.delete('workouts', id)
}

export async function putSession(s: Session) {
  const db = await getDB()
  await db.put('sessions', withExerciseIds(s))
}

export async function deleteSession(id: ID) {
  const db = await getDB()
  await db.delete('sessions', id)
}

// ---------- export / import / wipe ----------

export async function exportAll(): Promise<ExportBundle> {
  const { exercises, workouts, sessions } = await loadAll()
  return {
    format: 'slots-export',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    exercises,
    workouts,
    sessions,
  }
}

export function parseBundle(text: string): ExportBundle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('That file is not a Slots backup.')

  const b = raw as Partial<ExportBundle>
  if (b.format !== 'slots-export') throw new Error('That file is not a Slots backup.')
  if (typeof b.version !== 'number' || b.version > EXPORT_VERSION) {
    throw new Error('That backup was made by a newer version of Slots.')
  }
  if (!Array.isArray(b.exercises) || !Array.isArray(b.workouts) || !Array.isArray(b.sessions)) {
    throw new Error('That backup is missing data.')
  }
  return b as ExportBundle
}

/** Replaces everything. Destructive by design — the Settings screen confirms first. */
export async function importAll(bundle: ExportBundle): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['exercises', 'workouts', 'sessions'], 'readwrite')
  await Promise.all([
    tx.objectStore('exercises').clear(),
    tx.objectStore('workouts').clear(),
    tx.objectStore('sessions').clear(),
  ])
  for (const e of bundle.exercises) void tx.objectStore('exercises').put(e)
  for (const w of bundle.workouts) void tx.objectStore('workouts').put(w)
  for (const s of bundle.sessions) {
    // Older/hand-edited backups may lack the denormalized field; rebuild it.
    void tx.objectStore('sessions').put(withExerciseIds(s))
  }
  await tx.done
}

export async function wipeAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['exercises', 'workouts', 'sessions', 'meta'], 'readwrite')
  await Promise.all([
    tx.objectStore('exercises').clear(),
    tx.objectStore('workouts').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('meta').clear(),
  ])
  await tx.done
}
