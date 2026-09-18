import { useSyncExternalStore } from 'react'

/**
 * ~40-line hash router.
 *
 * Hash routing (rather than history/pushState) is deliberate: the app is served
 * from a GitHub Pages subpath, and a hash never hits the server, so deep links and
 * reloads work with zero redirect config and no 404.html shim.
 */

function readPath(): string {
  const h = window.location.hash
  if (!h || h === '#') return '/'
  return h.slice(1) || '/'
}

let current = readPath()
const listeners = new Set<() => void>()

window.addEventListener('hashchange', () => {
  current = readPath()
  for (const l of listeners) l()
})

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => current)
}

/** Path split into segments, e.g. "/session/abc/slot/x" -> ["session","abc","slot","x"] */
export function useSegments(): string[] {
  const path = usePath()
  return path.split('/').filter(Boolean)
}

export function navigate(path: string, replace = false) {
  const target = `#${path}`
  if (window.location.hash === target) return
  if (replace) {
    window.history.replaceState(null, '', target)
    current = readPath()
    for (const l of listeners) l()
  } else {
    window.location.hash = target
  }
}

export function back() {
  if (window.history.length > 1) window.history.back()
  else navigate('/')
}
