import { useState } from 'react'
import { Confirm } from '../components/Confirm'
import { IconEdit, IconPlus } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { navigate } from '../router'
import {
  fmtRelativeDate,
  lastSessionForWorkout,
  sessionProgress,
  workoutById,
} from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'

export function Home() {
  const state = useStore()
  const active = store.activeSession(state)
  const activeWorkout = active ? workoutById(state, active.workoutId) : undefined
  const [pendingStart, setPendingStart] = useState<string | null>(null)

  function start(workoutId: string) {
    // Only one workout can be live at a time — starting another would split
    // your sets across two sessions without you noticing.
    if (active) {
      setPendingStart(workoutId)
      return
    }
    const s = store.startSession(workoutId)
    if (s) navigate(`/session/${s.id}`)
  }

  function confirmDiscardAndStart() {
    if (!pendingStart || !active) return
    store.discardSession(active.id)
    const s = store.startSession(pendingStart)
    setPendingStart(null)
    if (s) navigate(`/session/${s.id}`)
  }

  return (
    <>
      <Header
        title="Slots"
        right={
          <button
            className="header-btn"
            onClick={() => {
              const w = store.createWorkout('New workout')
              navigate(`/workout/${w.id}/edit`)
            }}
            aria-label="New workout"
          >
            <IconPlus />
          </button>
        }
      />
      <Screen tabbar>
        {active && activeWorkout ? (
          <button
            className="card"
            style={{
              width: '100%',
              textAlign: 'left',
              borderColor: 'var(--accent)',
              marginBottom: 14,
            }}
            onClick={() => navigate(`/session/${active.id}`)}
          >
            <div className="row between">
              <div className="col">
                <span className="chip accent" style={{ marginBottom: 6 }}>
                  In progress
                </span>
                <strong style={{ fontSize: 18 }}>{activeWorkout.name}</strong>
                <span className="small muted">
                  {sessionProgress(active, activeWorkout).done} of{' '}
                  {activeWorkout.slots.length} slots done
                </span>
              </div>
              <span className="btn primary sm">Resume</span>
            </div>
          </button>
        ) : null}

        <div className="section-label">Workouts</div>

        {state.workouts.length === 0 ? (
          <div className="empty">No workouts yet. Tap + to make one.</div>
        ) : (
          state.workouts.map((w) => {
            const last = lastSessionForWorkout(state, w.id)
            return (
              <div className="card" key={w.id}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="col grow">
                    <strong style={{ fontSize: 18 }}>{w.name}</strong>
                    <span className="small muted">
                      {w.slots.length} slot{w.slots.length === 1 ? '' : 's'}
                      {last ? ` · last ${fmtRelativeDate(last.startedAt)}` : ' · never done'}
                    </span>
                  </div>
                  <button
                    className="header-btn plain"
                    onClick={() => navigate(`/workout/${w.id}/edit`)}
                    aria-label={`Edit ${w.name}`}
                  >
                    <IconEdit />
                  </button>
                </div>
                <button
                  className="btn primary block lg"
                  style={{ marginTop: 12 }}
                  onClick={() => start(w.id)}
                  disabled={w.slots.length === 0}
                >
                  {w.slots.length === 0 ? 'Add slots first' : 'Start'}
                </button>
              </div>
            )
          })
        )}
      </Screen>

      {pendingStart ? (
        <Confirm
          title="Discard the workout in progress?"
          message={`You have "${activeWorkout?.name ?? 'a workout'}" still running. Starting a new one will throw away anything logged in it.`}
          confirmLabel="Discard and start"
          destructive
          onConfirm={confirmDiscardAndStart}
          onCancel={() => setPendingStart(null)}
        />
      ) : null}
    </>
  )
}
