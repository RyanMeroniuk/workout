import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { boot } from './store/store'
import './styles/global.css'

const root = createRoot(document.getElementById('root')!)

// Await the DB before the first paint. Opening IndexedDB and reading a few
// hundred records takes ~10ms, so this is imperceptible — and it means no screen
// in the app ever has to render a loading state for local data.
boot().then(
  () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  },
  (err: unknown) => {
    console.error('[slots] failed to open database', err)
    root.render(
      <div className="main" style={{ paddingTop: 80 }}>
        <div className="card stack">
          <h2>Can't open storage</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Slots needs IndexedDB to save your workouts. This usually means Private
            Browsing is on, or the site is blocked from storing data. Open Slots in a
            normal Safari tab and try again.
          </p>
          <button className="btn primary block" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>,
    )
  },
)

registerSW({ immediate: true })
