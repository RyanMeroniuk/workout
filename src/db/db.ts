import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Exercise, Session, Workout } from './types'

export interface SlotsDB extends DBSchema {
  exercises: {
    key: string
    value: Exercise
    indexes: { 'by-name': string }
  }
  workouts: {
    key: string
    value: Workout
    indexes: { 'by-order': number }
  }
  sessions: {
    key: string
    value: Session
    indexes: {
      'by-startedAt': number
      /** multiEntry over Session.exerciseIds — the per-exercise history lookup. */
      'by-exercise': string
    }
  }
  meta: {
    key: string
    value: unknown
  }
}

export const DB_NAME = 'slots'
export const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<SlotsDB>> | null = null

export function getDB(): Promise<IDBPDatabase<SlotsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SlotsDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const exercises = db.createObjectStore('exercises', { keyPath: 'id' })
          exercises.createIndex('by-name', 'name')

          const workouts = db.createObjectStore('workouts', { keyPath: 'id' })
          workouts.createIndex('by-order', 'order')

          const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
          sessions.createIndex('by-startedAt', 'startedAt')
          sessions.createIndex('by-exercise', 'exerciseIds', { multiEntry: true })

          db.createObjectStore('meta', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

/**
 * Ask the browser to make storage persistent so iOS is less likely to evict the
 * database under storage pressure. Safari grants this automatically once the PWA
 * is added to the Home Screen. Best-effort: never block startup on it.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch {
    /* not supported — nothing to do */
  }
  return false
}
