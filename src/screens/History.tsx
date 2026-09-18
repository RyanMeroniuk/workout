import { IconChevronRight } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import { navigate } from '../router'
import {
  exerciseName,
  fmtDate,
  fmtDuration,
  fmtWeight,
  totalVolume,
  workingSets,
} from '../store/selectors'
import { useStore } from '../store/store'

export function History() {
  const state = useStore()
  const finished = state.sessions.filter((s) => s.finishedAt !== null)

  return (
    <>
      <Header title="History" />
      <Screen tabbar>
        {finished.length === 0 ? (
          <div className="empty">
            No finished workouts yet. Start one from Home and it'll show up here.
          </div>
        ) : (
          <div className="stack-sm">
            {finished.map((s) => {
              const sets = s.entries.flatMap(workingSets)
              return (
                <button
                  className="card"
                  key={s.id}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => navigate(`/history/${s.id}`)}
                >
                  <div className="row between">
                    <div className="col grow">
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{s.workoutName}</strong>
                        <span className="chip">{fmtDate(s.startedAt)}</span>
                      </div>
                      <span className="small muted mono">
                        {s.entries.length} exercise{s.entries.length === 1 ? '' : 's'} ·{' '}
                        {sets.length} set{sets.length === 1 ? '' : 's'} ·{' '}
                        {fmtWeight(totalVolume(sets))} lb
                      </span>
                      <span className="tiny faint truncate" style={{ marginTop: 3 }}>
                        {s.entries.map((e) => exerciseName(state, e.exerciseId)).join(' · ') ||
                          'Nothing logged'}
                      </span>
                    </div>
                    <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                      <span className="tiny faint mono">
                        {s.finishedAt ? fmtDuration(s.finishedAt - s.startedAt) : ''}
                      </span>
                      <IconChevronRight className="chev" />
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Screen>
    </>
  )
}
