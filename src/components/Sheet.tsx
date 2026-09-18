import { useEffect, type ReactNode } from 'react'

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  // Lock body scroll while the sheet is open, otherwise iOS scrolls the page
  // behind it when you flick the list.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="row between">
            <h3 style={{ fontSize: 17 }}>{title}</h3>
            <button className="header-btn" onClick={onClose}>
              Done
            </button>
          </div>
          {subtitle ? <div className="small muted">{subtitle}</div> : null}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
