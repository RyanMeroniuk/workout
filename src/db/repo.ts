import { getDB } from './db'
import type { Exercise, ExportBundle, ID, Session, Workout } from './types'

/**
 * Backup format version.
 *   v1 — Exercise had an `equipment` field.
 *   v2 — `equipment` removed; weight is always lb. Exercise is { id, name, createdAt }.
 *
 * v1 files still import: parseBundle only rejects versions NEWER than this one, and
 * normalizeExercise strips the dead field on the way in.
 */
export const EXPORT_VERSION = 2

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
  if (b.version < 1) throw new Error('That backup is from an unsupported version.')
  if (!Array.isArray(b.exercises) || !Array.isArray(b.workouts) || !Array.isArray(b.sessions)) {
    throw new Error('That backup is missing data.')
  }
  return b as ExportBundle
}

/**
 * Projects an imported exercise onto exactly the current shape.
 *
 * A v1 backup carries a dead `equipment` field. Stripping it here rather than storing
 * it verbatim keeps the database honest — otherwise the field would live on forever
 * and get re-exported inside a file labelled v2.
 */
function normalizeExercise(raw: Exercise): Exercise {
  return {
    id: raw.id,
    name: String(raw.name ?? 'Unnamed'),
    createdAt: Number(raw.createdAt) || Date.now(),
  }
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
  for (const e of bundle.exercises) void tx.objectStore('exercises').put(normalizeExercise(e))
  for (const w of bundle.workouts) {
    void tx.objectStore('workouts').put({ ...w, slots: w.slots ?? [] })
  }
  for (const s of bundle.sessions) {
    // Older/hand-edited backups may lack the denormalized field; rebuild it.
    void tx.objectStore('sessions').put(withExerciseIds({ ...s, skippedSlotIds: s.skippedSlotIds ?? [] }))
  }
  await tx.done
}

/**
 * Deletes all user data. Deliberately does NOT clear `meta`: that store holds the
 * one-time migration flags, and clearing it would re-arm the seed cleanup, which
 * would then delete seeded content restored from a backup on the next launch.
 */
export async function wipeAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['exercises', 'workouts', 'sessions'], 'readwrite')
  await Promise.all([
    tx.objectStore('exercises').clear(),
    tx.objectStore('workouts').clear(),
    tx.objectStore('sessions').clear(),
  ])
  await tx.done
}
