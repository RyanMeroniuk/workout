import { useSyncExternalStore } from 'react'
import * as repo from '../db/repo'
import { requestPersistence } from '../db/db'
import type { Exercise, ID, LoggedExercise, Session, SetEntry, Workout } from '../db/types'

export interface State {
  ready: boolean
  exercises: Exercise[]
  workouts: Workout[]
  sessions: Session[]
}

let state: State = { ready: false, exercises: [], workouts: [], sessions: [] }

const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Tail of the write queue. See `set` and `flush`. */
let pending: Promise<unknown> = Promise.resolve()

/**
 * Every mutation goes through here: update memory synchronously and repaint
 * immediately, then persist in the background. The UI never awaits IndexedDB,
 * which is what keeps the app usable mid-set with no spinners.
 *
 * Writes are chained rather than fired in parallel so they commit in the order
 * they were issued — two quick edits to the same session can't land out of order.
 */
function set(next: Partial<State>, persist?: () => Promise<unknown>) {
  state = { ...state, ...next }
  emit()
  if (persist) {
    pending = pending.then(persist).catch((err) => {
      console.error('[slots] persist failed', err)
    })
  }
}

/**
 * Resolves once every queued write has committed.
 *
 * Needed because a mutation returns before IndexedDB commits: if the page is
 * reloaded or closed in that window the transaction aborts and the write is lost.
 * Mid-set that risk is irrelevant, but for terminal actions like finishing a
 * workout it is worth the couple of milliseconds to be certain.
 */
export function flush(): Promise<void> {
  return pending.then(() => undefined)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return state
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ---------- boot ----------

const byOrder = (a: Workout, b: Workout) => a.order - b.order
const byStartedDesc = (a: Session, b: Session) => b.startedAt - a.startedAt

let bootPromise: Promise<void> | null = null

export function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await repo.seedIfEmpty()
      const snap = await repo.loadAll()
      set({
        ready: true,
        exercises: snap.exercises,
        workouts: snap.workouts.sort(byOrder),
        sessions: snap.sessions.sort(byStartedDesc),
      })
      void requestPersistence()
    })()
  }
  return bootPromise
}

/** Re-read everything from disk. Used after import / wipe. */
export async function reload(): Promise<void> {
  await repo.seedIfEmpty()
  const snap = await repo.loadAll()
  set({
    ready: true,
    exercises: snap.exercises,
    workouts: snap.workouts.sort(byOrder),
    sessions: snap.sessions.sort(byStartedDesc),
  })
}

// ---------- exercises ----------

export function createExercise(name: string, equipment: Exercise['equipment']): Exercise {
  const ex: Exercise = { id: repo.uid(), name: name.trim(), equipment, createdAt: Date.now() }
  set({ exercises: [...state.exercises, ex] }, () => repo.putExercise(ex))
  return ex
}

export function updateExercise(id: ID, patch: Partial<Omit<Exercise, 'id'>>) {
  const next = state.exercises.map((e) => (e.id === id ? { ...e, ...patch } : e))
  const updated = next.find((e) => e.id === id)
  set({ exercises: next }, () => (updated ? repo.putExercise(updated) : Promise.resolve()))
}

/**
 * Removing an exercise also removes it from every slot pool that references it.
 * Past sessions keep their entries — history is never rewritten by a catalogue edit.
 */
export function deleteExercise(id: ID) {
  const touched: Workout[] = []
  const workouts = state.workouts.map((w) => {
    if (!w.slots.some((s) => s.exerciseIds.includes(id))) return w
    const next = {
      ...w,
      slots: w.slots.map((s) => ({ ...s, exerciseIds: s.exerciseIds.filter((x) => x !== id) })),
    }
    touched.push(next)
    return next
  })

  set({ exercises: state.exercises.filter((e) => e.id !== id), workouts }, async () => {
    await repo.deleteExercise(id)
    if (touched.length) await repo.putWorkouts(touched)
  })
}

// ---------- workouts ----------

export function createWorkout(name: string): Workout {
  const w: Workout = {
    id: repo.uid(),
    name: name.trim(),
    slots: [],
    order: state.workouts.length,
    createdAt: Date.now(),
  }
  set({ workouts: [...state.workouts, w] }, () => repo.putWorkout(w))
  return w
}

export function updateWorkout(id: ID, patch: Partial<Omit<Workout, 'id'>>) {
  const next = state.workouts.map((w) => (w.id === id ? { ...w, ...patch } : w)).sort(byOrder)
  const updated = next.find((w) => w.id === id)
  set({ workouts: next }, () => (updated ? repo.putWorkout(updated) : Promise.resolve()))
}

export function deleteWorkout(id: ID) {
  const remaining = state.workouts
    .filter((w) => w.id !== id)
    .map((w, i) => ({ ...w, order: i }))
  set({ workouts: remaining }, async () => {
    await repo.deleteWorkout(id)
    await repo.putWorkouts(remaining)
  })
}

