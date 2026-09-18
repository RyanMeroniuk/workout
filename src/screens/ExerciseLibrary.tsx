import { useMemo, useState } from 'react'
import { Confirm } from '../components/Confirm'
import { IconChevronRight, IconPlus, IconSearch, IconTrash } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { Sheet } from '../components/Sheet'
import type { Equipment, Exercise } from '../db/types'
import { navigate } from '../router'
import { fmtRelativeDate, historyFor, lastTimeFor, slotsContaining } from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'
import { EquipmentPicker } from './EditWorkout'

export function ExerciseLibrary() {
  const state = useStore()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [creating, setCreating] = useState(false)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.exercises
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.exercises, query])

  return (
    <>
      <Header
        title="Exercises"
        right={
          <button className="header-btn" onClick={() => setCreating(true)} aria-label="New exercise">
            <IconPlus />
          </button>
        }
      />
      <Screen tabbar>
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

        <div className="section-label">
          {list.length} exercise{list.length === 1 ? '' : 's'}
        </div>

        {list.length === 0 ? (
          <div className="empty">No matches.</div>
        ) : (
          <div className="stack-sm">
            {list.map((e) => {
              const slots = slotsContaining(state, e.id)
              const last = lastTimeFor(state, e.id)
              return (
                <div className="card" key={e.id} style={{ padding: '12px 10px 12px 14px' }}>
                  <div className="row between">
                    <button
                      className="col grow"
                      style={{ textAlign: 'left' }}
                      onClick={() => navigate(`/exercise/${e.id}`)}
                    >
                      <strong className="truncate">{e.name}</strong>
                      <span className="small faint">
                        {e.equipment}
                        {last ? ` · last ${fmtRelativeDate(last.date)}` : ' · no history'}
                      </span>
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => setEditing(e)}
                      aria-label={`Edit ${e.name}`}
                    >
                      <IconChevronRight />
                    </button>
                  </div>
                  {slots.length > 0 ? (
                    <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                      {slots.map((s, i) => (
                        <span className="chip" key={i}>
                          {s.workout.name} · {s.slotName}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="tiny faint" style={{ marginTop: 8 }}>
                      Not in any slot
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Screen>

      {creating ? <CreateExercise onClose={() => setCreating(false)} /> : null}
      {editing ? <EditExercise exercise={editing} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function CreateExercise({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [equipment, setEquipment] = useState<Equipment>('dumbbell')

  function create() {
    if (!name.trim()) return
    const ex = store.createExercise(name, equipment)
    onClose()
    navigate(`/exercise/${ex.id}`)
  }

  return (
    <Sheet title="New exercise" onClose={onClose}>
      <div className="stack">
        <input
          className="input"
          placeholder="Exercise name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          enterKeyHint="done"
          onKeyDown={(e) => e.key === 'Enter' && create()}
          autoFocus
        />
        <EquipmentPicker value={equipment} onChange={setEquipment} />
        <div className="tiny faint">
          Equipment only changes the weight label — dumbbells read "per hand",
          bodyweight reads "added lb".
        </div>
        <button className="btn primary block lg" disabled={!name.trim()} onClick={create}>
          Create
        </button>
      </div>
    </Sheet>
  )
}

function EditExercise({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const state = useStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const sessions = historyFor(state, exercise.id)
  const slots = slotsContaining(state, exercise.id)

  return (
    <>
      <Sheet title="Edit exercise" onClose={onClose}>
        <div className="stack">
          <input
            className="input"
            value={exercise.name}
            onChange={(e) => store.updateExercise(exercise.id, { name: e.target.value })}
            placeholder="Exercise name"
            enterKeyHint="done"
          />
          <EquipmentPicker
            value={exercise.equipment}
            onChange={(eq) => store.updateExercise(exercise.id, { equipment: eq })}
          />

          <button
            className="btn block"
            onClick={() => {
              onClose()
              navigate(`/exercise/${exercise.id}`)
            }}
          >
            View history ({sessions.length} session{sessions.length === 1 ? '' : 's'})
          </button>

          <button className="btn danger block" onClick={() => setConfirmDelete(true)}>
            <IconTrash className="icon-sm" />
            Delete exercise
          </button>
        </div>
      </Sheet>

      {confirmDelete ? (
        <Confirm
          title={`Delete "${exercise.name}"?`}
          message={
            `It will be removed from ${slots.length} slot pool${slots.length === 1 ? '' : 's'}. ` +
            (sessions.length > 0
              ? `Its ${sessions.length} logged session${sessions.length === 1 ? '' : 's'} stay in your history.`
              : 'It has no logged history.')
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            store.deleteExercise(exercise.id)
            setConfirmDelete(false)
            onClose()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  )
}
