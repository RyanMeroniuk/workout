import { TabBar } from './components/Shell'
import { useSegments } from './router'
import { EditWorkout } from './screens/EditWorkout'
import { ExerciseDetail } from './screens/ExerciseDetail'
import { ExerciseLibrary } from './screens/ExerciseLibrary'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { LogExercise } from './screens/LogExercise'
import { NotFound } from './screens/NotFound'
import { SessionDetail } from './screens/SessionDetail'
import { Settings } from './screens/Settings'
import { ActiveSession } from './screens/ActiveSession'

/**
 * Routes:
 *   /                            Home
 *   /session/:id                 Active session (slot list)
 *   /session/:id/slot/:slotId    Pick exercise + log sets
 *   /workout/:id/edit            Edit workout
 *   /exercise/:id                Exercise detail + graph
 *   /library                     Exercise library
 *   /history                     Past sessions
 *   /history/:id                 View / edit one session
 *   /settings                    Export, import, wipe
 */
function Route() {
  const seg = useSegments()
  const [a, b, c, d] = seg

  if (seg.length === 0) return <Home />

  // Screens are keyed by the id they render, so navigating between two sessions
  // (or two exercises) remounts rather than reusing state from the previous one.
  if (a === 'session' && b) {
    if (c === 'slot' && d) return <LogExercise key={`${b}/${d}`} sessionId={b} slotId={d} />
    return <ActiveSession key={b} sessionId={b} />
  }
  if (a === 'workout' && b && c === 'edit') return <EditWorkout key={b} workoutId={b} />
  if (a === 'exercise' && b) return <ExerciseDetail key={b} exerciseId={b} />
  if (a === 'library') return <ExerciseLibrary />
  if (a === 'history') return b ? <SessionDetail key={b} sessionId={b} /> : <History />
  if (a === 'settings') return <Settings />

  return <NotFound />
}

/** The tab bar is hidden inside a live workout so the screen is all training. */
function useShowTabBar(): boolean {
  const seg = useSegments()
  return seg[0] !== 'session'
}

export default function App() {
  const showTabs = useShowTabBar()
  return (
    <div className="app">
      <Route />
      {showTabs ? <TabBar /> : null}
    </div>
  )
}
