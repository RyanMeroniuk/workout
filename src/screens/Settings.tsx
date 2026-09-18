import { useRef, useState } from 'react'
import { Confirm } from '../components/Confirm'
import { Header, Screen } from '../components/Shell'
import * as repo from '../db/repo'
import type { ExportBundle } from '../db/types'
import { workingSets } from '../store/selectors'
import { reload, useStore } from '../store/store'

type Status = { kind: 'ok' | 'err'; text: string } | null

export function Settings() {
  const state = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>(null)
  const [pendingImport, setPendingImport] = useState<ExportBundle | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const finished = state.sessions.filter((s) => s.finishedAt !== null)
  const totalSets = finished.reduce((n, s) => n + s.entries.flatMap(workingSets).length, 0)

  async function doExport() {
    try {
      const bundle = await repo.exportAll()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `slots-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on the next tick — revoking synchronously can cancel the download
      // in Safari before it starts.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus({ kind: 'ok', text: 'Backup downloaded.' })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Export failed.' })
    }
  }

  async function onFile(file: File) {
    try {
      const bundle = repo.parseBundle(await file.text())
      setPendingImport(bundle)
      setStatus(null)
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Import failed.' })
    }
  }

  async function confirmImport() {
    if (!pendingImport) return
    try {
      await repo.importAll(pendingImport)
      await reload()
      setStatus({ kind: 'ok', text: 'Backup restored.' })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Import failed.' })
    } finally {
      setPendingImport(null)
    }
  }

  async function doWipe() {
    await repo.wipeAll()
    await reload()
    setConfirmWipe(false)
    setStatus({ kind: 'ok', text: 'All data erased.' })
  }

  return (
    <>
      <Header title="Settings" />
      <Screen tabbar>
        <div className="section-label">Your data</div>
        <div className="card">
          <div className="row between small">
            <span className="muted">Workouts</span>
            <span className="mono">{state.workouts.length}</span>
          </div>
          <div className="row between small" style={{ marginTop: 6 }}>
            <span className="muted">Exercises</span>
            <span className="mono">{state.exercises.length}</span>
          </div>
          <div className="row between small" style={{ marginTop: 6 }}>
            <span className="muted">Finished sessions</span>
            <span className="mono">{finished.length}</span>
          </div>
          <div className="row between small" style={{ marginTop: 6 }}>
            <span className="muted">Sets logged</span>
            <span className="mono">{totalSets}</span>
          </div>
        </div>

        <div className="section-label">Backup</div>
        <div className="stack-sm">
          <button className="btn block" onClick={doExport}>
            Export all data (JSON)
          </button>
          <button className="btn block" onClick={() => fileRef.current?.click()}>
            Import from backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = '' // let the same file be picked twice
            }}
          />
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}>
          Everything lives on this device only — there's no account and no server. Export
          now and then, especially before clearing Safari's website data.
        </div>

        {status ? (
          <div
            className="card small"
            style={{
              marginTop: 12,
              borderColor: status.kind === 'ok' ? 'var(--accent)' : 'var(--danger)',
              color: status.kind === 'ok' ? 'var(--accent)' : 'var(--danger)',
            }}
          >
            {status.text}
          </div>
        ) : null}

        <div className="section-label">Danger zone</div>
        <button className="btn danger block" onClick={() => setConfirmWipe(true)}>
          Erase all data
        </button>

        <div className="tiny faint center" style={{ marginTop: 24 }}>
          Slots · offline-first
        </div>
      </Screen>

      {pendingImport ? (
        <Confirm
          title="Restore this backup?"
          message={`This replaces everything currently on the device with ${pendingImport.workouts.length} workouts, ${pendingImport.exercises.length} exercises and ${pendingImport.sessions.length} sessions.`}
          confirmLabel="Replace my data"
          destructive
          onConfirm={() => void confirmImport()}
          onCancel={() => setPendingImport(null)}
        />
      ) : null}

      {confirmWipe ? (
        <Confirm
          title="Erase everything?"
          message="All workouts, exercises and logged sessions are deleted from this device, leaving the app empty. Export a backup first if you might want this back."
          confirmLabel="Erase everything"
          destructive
          onConfirm={() => void doWipe()}
          onCancel={() => setConfirmWipe(false)}
        />
      ) : null}
    </>
  )
}
