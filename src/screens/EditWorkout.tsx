import { useMemo, useState } from 'react'
import { Confirm } from '../components/Confirm'
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconPlus,
  IconSearch,
  IconTrash,
} from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import type { ID, Slot } from '../db/types'
import { navigate } from '../router'
import { exerciseById, workoutById } from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'
import { NotFound } from './NotFound'

export function EditWorkout({ workoutId }: { workoutId: string }) {
  const state = useStore()
  const workout = workoutById(state, workoutId)

  const [poolSlotId, setPoolSlotId] = useState<ID | null>(null)
  const [confirmDeleteWorkout, setConfirmDeleteWorkout] = useState(false)
  const [confirmDeleteSlot, setConfirmDeleteSlot] = useState<Slot | null>(null)
  const [newSlotName, setNewSlotName] = useState('')

  if (!workout) return <NotFound />

  const poolSlot = workout.slots.find((s) => s.id === poolSlotId) ?? null
  const index = state.workouts.findIndex((w) => w.id === workout.id)

  return (
    <>
      <Header title="Edit workout" showBack onBack={() => navigate('/')} />
      <Screen tabbar>
        <div className="section-label">Name</div>
        <input
          className="input"
          value={workout.name}
          onChange={(e) => store.updateWorkout(workout.id, { name: e.target.value })}
          placeholder="Workout name"
          enterKeyHint="done"
        />

        <div className="section-label">Position on Home</div>
        <div className="row" style={{ gap: 8 }}>
          <span className="grow small muted">
            {index + 1} of {state.workouts.length}
          </span>
          <button
            className="icon-btn"
            disabled={index === 0}
            onClick={() => store.moveWorkout(workout.id, -1)}
            aria-label="Move workout up"
          >
            <IconArrowUp />
          </button>
          <button
            className="icon-btn"
            disabled={index === state.workouts.length - 1}
            onClick={() => store.moveWorkout(workout.id, 1)}
            aria-label="Move workout down"
          >
            <IconArrowDown />
          </button>
        </div>

        <div className="section-label">Slots ({workout.slots.length})</div>

        {workout.slots.length === 0 ? (
          <div className="empty">No slots yet. Add one below.</div>
        ) : (
          <div className="stack-sm">
            {workout.slots.map((slot, i) => (
              <div className="card" key={slot.id} style={{ padding: '10px 10px 10px 12px' }}>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 0, minHeight: 42 }}
                    value={slot.name}
                    onChange={(e) =>
                      store.updateSlot(workout.id, slot.id, { name: e.target.value })
                    }
                    placeholder="Slot name"
                    enterKeyHint="done"
                  />
                  <button
                    className="icon-btn"
                    disabled={i === 0}
                    onClick={() => store.moveSlot(workout.id, slot.id, -1)}
                    aria-label="Move up"
                  >
                    <IconArrowUp />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === workout.slots.length - 1}
                    onClick={() => store.moveSlot(workout.id, slot.id, 1)}
                    aria-label="Move down"
                  >
                    <IconArrowDown />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => setConfirmDeleteSlot(slot)}
                    aria-label="Delete slot"
                  >
                    <IconTrash />
                  </button>
                </div>

                <button
                  className="btn sm ghost block"
                  style={{ marginTop: 8, justifyContent: 'space-between' }}
                  onClick={() => setPoolSlotId(slot.id)}
                >
                  <span className="truncate muted" style={{ fontWeight: 500 }}>
                    {slot.exerciseIds.length === 0
                      ? 'No exercises — tap to add'
                      : slot.exerciseIds
                          .map((id) => exerciseById(state, id)?.name ?? '?')
                          .join(', ')}
                  </span>
                  <span className="chip">{slot.exerciseIds.length}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <input
            className="input grow"
            placeholder="New slot, e.g. Rear delts"
            value={newSlotName}
            onChange={(e) => setNewSlotName(e.target.value)}
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSlotName.trim()) {
                store.addSlot(workout.id, newSlotName)
                setNewSlotName('')
              }
            }}
          />
          <button
            className="btn"
            disabled={!newSlotName.trim()}
            onClick={() => {
              store.addSlot(workout.id, newSlotName)
              setNewSlotName('')
            }}
          >
            <IconPlus className="icon-sm" />
            Add
          </button>
        </div>

        <div className="section-label">Danger zone</div>
        <button className="btn danger block" onClick={() => setConfirmDeleteWorkout(true)}>
          <IconTrash className="icon-sm" />
          Delete workout
        </button>
        <div className="tiny faint center" style={{ marginTop: 8 }}>
          Past sessions of this workout stay in your history.
        </div>
      </Screen>

      {poolSlot ? (
        <PoolEditor
          workoutId={workout.id}
          slot={poolSlot}
          onClose={() => setPoolSlotId(null)}
        />
      ) : null}

      {confirmDeleteSlot ? (
        <Confirm
          title={`Delete "${confirmDeleteSlot.name}"?`}
          message="The slot is removed from this workout. The exercises themselves stay in your library, and past sessions are untouched."
          confirmLabel="Delete slot"
          destructive
          onConfirm={() => {
            store.deleteSlot(workout.id, confirmDeleteSlot.id)
            setConfirmDeleteSlot(null)
          }}
          onCancel={() => setConfirmDeleteSlot(null)}
        />
      ) : null}

      {confirmDeleteWorkout ? (
        <Confirm
          title={`Delete "${workout.name}"?`}
          message="This removes the workout and its slots. Sessions you've already finished stay in History."
          confirmLabel="Delete workout"
          destructive
          onConfirm={() => {
            store.deleteWorkout(workout.id)
            navigate('/')
          }}
          onCancel={() => setConfirmDeleteWorkout(false)}
        />
      ) : null}
    </>
  )
}

