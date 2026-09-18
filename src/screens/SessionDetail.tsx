import { useEffect, useRef, useState } from 'react'
import { Confirm } from '../components/Confirm'
import { IconChevronRight, IconTrash } from '../components/Icons'
import { Header, Screen } from '../components/Shell'
import type { SetEntry } from '../db/types'
import { navigate } from '../router'
import {
  exerciseById,
  fmtDate,
  fmtDuration,
  fmtTime,
  fmtWeight,
  sessionById,
  totalVolume,
  workingSets,
} from '../store/selectors'
import * as store from '../store/store'
import { useStore } from '../store/store'
import { NotFound } from './NotFound'

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const state = useStore()
  const session = sessionById(state, sessionId)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // An unfinished session belongs in the live workout screen. Same reasoning as
  // ActiveSession: decided on mount and run from an effect, so deleting the
  // session from here doesn't momentarily look "unfinished" and bounce us.
  const unfinishedOnMount = useRef(session != null && session.finishedAt === null)
  useEffect(() => {
    if (unfinishedOnMount.current) navigate(`/session/${sessionId}`, true)
  }, [sessionId])

  if (!session) return <NotFound />
  if (unfinishedOnMount.current || session.finishedAt === null) return null

  const allSets = session.entries.flatMap(workingSets)

  return (
    <>
      <Header
        title={session.workoutName}
        showBack
        onBack={() => navigate('/history')}
        right={
          <button className="header-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        }
      />
      <Screen tabbar>
        <div className="card" style={{ marginBottom: 4 }}>
          <div className="row between">
            <div className="col">
              <strong>{fmtDate(session.startedAt)}</strong>
              <span className="small faint mono">
                {fmtTime(session.startedAt)} · {fmtDuration(session.finishedAt - session.startedAt)}
              </span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end' }}>
              <span className="small mono">{allSets.length} sets</span>
              <span className="small faint mono">{fmtWeight(totalVolume(allSets))} lb</span>
            </div>
          </div>
        </div>

        {session.entries.length === 0 ? (
          <div className="empty">Nothing was logged in this session.</div>
        ) : (
          session.entries.map((entry) => {
            const exercise = exerciseById(state, entry.exerciseId)
            return (
              <div key={`${entry.slotId}-${entry.exerciseId}`}>
                <div className="section-label">{entry.slotName}</div>
                <div className="card">
                  <button
                    className="row between"
                    style={{ width: '100%', marginBottom: 10 }}
                    onClick={() => navigate(`/exercise/${entry.exerciseId}`)}
                  >
                    <strong className="truncate">{exercise?.name ?? 'Deleted exercise'}</strong>
                    <IconChevronRight className="chev" />
                  </button>

                  <div className="stack-sm">
                    {entry.sets.map((s, i) =>
                      editing ? (
                        <EditableSet
                          key={s.id}
                          index={i}
                          set={s}
                          onChange={(patch) =>
                            store.updateSet(session.id, entry.slotId, entry.exerciseId, s.id, patch)
                          }
                          onDelete={() =>
                            store.removeSet(session.id, entry.slotId, entry.exerciseId, s.id)
                          }
                        />
                      ) : (
                        <div className="set-row" key={s.id} style={{ opacity: s.done ? 1 : 0.45 }}>
                          <span className="set-num mono">{i + 1}</span>
                          <span className="grow mono">
                            {fmtWeight(s.weight)} <span className="faint">×</span> {s.reps}
                          </span>
                          {!s.done ? <span className="chip">not done</span> : null}
                        </div>
                      ),
                    )}
                    {entry.sets.length === 0 ? (
                      <div className="tiny faint">No sets.</div>
                    ) : null}
                  </div>

                  {editing ? (
                    <button
                      className="btn sm danger block"
                      style={{ marginTop: 10 }}
                      onClick={() =>
                        store.removeEntry(session.id, entry.slotId, entry.exerciseId)
                      }
                    >
                      Remove this exercise
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })
        )}

        {editing ? (
          <>
            <div className="section-label">Danger zone</div>
            <button className="btn danger block" onClick={() => setConfirmDelete(true)}>
              <IconTrash className="icon-sm" />
              Delete this session
            </button>
          </>
        ) : null}
      </Screen>

      {confirmDelete ? (
        <Confirm
          title="Delete this session?"
          message="Every set logged on this date is removed from your history and from the graphs. This can't be undone."
          confirmLabel="Delete session"
          destructive
          onConfirm={() => {
            store.discardSession(session.id)
            navigate('/history')
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  )
}

function EditableSet({
  index,
  set,
  onChange,
  onDelete,
}: {
  index: number
  set: SetEntry
  onChange: (patch: Partial<Omit<SetEntry, 'id'>>) => void
  onDelete: () => void
}) {
  return (
    <div className="set-row" style={{ paddingLeft: 8 }}>
      <span className="set-num mono">{index + 1}</span>
      <input
        className="input center mono"
        style={{ minHeight: 38, padding: '0 4px', flex: 1, minWidth: 0 }}
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        value={fmtWeight(set.weight)}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value.replace(',', '.'))
          onChange({ weight: Number.isFinite(v) && v >= 0 ? v : 0 })
        }}
        aria-label="Weight"
      />
      <span className="faint">×</span>
      <input
        className="input center mono"
        style={{ minHeight: 38, padding: '0 4px', width: 58 }}
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(set.reps)}
        onChange={(e) => {
          const v = Number.parseInt(e.target.value.replace(/[^0-9]/g, ''), 10)
          onChange({ reps: Number.isFinite(v) && v >= 0 ? v : 0 })
        }}
        aria-label="Reps"
      />
      <button className="icon-btn danger" onClick={onDelete} aria-label="Delete set">
        <IconTrash />
      </button>
    </div>
  )
}
