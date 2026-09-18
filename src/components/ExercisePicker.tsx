import { useMemo, useState } from 'react'
import type { Exercise, ID } from '../db/types'
import { fmtRelativeDate, fmtWeight, lastTimeFor } from '../store/selectors'
import { useStore } from '../store/store'
import { IconSearch } from './Icons'

/**
 * Pool first, everything else behind a toggle. The pool is what you'll pick 95% of
 * the time; the full list is there for the day someone's on every machine you own.
 * Picking off-pool does NOT edit the workout — it's a one-session substitution.
 */
export function ExercisePicker({
  poolIds,
  selectedId,
  onPick,
}: {
  poolIds: ID[]
  selectedId?: ID
  onPick: (exerciseId: ID) => void
}) {
  const state = useStore()
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')

  const byId = useMemo(
    () => new Map(state.exercises.map((e) => [e.id, e])),
    [state.exercises],
  )

  const pool = poolIds
    .map((id) => byId.get(id))
    .filter((e): e is Exercise => e !== undefined)

  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.exercises
      .filter((e) => !poolIds.includes(e.id))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.exercises, poolIds, query])

  return (
    <div className="stack">
      {pool.length > 0 ? (
        <>
          <div className="section-label">In this slot</div>
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
        </>
      ) : (
        <div className="empty">
          This slot has no exercises yet. Pick one from the full list below, or add
          some in Edit workout.
        </div>
      )}

      <button
        className="btn block ghost sm"
        style={{ marginTop: 14 }}
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll ? 'Hide all exercises' : 'All exercises…'}
      </button>

      {showAll ? (
        <>
          <div className="row" style={{ position: 'relative', marginTop: 4 }}>
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
          <div className="stack-sm">
            {others.length === 0 ? (
              <div className="empty">No matches.</div>
            ) : (
              others.map((e) => (
                <ExerciseOption
                  key={e.id}
                  exercise={e}
                  selected={e.id === selectedId}
                  onPick={onPick}
                  offPool
                />
              ))
            )}
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
        <span className="chip">{exercise.equipment}</span>
      </div>
    </button>
  )
}