/** Moves a workout up or down the Home list. */
export function moveWorkout(id: ID, dir: -1 | 1) {
  const list = [...state.workouts]
  const i = list.findIndex((w) => w.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return

  const a = list[i]!
  const b = list[j]!
  list[i] = b
  list[j] = a

  const next = list.map((w, k) => ({ ...w, order: k }))
  set({ workouts: next }, () => repo.putWorkouts(next))
}

// ---------- slots ----------

function mapWorkout(workoutId: ID, fn: (w: Workout) => Workout) {
  const next = state.workouts.map((w) => (w.id === workoutId ? fn(w) : w))
  const updated = next.find((w) => w.id === workoutId)
  set({ workouts: next }, () => (updated ? repo.putWorkout(updated) : Promise.resolve()))
}

export function addSlot(workoutId: ID, name: string) {
  mapWorkout(workoutId, (w) => ({
    ...w,
    slots: [...w.slots, { id: repo.uid(), name: name.trim(), exerciseIds: [] }],
  }))
}

export function updateSlot(workoutId: ID, slotId: ID, patch: Partial<{ name: string; exerciseIds: ID[] }>) {
  mapWorkout(workoutId, (w) => ({
    ...w,
    slots: w.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
  }))
}

export function deleteSlot(workoutId: ID, slotId: ID) {
  mapWorkout(workoutId, (w) => ({ ...w, slots: w.slots.filter((s) => s.id !== slotId) }))
}

export function moveSlot(workoutId: ID, slotId: ID, dir: -1 | 1) {
  mapWorkout(workoutId, (w) => {
    const i = w.slots.findIndex((s) => s.id === slotId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= w.slots.length) return w
    const slots = [...w.slots]
    const a = slots[i]!
    const b = slots[j]!
    slots[i] = b
    slots[j] = a
    return { ...w, slots }
  })
}

export function setSlotPool(workoutId: ID, slotId: ID, exerciseIds: ID[]) {
  updateSlot(workoutId, slotId, { exerciseIds })
}

// ---------- sessions ----------

export function activeSession(s: State = state): Session | undefined {
  return s.sessions.find((x) => x.finishedAt === null)
}

export function startSession(workoutId: ID): Session | undefined {
  const workout = state.workouts.find((w) => w.id === workoutId)
  if (!workout) return undefined

  const session: Session = {
    id: repo.uid(),
    workoutId,
    workoutName: workout.name,
    startedAt: Date.now(),
    finishedAt: null,
    entries: [],
    skippedSlotIds: [],
    exerciseIds: [],
  }
  set({ sessions: [session, ...state.sessions] }, () => repo.putSession(session))
  return session
}

function mapSession(sessionId: ID, fn: (s: Session) => Session) {
  let updated: Session | undefined
  const next = state.sessions.map((s) => {
    if (s.id !== sessionId) return s
    updated = repo.withExerciseIds(fn(s))
    return updated
  })
  set({ sessions: next }, () => (updated ? repo.putSession(updated) : Promise.resolve()))
}

export function updateSession(sessionId: ID, patch: Partial<Omit<Session, 'id'>>) {
  mapSession(sessionId, (s) => ({ ...s, ...patch }))
}

export function finishSession(sessionId: ID) {
  mapSession(sessionId, (s) => ({
    ...s,
    finishedAt: Date.now(),
    // Drop entries that were opened but never actually logged, so an accidental
    // tap on a slot doesn't leave an empty exercise in your history.
    entries: s.entries.filter((e) => e.sets.some((x) => x.done)),
  }))
}

export function discardSession(sessionId: ID) {
  set({ sessions: state.sessions.filter((s) => s.id !== sessionId) }, () =>
    repo.deleteSession(sessionId),
  )
}

export function toggleSkipSlot(sessionId: ID, slotId: ID) {
  mapSession(sessionId, (s) => {
    const skipped = s.skippedSlotIds.includes(slotId)
    return {
      ...s,
      skippedSlotIds: skipped
        ? s.skippedSlotIds.filter((x) => x !== slotId)
        : [...s.skippedSlotIds, slotId],
      // Skipping clears anything logged for that slot.
      entries: skipped ? s.entries : s.entries.filter((e) => e.slotId !== slotId),
    }
  })
}

/** Ensures an entry exists for (slot, exercise) and returns the updated session. */
export function ensureEntry(sessionId: ID, slotId: ID, slotName: string, exerciseId: ID) {
  mapSession(sessionId, (s) => {
    const existing = s.entries.find((e) => e.slotId === slotId && e.exerciseId === exerciseId)
    if (existing) return s
    const entry: LoggedExercise = { exerciseId, slotId, slotName, sets: [] }
    return {
      ...s,
      entries: [...s.entries, entry],
      skippedSlotIds: s.skippedSlotIds.filter((x) => x !== slotId),
    }
  })
}

function mapEntry(
  sessionId: ID,
  slotId: ID,
  exerciseId: ID,
  fn: (e: LoggedExercise) => LoggedExercise,
) {
  mapSession(sessionId, (s) => ({
    ...s,
    entries: s.entries.map((e) => (e.slotId === slotId && e.exerciseId === exerciseId ? fn(e) : e)),
  }))
}

export function addSet(
  sessionId: ID,
  slotId: ID,
  exerciseId: ID,
  weight: number,
  reps: number,
  done = true,
) {
  const s: SetEntry = { id: repo.uid(), weight, reps, done }
  mapEntry(sessionId, slotId, exerciseId, (e) => ({ ...e, sets: [...e.sets, s] }))
}

export function updateSet(
  sessionId: ID,
  slotId: ID,
  exerciseId: ID,
  setId: ID,
  patch: Partial<Omit<SetEntry, 'id'>>,
) {
  mapEntry(sessionId, slotId, exerciseId, (e) => ({
    ...e,
    sets: e.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
  }))
}

export function removeSet(sessionId: ID, slotId: ID, exerciseId: ID, setId: ID) {
  mapEntry(sessionId, slotId, exerciseId, (e) => ({
    ...e,
    sets: e.sets.filter((x) => x.id !== setId),
  }))
}

/** Removes the whole logged exercise from a slot (used when swapping exercise). */
export function removeEntry(sessionId: ID, slotId: ID, exerciseId: ID) {
  mapSession(sessionId, (s) => ({
    ...s,
    entries: s.entries.filter((e) => !(e.slotId === slotId && e.exerciseId === exerciseId)),
  }))
}
