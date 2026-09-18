import { useMemo, useState } from 'react'
import type { Point } from '../store/selectors'
import { fmtDate, fmtWeight } from '../store/selectors'

/**
 * Hand-rolled SVG line chart. Deliberately not a charting library — this is the
 * only chart in the app and it needs exactly one series, so ~100 lines of viewBox
 * math beats a 50 kB dependency.
 *
 * Rendered in a fixed 0..W / 0..H user-space viewBox and scaled by CSS, so it is
 * resolution-independent without needing to measure the container.
 */

const W = 320
const H = 150
const PAD_L = 34
const PAD_R = 8
const PAD_T = 10
const PAD_B = 20

export function LineChart({ points, unit = 'lb' }: { points: Point[]; unit?: string }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  const geom = useMemo(() => {
    if (points.length === 0) return null

    const values = points.map((p) => p.value)
    let min = Math.min(...values)
    let max = Math.max(...values)

    // Pad the domain so the line isn't glued to the frame. A flat series would
    // otherwise divide by zero, so give it an arbitrary ±1 band.
    if (min === max) {
      min -= 1
      max += 1
    } else {
      const pad = (max - min) * 0.12
      min -= pad
      max += pad
    }
    min = Math.max(0, min)

    const t0 = points[0]!.date
    const t1 = points[points.length - 1]!.date
    const span = t1 - t0 || 1

    const x = (d: number) =>
      points.length === 1
        ? PAD_L + (W - PAD_L - PAD_R) / 2
        : PAD_L + ((d - t0) / span) * (W - PAD_L - PAD_R)
    const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B)

    const coords = points.map((p) => ({ ...p, cx: x(p.date), cy: y(p.value) }))
    const line = coords.map((c) => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(' ')
    const area = `${PAD_L},${H - PAD_B} ${line} ${coords[coords.length - 1]!.cx.toFixed(1)},${H - PAD_B}`

    return { coords, line, area, min, max }
  }, [points])

  if (!geom) {
    return <div className="empty">Not enough history to plot yet.</div>
  }

  const { coords, line, area, min, max } = geom
  const active = activeIdx !== null ? coords[activeIdx] : null
  const latest = coords[coords.length - 1]!
  const first = coords[0]!
  const change = latest.value - first.value

  return (
    <div className="chart">
      {/* Uniform scaling (the default xMidYMid meet): stretching would distort the
          axis labels along with the plot. */}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="History chart">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* horizontal gridlines + y labels at min / mid / max */}
        {[0, 0.5, 1].map((f) => {
          const v = min + (max - min) * (1 - f)
          const yy = PAD_T + f * (H - PAD_T - PAD_B)
          return (
            <g key={f}>
              <line
                x1={PAD_L}
                y1={yy}
                x2={W - PAD_R}
                y2={yy}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text x={PAD_L - 5} y={yy + 3} className="chart-ylabel" textAnchor="end">
                {Math.round(v)}
              </text>
            </g>
          )
        })}

        {coords.length > 1 ? <polyline points={area} fill="url(#fill)" stroke="none" /> : null}

        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={activeIdx === i ? 4 : 2.5}
            fill={activeIdx === i ? 'var(--text)' : 'var(--accent)'}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Invisible wide hit targets — real fingers can't hit a 2.5px dot. */}
        {coords.map((c, i) => (
          <rect
            key={`hit-${i}`}
            x={c.cx - 12}
            y={0}
            width={24}
            height={H}
            fill="transparent"
            onPointerDown={() => setActiveIdx(i === activeIdx ? null : i)}
          />
        ))}
      </svg>

      <div className="chart-foot row between">
        {active ? (
          <>
            <span className="small mono">
              {fmtWeight(Math.round(active.value * 10) / 10)} {unit}
            </span>
            <span className="small faint">{fmtDate(active.date)}</span>
          </>
        ) : (
          <>
            <span className="small mono">
              {fmtWeight(Math.round(latest.value * 10) / 10)} {unit}
              {coords.length > 1 ? (
                <span className={change >= 0 ? 'up' : 'down'}>
                  {' '}
                  {change >= 0 ? '+' : ''}
                  {fmtWeight(Math.round(change * 10) / 10)}
                </span>
              ) : null}
            </span>
            <span className="small faint">
              {coords.length} session{coords.length === 1 ? '' : 's'} · tap a point
            </span>
          </>
        )}
      </div>
    </div>
  )
}
