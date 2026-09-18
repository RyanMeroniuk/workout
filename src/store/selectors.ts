import type { Exercise, ID, LoggedExercise, Session, SetEntry, Workout } from '../db/types'
import type { State } from './store'

/** Epley estimated 1RM. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 0) return 0
  return weight * (1 + reps / 30)
}

export function workingSets(entry: LoggedExercise): SetEntry[] {
  return entry.sets.filter((s) => s.done)
}

export function bestE1rm(sets: SetEntry[]): number {
  return sets.reduce((m, s) => Math.max(m, e1rm(s.weight, s.reps)), 0)
}

export function topWeight(sets: SetEntry[]): number {
  return sets.reduce((m, s) => Math.max(m, s.weight), 0)
}

export function totalVolume(sets: SetEntry[]): number {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0)
}

export function totalReps(sets: SetEntry[]): number {
  return sets.reduce((sum, s) => sum + s.reps, 0)
}

// ---------- lookups ----------

export function exerciseById(state: State, id: ID): Exercise | undefined {
  return state.exercises.find((e) => e.id === id)
}

export function exerciseName(state: State, id: ID): string {
  return exerciseById(state, id)?.name ?? 'Unknown exercise'
}

export function workoutById(state: State, id: ID): Workout | undefined {
  return state.workouts.find((w) => w.id === id)
}

export function sessionById(state: State, id: ID): Session | undefined {
  return state.sessions.find((s) => s.id === id)
}

export interface ExerciseSession {
  session: Session
  entry: LoggedExercise
  sets: SetEntry[]
  date: number
}

/**
 * Every FINISHED session that included this exercise, newest first.
 * This is the per-exercise history that the whole app hangs off — note it ignores
 * which slot the exercise was logged under, which is exactly the point: swap a
 * lat pulldown into any slot and it still lands on the same timeline.
 */
export function historyFor(state: State, exerciseId: ID): ExerciseSession[] {
  const out: ExerciseSession[] = []
  for (const session of state.sessions) {
    if (session.finishedAt === null) continue
    for (const entry of session.entries) {
      if (entry.exerciseId !== exerciseId) continue
      const sets = workingSets(entry)
      if (sets.length === 0) continue
      out.push({ session, entry, sets, date: session.startedAt })
    }
  }
  return out.sort((a, b) => b.date - a.date)
}

/** The most recent finished session of this exercise — the "last time" block. */
export function lastTimeFor(state: State, exerciseId: ID): ExerciseSession | undefined {
  return historyFor(state, exerciseId)[0]
}

export type Metric = 'e1rm' | 'top' | 'volume'

export interface Point {
  date: number
  value: number
}

export function seriesFor(state: State, exerciseId: ID, metric: Metric): Point[] {
  const hist = historyFor(state, exerciseId)
  const points = hist.map(({ date, sets }) => ({
    date,
    value:
      metric === 'e1rm' ? bestE1rm(sets) : metric === 'top' ? topWeight(sets) : totalVolume(sets),
  }))
  return points.sort((a, b) => a.date - b.date) // chronological for plotting
}

/** Which slots (across all workouts) currently list this exercise in their pool. */
export function slotsContaining(
  state: State,
  exerciseId: ID,
): Array<{ workout: Workout; slotName: string }> {
  const out: Array<{ workout: Workout; slotName: string }> = []
  for (const workout of state.workouts) {
    for (const slot of workout.slots) {
      if (slot.exerciseIds.includes(exerciseId)) out.push({ workout, slotName: slot.name })
    }
  }
  return out
}

export function lastSessionForWorkout(state: State, workoutId: ID): Session | undefined {
  return state.sessions.find((s) => s.workoutId === workoutId && s.finishedAt !== null)
}

/**
 * Prefill for the next set's weight:
 *   1. the last set already logged for this exercise in the CURRENT session
 *   2. otherwise the top set from the last time you did it
 *   3. otherwise blank
 */
export function prefillWeight(
  state: State,
  exerciseId: ID,
  currentEntry: LoggedExercise | undefined,
): number | '' {
  const last = currentEntry?.sets.at(-1)
  if (last) return last.weight

  const prev = lastTimeFor(state, exerciseId)
  if (prev) return topWeight(prev.sets)

  return ''
}

export function prefillReps(currentEntry: LoggedExercise | undefined): number | '' {
  return currentEntry?.sets.at(-1)?.reps ?? ''
}

// ---------- session progress ----------

export interface SlotProgress {
  done: number
  total: number
  skipped: number
}

export function sessionProgress(session: Session, workout: Workout | undefined): SlotProgress {
  const total = workout?.slots.length ?? 0
  let done = 0
  for (const slot of workout?.slots ?? []) {
    const entries = session.entries.filter((e) => e.slotId === slot.id)
    if (entries.some((e) => e.sets.some((s) => s.done))) done++
  }
  return { done, total, skipped: session.skippedSlotIds.length }
}

// ---------- formatting ----------

/** Trims trailing zeros: 52.5 -> "52.5", 135 -> "135". */
export function fmtWeight(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function fmtRelativeDate(ts: number): string {
  const days = Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return fmtDate(ts)
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The UI label for the weight field, which depends on equipment. */
export function weightLabel(equipment: Exercise['equipment']): string {
  if (equipment === 'dumbbell') return 'lb per hand'
  if (equipment === 'bodyweight') return 'added lb'
  return 'lb'
}

export function weightHint(equipment: Exercise['equipment']): string | null {
  if (equipment === 'dumbbell') return 'Per hand — 50 means two 50 lb dumbbells'
  if (equipment === 'bodyweight') return '0 = bodyweight only'
  return null
}
