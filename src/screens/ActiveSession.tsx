import { useEffect, useRef, useState } from 'react'
import { Confirm } from '../components/Confirm'
import { IconCheck, IconChevronRight, IconEdit, IconPlus, IconSkip } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { navigate } from '../router'
import {
  exerciseName,
  fmtDuration,
  fmtWeight,
  sessionById,
  sessionProgress,
  workingSets,
  workoutById,
} from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'
import { NotFound } from './NotFound'

export function ActiveSession({ sessionId }: { sessionId: string }) {
  const state = useStore()
  const session = sessionById(state, sessionId)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [newSlotName, setNewSlotName] = useState('')

  /**
   * Following a link to an already-finished session should land on the read-only
   * history view. This is evaluated ONCE on mount and run from an effect, not
   * during render: once you tap Finish, `finishedAt` becomes non-null while this
   * screen is still mounted, and a live check here would race the Finish handler's
   * own navigate('/') and dump you on the history page instead of Home.
   * (App keys this component by session id, so a different session remounts it.)
   */
  const finishedOnMount = useRef(session?.finishedAt != null)
  useEffect(() => {
    if (finishedOnMount.current) navigate(`/history/${sessionId}`, true)
  }, [sessionId])

  if (!session) return <NotFound />
  if (finishedOnMount.current) return null

  const workout = workoutById(state, session.workoutId)
  const slots = workout?.slots ?? []
  const progress = sessionProgress(session, workout)
  const loggedAnything = session.entries.some((e) => e.sets.some((s) => s.done))

  function addSlotNow() {
    const name = newSlotName.trim()
    if (!name) return
    store.addSlot(session!.workoutId, name)
    setNewSlotName('')
  }

  return (
    <>
      <Header
        title={session.workoutName}
        showBack
        onBack={() => navigate('/')}
        right={
          // Mid-workout edits are a real need: you turn up and do something that
          // isn't in the plan. The session survives the trip — it's keyed by id in
          // the store, not by what's on screen.
          <button
            className="header-btn"
            onClick={() => navigate(`/workout/${session.workoutId}/edit`)}
          >
            <IconEdit />
            Edit
          </button>
        }
      />
      <Screen footer>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="small muted">
              {progress.done} / {progress.total} slots
            </span>
            <span className="small muted mono">
              {fmtDuration(Date.now() - session.startedAt)}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>

        <div className="stack">
          {slots.map((slot) => {
            const entries = session.entries.filter((e) => e.slotId === slot.id)
            const skipped = session.skippedSlotIds.includes(slot.id)
            const done = entries.some((e) => e.sets.some((s) => s.done))

            return (
              <div
                className="card"
                key={slot.id}
                style={{
                  opacity: skipped ? 0.5 : 1,
                  borderColor: done ? 'var(--accent-dim)' : 'var(--border)',
                }}
              >
                <button
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => navigate(`/session/${session.id}/slot/${slot.id}`)}
                >
                  <div className="row between">
                    <div className="col grow">
                      <div className="row" style={{ gap: 7 }}>
                        {done ? <IconCheck className="check-badge" /> : null}
                        <strong className="truncate">{slot.name}</strong>
                      </div>

                      {skipped ? (
                        <span className="small faint">Skipped</span>
                      ) : entries.length === 0 ? (
                        <span className="small faint">
                          {slot.exerciseIds.length} option
                          {slot.exerciseIds.length === 1 ? '' : 's'} · not started
                        </span>
                      ) : (
                        <div className="stack-sm" style={{ marginTop: 3 }}>
                          {entries.map((e) => {
                            const sets = workingSets(e)
                            return (
                              <div key={e.exerciseId} className="small muted truncate">
                                {exerciseName(state, e.exerciseId)}
                                {sets.length ? (
                                  <span className="mono">
                                    {' — '}
                                    {sets
                                      .map((s) => `${fmtWeight(s.weight)}×${s.reps}`)
                                      .join(', ')}
                                  </span>
                                ) : (
                                  <span className="faint"> — no sets yet</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <IconChevronRight className="chev" />
                  </div>
                </button>

                <button
                  className="btn sm ghost"
                  style={{ marginTop: 10 }}
                  onClick={() => store.toggleSkipSlot(session.id, slot.id)}
                >
                  <IconSkip className="icon-sm" />
                  {skipped ? 'Unskip' : 'Skip'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Doing something that isn't in the plan today — add the slot here and log
            it now. It joins the workout for next time too. */}
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <input
            className="input grow"
            placeholder="Add a slot, e.g. Calves"
            value={newSlotName}
            onChange={(e) => setNewSlotName(e.target.value)}
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSlotNow()
            }}
          />
          <button className="btn" disabled={!newSlotName.trim()} onClick={addSlotNow}>
            <IconPlus className="icon-sm" />
            Add
          </button>
        </div>

        <button
          className="btn ghost block sm"
          style={{ marginTop: 22, color: 'var(--danger)' }}
          onClick={() => setConfirmDiscard(true)}
        >
          Discard this workout
        </button>
      </Screen>

      <div className="footer-action">
        <button className="btn primary block lg" onClick={() => setConfirmFinish(true)}>
          Finish workout
        </button>
      </div>

      {confirmFinish ? (
        <Confirm
          title="Finish workout?"
          message={
            loggedAnything
              ? `Saving ${progress.done} slot${progress.done === 1 ? '' : 's'}. You can still edit this session afterwards from History.`
              : "You haven't logged any sets yet. Finishing now saves an empty session."
          }
          confirmLabel="Finish"
          onConfirm={() => {
            store.finishSession(session.id)
            setConfirmFinish(false)
            // Wait for the write to commit before leaving. This is the one action
            // where losing the write actually costs you a workout.
            void store.flush().then(() => navigate('/'))
          }}
          onCancel={() => setConfirmFinish(false)}
        />
      ) : null}

      {confirmDiscard ? (
        <Confirm
          title="Discard this workout?"
          message="Everything logged in this session will be deleted. This can't be undone."
          confirmLabel="Discard"
          destructive
          onConfirm={() => {
            store.discardSession(session.id)
            setConfirmDiscard(false)
            void store.flush().then(() => navigate('/'))
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      ) : null}
    </>
  )
}
