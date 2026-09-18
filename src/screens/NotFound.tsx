import { Header, Screen } from '../components/Shell'
import { navigate } from '../router'

export function NotFound() {
  return (
    <>
      <Header title="Not found" />
      <Screen tabbar>
        <div className="empty">That page doesn't exist.</div>
        <button className="btn primary block" onClick={() => navigate('/')}>
          Go home
        </button>
      </Screen>
    </>
  )
}
