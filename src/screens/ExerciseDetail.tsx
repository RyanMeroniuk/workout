import { useState } from 'react'
import { LineChart } from '../components/LineChart'
import { Header, Screen } from '../components/Shell'
import { navigate } from '../router'
import {
  bestE1rm,
  exerciseById,
  fmtDate,
  fmtRelativeDate,
  fmtWeight,
  historyFor,
  seriesFor,
  slotsContaining,
  totalVolume,
  weightHint,
  weightLabel,
  type Metric,
} from '../store/selectors'
import { useStore } from '../store/store'
import { NotFound } from './NotFound'

const METRICS: Array<{ key: Metric; label: string; unit: string }> = [
  { key: 'e1rm', label: 'Est. 1RM', unit: 'lb' },
  { key: 'top', label: 'Top set', unit: 'lb' },
  { key: 'volume', label: 'Volume', unit: 'lb' },
]

export function ExerciseDetail({ exerciseId }: { exerciseId: string }) {
  const state = useStore()
  const [metric, setMetric] = useState<Metric>('e1rm')

  const exercise = exerciseById(state, exerciseId)
  if (!exercise) return <NotFound />

  const history = historyFor(state, exerciseId)
  const last = history[0]
  const series = seriesFor(state, exerciseId, metric)
  const slots = slotsContaining(state, exerciseId)
  const unit = METRICS.find((m) => m.key === metric)!.unit
  const hint = weightHint(exercise.equipment)

  return (
    <>
      <Header title={exercise.name} showBack />
      <Screen tabbar>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <span className="chip">{exercise.equipment}</span>
          <span className="chip">{weightLabel(exercise.equipment)}</span>
          {slots.map((s, i) => (
            <span className="chip" key={i}>
              {s.workout.name} · {s.slotName}
            </span>
          ))}
        </div>
        {hint ? (
          <div className="tiny faint" style={{ marginBottom: 12 }}>
            {hint}
          </div>
        ) : null}

        {/* LAST TIME */}
        <div className="section-label">Last time</div>
        <div className="card">
          {last ? (
            <>
              <div className="row between" style={{ marginBottom: 8 }}>
                <strong>{fmtRelativeDate(last.date)}</strong>
                <span className="small faint">{fmtDate(last.date)}</span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {last.sets.map((s, i) => (
                  <span key={s.id} className="chip mono">
                    {i + 1}. {fmtWeight(s.weight)} × {s.reps}
                  </span>
                ))}
              </div>
              <div className="row between small muted mono" style={{ marginTop: 10 }}>
                <span>Best e1RM {fmtWeight(Math.round(bestE1rm(last.sets) * 10) / 10)} lb</span>
                <span>Volume {fmtWeight(totalVolume(last.sets))} lb</span>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: '12px 0' }}>
              You haven't logged this exercise yet.
            </div>
          )}
        </div>

        {/* GRAPH */}
        {history.length > 0 ? (
          <>
            <div className="section-label">Progress</div>
            <div className="card">
              <div className="segmented" style={{ marginBottom: 12 }}>
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    className={metric === m.key ? 'active' : ''}
                    onClick={() => setMetric(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <LineChart points={series} unit={unit} />
            </div>
          </>
        ) : null}

        {/* FULL LOG */}
        {history.length > 0 ? (
          <>
            <div className="section-label">All sessions ({history.length})</div>
            <div className="stack-sm">
              {history.map(({ session, sets, date }) => (
                <button
                  key={`${session.id}-${date}`}
                  className="card"
                  style={{ width: '100%', textAlign: 'left', padding: '12px 14px' }}
                  onClick={() => navigate(`/history/${session.id}`)}
                >
                  <div className="row between" style={{ marginBottom: 5 }}>
                    <strong className="small">{fmtDate(date)}</strong>
                    <span className="tiny faint">{session.workoutName}</span>
                  </div>
                  <div className="small muted mono">
                    {sets.map((s) => `${fmtWeight(s.weight)}×${s.reps}`).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </Screen>
    </>
  )
}
