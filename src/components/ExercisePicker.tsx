import { useMemo, useState } from 'react'
import type { Exercise, ID } from '../db/types'
import { fmtRelativeDate, fmtWeight, lastTimeFor } from '../store/selectors'
import { useStore } from '../store/store'
import { IconPlus, IconSearch } from './Icons'

/**
 * Pick the exercise for a slot — or invent one on the spot.
 *
 * The slot's own pool comes first, because that's the 95% case. Below it, one field
 * that doubles as search and as create: type a name, and if nothing matches you get a
 * Create button. That single field is how the exercise library gets built, so it is
 * always visible rather than hidden behind a toggle.
 *
 * Picking something off-pool does NOT edit the workout — it's a one-session
 * substitution. Creating something new DOES join the pool, since you clearly want it.
 */
export function ExercisePicker({
  poolIds,
  selectedId,
  onPick,
  onCreate,
}: {
  poolIds: ID[]
  selectedId?: ID
  onPick: (exerciseId: ID) => void
  /** Omit to hide the create affordance. Receives the raw typed name. */
  onCreate?: (name: string) => void
}) {
  const state = useStore()
  const [query, setQuery] = useState('')

  const byId = useMemo(() => new Map(state.exercises.map((e) => [e.id, e])), [state.exercises])

  const q = query.trim()
  const qKey = q.toLowerCase()

  const pool = poolIds
    .map((id) => byId.get(id))
    .filter((e): e is Exercise => e !== undefined)
    .filter((e) => (qKey ? e.name.toLowerCase().includes(qKey) : true))

  const others = useMemo(() => {
    if (!qKey) return []
    return state.exercises
      .filter((e) => !poolIds.includes(e.id))
      .filter((e) => e.name.toLowerCase().includes(qKey))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.exercises, poolIds, qKey])

  // Offer Create only when nothing anywhere already has this exact name — otherwise
  // you'd be one tap away from forking an exercise's history in two.
  const exactExists = state.exercises.some((e) => e.name.trim().toLowerCase() === qKey)
  const canCreate = onCreate !== undefined && q.length > 0 && !exactExists

  function create() {
    if (!canCreate) return
    onCreate!(q)
    setQuery('')
  }

  return (
    <div className="stack">
      {poolIds.length > 0 ? (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>
            In this slot
          </div>
          {pool.length === 0 ? (
            <div className="tiny faint" style={{ padding: '4px 2px' }}>
              Nothing in this slot matches "{q}".
            </div>
          ) : (
            <div className="stack-sm">
              {pool.map((e) => (
                <ExerciseOption
                  key={e.id}
                  exercise={e}
                  selected={e.id === selectedId}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="empty" style={{ padding: '20px 10px' }}>
          Nothing in this slot yet.
          <br />
          <br />
          Search for an exercise below, or type a new name to create one. It'll be saved
          to this slot for next time.
        </div>
      )}

      <div className="row" style={{ position: 'relative', marginTop: 6 }}>
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
          placeholder={onCreate ? 'Search or add an exercise' : 'Search exercises'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          enterKeyHint={canCreate ? 'done' : 'search'}
          autoCapitalize="words"
          autoCorrect="off"
        />
      </div>

      {canCreate ? (
        <button className="btn primary block" onClick={create}>
          <IconPlus className="icon-sm" />
          Create "{q}"
        </button>
      ) : null}

      {others.length > 0 ? (
        <>
          <div className="section-label">Other exercises</div>
          <div className="stack-sm">
            {others.map((e) => (
              <ExerciseOption
                key={e.id}
                exercise={e}
                selected={e.id === selectedId}
                onPick={onPick}
                offPool
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ExerciseOption({
  exercise,
  selected,
  offPool,
  onPick,
}: {
  exercise: Exercise
  selected?: boolean
  offPool?: boolean
  onPick: (id: ID) => void
}) {
  const state = useStore()
  const last = lastTimeFor(state, exercise.id)

  return (
    <button
      className="card"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '12px 14px',
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
      }}
      onClick={() => onPick(exercise.id)}
    >
      <div className="row between">
        <div className="col grow">
          <div className="row" style={{ gap: 6 }}>
            <strong className="truncate">{exercise.name}</strong>
            {offPool ? <span className="chip">off pool</span> : null}
          </div>
          {last ? (
            <span className="small muted mono truncate">
              {fmtRelativeDate(last.date)} ·{' '}
              {last.sets.map((s) => `${fmtWeight(s.weight)}×${s.reps}`).join(', ')}
            </span>
          ) : (
            <span className="small faint">No history yet</span>
          )}
        </div>
      </div>
    </button>
  )
}
