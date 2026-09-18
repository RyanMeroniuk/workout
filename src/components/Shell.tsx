import type { ReactNode } from 'react'
import { back, navigate, usePath } from '../router'
import { IconChevronLeft, IconHistory, IconHome, IconLibrary, IconSettings } from './Icons'

export function Header({
  title,
  showBack,
  right,
  onBack,
}: {
  title: string
  showBack?: boolean
  right?: ReactNode
  onBack?: () => void
}) {
  return (
    <div className="header">
      <div className="header-inner">
        {showBack ? (
          <button className="header-btn" onClick={onBack ?? back} aria-label="Back">
            <IconChevronLeft />
          </button>
        ) : null}
        <div className="header-title">{title}</div>
        {right}
      </div>
    </div>
  )
}

const TABS = [
  { path: '/', label: 'Home', Icon: IconHome },
  { path: '/history', label: 'History', Icon: IconHistory },
  { path: '/library', label: 'Library', Icon: IconLibrary },
  { path: '/settings', label: 'Settings', Icon: IconSettings },
] as const

export function TabBar() {
  const path = usePath()
  return (
    <nav className="tabbar">
      {TABS.map(({ path: p, label, Icon }) => {
        const active = p === '/' ? path === '/' : path.startsWith(p)
        return (
          <button
            key={p}
            className={`tab${active ? ' active' : ''}`}
            onClick={() => navigate(p)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        )
      })}
    </nav>
  )
}

export function Screen({
  children,
  tabbar,
  footer,
}: {
  children: ReactNode
  tabbar?: boolean
  footer?: boolean
}) {
  const cls = ['main', tabbar ? 'has-tabbar' : '', footer ? 'has-footer' : '']
    .filter(Boolean)
    .join(' ')
  return <main className={cls}>{children}</main>
}
