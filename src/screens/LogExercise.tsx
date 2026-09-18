import { useEffect, useMemo, useState } from 'react'
import { ExercisePicker } from '../components/ExercisePicker'
import { IconCheck, IconMinus, IconPlus, IconSwap, IconTrash } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import type { ID } from '../db/types'
import { navigate } from '../router'
import {
  exerciseById,
  fmtRelativeDate,
  fmtWeight,
  lastTimeFor,
  prefillReps,
  prefillWeight,
  sessionById,
  workoutById,
} from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'
import { NotFound } from './NotFound'

const STEP = 2.5

export function LogExercise({ sessionId, slotId }: { sessionId: string; slotId: string }) {
  const state = useStore()
  const session = sessionById(state, sessionId)
  const workout = session ? workoutById(state, session.workoutId) : undefined
  const slot = workout?.slots.find((s) => s.id === slotId)

  const entries = useMemo(
    () => session?.entries.filter((e) => e.slotId === slotId) ?? [],
    [session, slotId],
  )

  const [selectedId, setSelectedId] = useState<ID | undefined>(() => entries.at(-1)?.exerciseId)
  const [picking, setPicking] = useState(false)

  // If the entry we were pointing at gets removed, fall back to whatever's left.
  useEffect(() => {
    if (selectedId && !entries.some((e) => e.exerciseId === selectedId)) {
      setSelectedId(entries.at(-1)?.exerciseId)
    }
  }, [entries, selectedId])

  if (!session || !slot) return <NotFound />

  const slotName = slot.name
  const slotPool = slot.exerciseIds
  const workoutId = session.workoutId

  function pick(exerciseId: ID) {
    store.ensureEntry(sessionId, slotId, slotName, exerciseId)
    setSelectedId(exerciseId)
    setPicking(false)
  }

  /**
   * Create an exercise mid-workout and start logging it immediately.
   *
   * It joins the slot's pool permanently — you typed it while standing in front of the
   * machine, so you'll want it there next time.
   *
   * No awaits: store mutations update memory synchronously before queueing the write,
   * and the write queue is serialized, so the exercise row commits before the workout
   * row that references it. No dangling reference on disk even if the app dies here.
   */
  function createAndPick(name: string) {
    const ex = store.createOrReuseExercise(name)
    if (!slotPool.includes(ex.id)) {
      store.setSlotPool(workoutId, slotId, [...slotPool, ex.id])
    }
    pick(ex.id)
  }

  return (
    <>
      <Header
        title={slot.name}
        showBack
        onBack={() => navigate(`/session/${sessionId}`)}
        right={
          selectedId ? (
            <button
              className="header-btn"
              onClick={() => setPicking(true)}
              aria-label="Swap exercise"
            >
              <IconSwap />
            </button>
          ) : null
        }
      />

      <Screen>
        {selectedId ? (
          <Logger
            // Remount on swap so the inputs re-seed from the new exercise's history
            // rather than carrying over the previous one's numbers.
            key={selectedId}
            sessionId={sessionId}
            slotId={slotId}
            exerciseId={selectedId}
            onSwap={() => setPicking(true)}
          />
        ) : (
          <ExercisePicker poolIds={slot.exerciseIds} onPick={pick} onCreate={createAndPick} />
        )}

        {/* Other exercises already logged in this slot (e.g. you did two movements). */}
        {entries.length > 1 ? (
          <>
            <div className="section-label">Also in this slot</div>
            <div className="stack-sm">
              {entries
                .filter((e) => e.exerciseId !== selectedId)
                .map((e) => (
                  <button
                    key={e.exerciseId}
                    className="card"
                    style={{ width: '100%', textAlign: 'left', padding: '12px 14px' }}
                    onClick={() => setSelectedId(e.exerciseId)}
                  >
                    <div className="col">
                      <strong className="truncate">
                        {exerciseById(state, e.exerciseId)?.name ?? 'Unknown'}
                      </strong>
                      <span className="small muted mono">
                        {e.sets.filter((s) => s.done).length} sets logged
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          </>
        ) : null}
      </Screen>

      {picking ? (
        <Sheet
          title={slot.name}
          subtitle="Pick whatever's free — history follows the exercise, not the slot."
          onClose={() => setPicking(false)}
        >
          <ExercisePicker
            poolIds={slot.exerciseIds}
            selectedId={selectedId}
            onPick={pick}
            onCreate={createAndPick}
          />
        </Sheet>
      ) : null}
    </>
  )
}

function Logger({
  sessionId,
  slotId,
  exerciseId,
  onSwap,
}: {
  sessionId: string
  slotId: string
  exerciseId: ID
  onSwap: () => void
}) {
  const state = useStore()
  const session = sessionById(state, sessionId)
  const entry = session?.entries.find((e) => e.slotId === slotId && e.exerciseId === exerciseId)
  const exercise = exerciseById(state, exerciseId)
  const last = lastTimeFor(state, exerciseId)

  // Seeded during the first render, not in an effect — an effect would paint an empty
  // field for a frame before filling it, which looks broken when you're glancing at
  // the phone between sets.
  const [weight, setWeight] = useState(() => {
    const w = prefillWeight(state, exerciseId, entry)
    return w === '' ? '' : fmtWeight(w)
  })
  const [reps, setReps] = useState(() => {
    const r = prefillReps(entry)
    return r === '' ? '' : String(r)
  })

  // Re-seed whenever a set is appended: straight sets are the norm, so the next set
  // almost always starts from the previous one's numbers. Deps are deliberately narrow
  // — re-running on every unrelated store update would stomp on what you're typing.
  const lastSetId = entry?.sets.at(-1)?.id
  useEffect(() => {
    const w = prefillWeight(state, exerciseId, entry)
    const r = prefillReps(entry)
    setWeight(w === '' ? '' : fmtWeight(w))
    setReps(r === '' ? '' : String(r))
  }, [lastSetId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!exercise || !session) return null

  const wNum = Number.parseFloat(weight)
  const rNum = Number.parseInt(reps, 10)
  const canAdd = Number.isFinite(wNum) && wNum >= 0 && Number.isFinite(rNum) && rNum > 0

  function bump(delta: number) {
    const base = Number.isFinite(wNum) ? wNum : 0
    setWeight(fmtWeight(Math.max(0, Math.round((base + delta) / STEP) * STEP)))
  }

  function add() {
    if (!canAdd) return
    store.addSet(sessionId, slotId, exerciseId, wNum, rNum)
  }

  return (
    <div className="stack">
      <div className="row between">
        <button className="col grow" style={{ textAlign: 'left' }} onClick={onSwap}>
          <strong style={{ fontSize: 19 }}>{exercise.name}</strong>
          <span className="small muted">Tap to swap</span>
        </button>
        <button
          className="btn sm ghost"
          onClick={() => navigate(`/exercise/${exerciseId}`)}
        >
          History
        </button>
      </div>

      {/* LAST TIME — directly above today's input, so the number to beat is right there. */}
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="row between" style={{ marginBottom: last ? 8 : 0 }}>
          <span className="section-label" style={{ margin: 0 }}>
            Last time
          </span>
          {last ? <span className="small faint">{fmtRelativeDate(last.date)}</span> : null}
        </div>
        {last ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {last.sets.map((s, i) => (
              <span key={s.id} className="chip mono">
                {i + 1}. {fmtWeight(s.weight)} × {s.reps}
              </span>
            ))}
          </div>
        ) : (
          <span className="small faint">First time doing this one. Set the baseline.</span>
        )}
      </div>

      {/* TODAY */}
      <div className="section-label">Today</div>

      {entry && entry.sets.length > 0 ? (
        <div className="stack-sm">
          {entry.sets.map((s, i) => (
            <div className="set-row" key={s.id}>
              <span className="set-num mono">{i + 1}</span>
              <span className="grow mono">
                {fmtWeight(s.weight)} <span className="faint">×</span> {s.reps}
              </span>
              <button
                className={`set-check${s.done ? ' done' : ''}`}
                onClick={() =>
                  store.updateSet(sessionId, slotId, exerciseId, s.id, { done: !s.done })
                }
                aria-label={s.done ? 'Mark set not done' : 'Mark set done'}
              >
                <IconCheck />
              </button>
              <button
                className="icon-btn danger"
                onClick={() => store.removeSet(sessionId, slotId, exerciseId, s.id)}
                aria-label="Delete set"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty" style={{ padding: '18px 10px' }}>
          No sets yet.
        </div>
      )}

      {/* INPUT */}
      <div className="card stack" style={{ marginTop: 4 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="col grow">
            <label className="tiny faint" htmlFor="w">
              LB
            </label>
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" onClick={() => bump(-STEP)} aria-label="Less weight">
                <IconMinus />
              </button>
              <input
                id="w"
                className="input center mono"
                inputMode="decimal"
                enterKeyHint="done"
                pattern="[0-9]*[.,]?[0-9]*"
                placeholder="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value.replace(',', '.'))}
              />
              <button className="icon-btn" onClick={() => bump(STEP)} aria-label="More weight">
                <IconPlus />
              </button>
            </div>
          </div>
          <div className="col" style={{ width: 92 }}>
            <label className="tiny faint" htmlFor="r">
              REPS
            </label>
            <input
              id="r"
              className="input center mono"
              inputMode="numeric"
              enterKeyHint="done"
              pattern="[0-9]*"
              placeholder="0"
              value={reps}
              onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
        </div>

        <button className="btn primary block lg" onClick={add} disabled={!canAdd}>
          <IconPlus className="icon-sm" />
          Add set
        </button>
      </div>
    </div>
  )
}
