import type { Equipment, Exercise, Slot, Workout } from './types'

/**
 * Seeded exercises use stable slug ids rather than random uuids. That matters:
 * "Side delts" appears in both Upper and Full Body, and both pools reference the
 * SAME ids, so lateral-raise history is continuous across the two workouts.
 */
const E: Array<[string, string, Equipment]> = [
  // chest
  ['incline-bb-bench', 'Incline barbell bench', 'barbell'],
  ['incline-db-press', 'Incline dumbbell press', 'dumbbell'],
  ['incline-machine-press', 'Incline machine press', 'machine'],
  ['low-high-cable-fly', 'Low-to-high cable fly', 'cable'],
  ['flat-bb-bench', 'Flat barbell bench', 'barbell'],
  ['flat-db-press', 'Flat dumbbell press', 'dumbbell'],
  ['machine-chest-press', 'Machine chest press', 'machine'],
  ['cable-fly', 'Cable fly', 'cable'],
  ['dips', 'Dips', 'bodyweight'],

  // back
  ['lat-pulldown', 'Lat pulldown', 'machine'],
  ['neutral-cable-pulldown', 'Neutral-grip cable pulldown', 'cable'],
  ['db-row', 'Dumbbell row', 'dumbbell'],
  ['pull-ups', 'Pull-ups', 'bodyweight'],
  ['machine-pullover', 'Machine pullover', 'machine'],
  ['chest-supported-row', 'Chest-supported row', 'machine'],
  ['seated-cable-row', 'Seated cable row', 'cable'],
  ['bb-row', 'Barbell row', 'barbell'],
  ['t-bar-row', 'T-bar row', 'barbell'],

  // delts
  ['ohp', 'Overhead barbell press', 'barbell'],
  ['seated-db-press', 'Seated dumbbell press', 'dumbbell'],
  ['machine-shoulder-press', 'Machine shoulder press', 'machine'],
  ['db-lateral-raise', 'Dumbbell lateral raise', 'dumbbell'],
  ['cable-lateral-raise', 'Cable lateral raise', 'cable'],
  ['machine-lateral-raise', 'Machine lateral raise', 'machine'],
  ['reverse-pec-deck', 'Reverse pec deck', 'machine'],
  ['cable-reverse-fly', 'Cable reverse fly', 'cable'],
  ['db-rear-delt-fly', 'Dumbbell rear delt fly', 'dumbbell'],
  ['face-pull', 'Face pull', 'cable'],

  // arms
  ['bb-curl', 'Barbell curl', 'barbell'],
  ['db-curl', 'Dumbbell curl', 'dumbbell'],
  ['incline-db-curl', 'Incline dumbbell curl', 'dumbbell'],
  ['cable-curl', 'Cable curl', 'cable'],
  ['preacher-curl', 'Preacher curl', 'machine'],
  ['cable-pushdown', 'Cable pushdown', 'cable'],
  ['overhead-cable-ext', 'Overhead cable extension', 'cable'],
  ['skull-crusher', 'Skull crusher', 'barbell'],

  // legs
  ['bb-squat', 'Barbell squat', 'barbell'],
  ['leg-press', 'Leg press', 'machine'],
  ['hack-squat', 'Hack squat', 'machine'],
  ['goblet-squat', 'Goblet squat', 'dumbbell'],
  ['leg-extension', 'Leg extension', 'machine'],
  ['rdl', 'Romanian deadlift', 'barbell'],
  ['db-rdl', 'Dumbbell RDL', 'dumbbell'],
  ['seated-leg-curl', 'Seated leg curl', 'machine'],
  ['lying-leg-curl', 'Lying leg curl', 'machine'],
]

// Pools shared between Upper and Full Body — declared once, referenced twice.
const SIDE_DELTS = ['db-lateral-raise', 'cable-lateral-raise', 'machine-lateral-raise']
const BICEPS = ['bb-curl', 'db-curl', 'incline-db-curl', 'cable-curl', 'preacher-curl']
const TRICEPS = ['cable-pushdown', 'overhead-cable-ext', 'skull-crusher', 'dips']

const UPPER_SLOTS: Array<[string, string[]]> = [
  ['Upper chest', ['incline-bb-bench', 'incline-db-press', 'incline-machine-press', 'low-high-cable-fly']],
  ['Mid chest', ['flat-bb-bench', 'flat-db-press', 'machine-chest-press', 'cable-fly', 'dips']],
  ['Lats', ['lat-pulldown', 'neutral-cable-pulldown', 'db-row', 'pull-ups', 'machine-pullover']],
  ['Upper back', ['chest-supported-row', 'seated-cable-row', 'bb-row', 't-bar-row']],
  ['Front delts', ['ohp', 'seated-db-press', 'machine-shoulder-press']],
  ['Side delts', SIDE_DELTS],
  ['Rear delts', ['reverse-pec-deck', 'cable-reverse-fly', 'db-rear-delt-fly', 'face-pull']],
  ['Biceps', BICEPS],
  ['Triceps', TRICEPS],
]

const FULL_BODY_SLOTS: Array<[string, string[]]> = [
  ['Chest', ['flat-db-press', 'machine-chest-press', 'flat-bb-bench', 'incline-db-press']],
  ['Back', ['lat-pulldown', 'seated-cable-row', 'db-row', 'pull-ups']],
  ['Side delts', SIDE_DELTS],
  ['Biceps', BICEPS],
  ['Triceps', TRICEPS],
  ['Quads', ['bb-squat', 'leg-press', 'hack-squat', 'goblet-squat', 'leg-extension']],
  ['Hamstrings', ['rdl', 'db-rdl', 'seated-leg-curl', 'lying-leg-curl']],
]

function buildSlots(defs: Array<[string, string[]]>, workoutKey: string): Slot[] {
  return defs.map(([name, exerciseIds]) => ({
    // Slot ids are stable too, so an in-progress session survives a reseed.
    id: `${workoutKey}-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    exerciseIds: [...exerciseIds],
  }))
}

export function buildSeedData(): { exercises: Exercise[]; workouts: Workout[] } {
  const now = Date.now()

  const exercises: Exercise[] = E.map(([id, name, equipment], i) => ({
    id,
    name,
    equipment,
    createdAt: now + i,
  }))

  const workouts: Workout[] = [
    {
      id: 'workout-upper',
      name: 'Upper',
      slots: buildSlots(UPPER_SLOTS, 'upper'),
      order: 0,
      createdAt: now,
    },
    {
      id: 'workout-full-body',
      name: 'Full Body',
      slots: buildSlots(FULL_BODY_SLOTS, 'fb'),
      order: 1,
      createdAt: now + 1,
    },
  ]

  return { exercises, workouts }
}