/** Edits which exercises are in a slot's pool, and their order. */
function PoolEditor({
  workoutId,
  slot,
  onClose,
}: {
  workoutId: ID
  slot: Slot
  onClose: () => void
}) {
  const state = useStore()
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')

  const inPool = slot.exerciseIds
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.exercises
      .filter((e) => !inPool.includes(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.exercises, inPool, query])

  function toggle(id: ID) {
    const next = inPool.includes(id) ? inPool.filter((x) => x !== id) : [...inPool, id]
    store.setSlotPool(workoutId, slot.id, next)
  }

  function move(id: ID, dir: -1 | 1) {
    const i = inPool.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= inPool.length) return
    const next = [...inPool]
    const a = next[i]!
    const b = next[j]!
    next[i] = b
    next[j] = a
    store.setSlotPool(workoutId, slot.id, next)
  }

  function createAndAdd() {
    const name = newName.trim()
    if (!name) return
    const ex = store.createOrReuseExercise(name)
    if (!inPool.includes(ex.id)) store.setSlotPool(workoutId, slot.id, [...inPool, ex.id])
    setNewName('')
  }

  return (
    <Sheet title={slot.name} subtitle="Order sets which option shows first." onClose={onClose}>
      <div className="section-label" style={{ marginTop: 0 }}>
        In this slot ({inPool.length})
      </div>
      {inPool.length === 0 ? (
        <div className="empty" style={{ padding: '16px 0' }}>
          Nothing here yet — add from below.
        </div>
      ) : (
        <div className="stack-sm">
          {inPool.map((id, i) => (
            <div className="set-row" key={id}>
              <span className="grow truncate">{exerciseById(state, id)?.name ?? 'Unknown'}</span>
              <button
                className="icon-btn"
                disabled={i === 0}
                onClick={() => move(id, -1)}
                aria-label="Move up"
              >
                <IconArrowUp />
              </button>
              <button
                className="icon-btn"
                disabled={i === inPool.length - 1}
                onClick={() => move(id, 1)}
                aria-label="Move down"
              >
                <IconArrowDown />
              </button>
              <button className="icon-btn danger" onClick={() => toggle(id)} aria-label="Remove">
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-label">Add from library</div>
      <div className="row" style={{ position: 'relative' }}>
        <IconSearch
          className="icon-sm"
          style={{
            position: 'absolute',
            left: 13,
            color: 'var(--text-faint)',
            pointerEvents: 'none',
          }}
        />
        <input
          className="input"
          style={{ paddingLeft: 38 }}
          placeholder="Search exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        {candidates.slice(0, 40).map((e) => (
          <button className="set-row" key={e.id} onClick={() => toggle(e.id)}>
            <span className="grow truncate" style={{ textAlign: 'left' }}>
              {e.name}
            </span>
            <span className="icon-btn">
              <IconPlus />
            </span>
          </button>
        ))}
        {candidates.length === 0 ? (
          <div className="empty" style={{ padding: '16px 0' }}>
            No matches.
          </div>
        ) : null}
      </div>

      <div className="section-label">Create new exercise</div>
      <div className="stack-sm">
        <input
          className="input"
          placeholder="Exercise name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          enterKeyHint="done"
          onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
        />
        <button className="btn primary block" disabled={!newName.trim()} onClick={createAndAdd}>
          <IconCheck className="icon-sm" />
          Create and add
        </button>
      </div>
    </Sheet>
  )
}
