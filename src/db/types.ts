export type ID = string

/**
 * An exercise is GLOBAL — it lives in one catalogue and is referenced by id from
 * any number of slot pools. That is what makes history shared: doing "Dumbbell RDL"
 * in the Hamstrings slot and in a Posterior-chain slot writes to the same record.
 *
 * Just a name. Exercises are created by you, as you train.
 */
export interface Exercise {
  id: ID
  name: string
  createdAt: number
}

/** A muscle target with a pool of interchangeable exercises. */
export interface Slot {
  id: ID
  name: string
  /** The pool. Ordered — index 0 is the default suggestion. */
  exerciseIds: ID[]
}

export interface Workout {
  id: ID
  name: string
  /** Ordered. Embedded rather than a separate store: a slot belongs to exactly
   *  one workout, so reordering is a single atomic put(). */
  slots: Slot[]
  order: number
  createdAt: number
}

export interface SetEntry {
  id: ID
  /** Pounds. Decimals allowed (2.5 increments). */
  weight: number
  reps: number
  done: boolean
}

export interface LoggedExercise {
  exerciseId: ID
  slotId: ID
  /** Snapshot of the slot name at log time, so history still reads correctly
   *  after the slot is renamed or deleted. */
  slotName: string
  sets: SetEntry[]
}

export interface Session {
  id: ID
  workoutId: ID
  /** Snapshot, same reasoning as slotName. */
  workoutName: string
  startedAt: number
  /** null while the session is still in progress. */
  finishedAt: number | null
  entries: LoggedExercise[]
  skippedSlotIds: ID[]
  /**
   * Denormalized list of every exerciseId in `entries`, maintained on write.
   * Exists solely to back the `by-exercise` multiEntry index — without it,
   * "when did I last do lat pulldown?" means scanning every session ever.
   */
  exerciseIds: ID[]
}

export interface ExportBundle {
  format: 'slots-export'
  version: number
  exportedAt: number
  exercises: Exercise[]
  workouts: Workout[]
  sessions: Session[]
}
