import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartDataTable } from '@/components/common/charts/chart-data-table'
import { CHART_THEME_CLASS, labelledIndexes, niceTicks, useElementWidth } from '@/components/common/charts/chart-utils'
import { longAxisLabel, shortAxisLabel } from '@/features/reports/format'
import { cn } from '@/lib/utils'
import { formatPercent } from '../insights/insights-model'

/*
 * B13: how each version's rate developed — one line per version (A: --viz-1, B: --viz-2, a
 * validated pair in light and dark), the share of its visitors so far who reached the goal, on
 * one % axis. A legend names both; the line ends carry "A 3.1 %" when they don't collide.
 * Hover / arrow keys: a crosshair with both values; a visually hidden table holds every day.
 */

export type RatePoint = { day: string; A: number | null; B: number | null }

const MARGIN = { top: 12, right: 52, bottom: 22, left: 36 }
const SERIES = [
  { key: 'A', label: 'Version A', color: 'var(--viz-1)' },
  { key: 'B', label: 'Version B', color: 'var(--viz-2)' },
] as const

export function ExperimentChart({ title, points, height = 150, className }: { title: string; points: RatePoint[]; height?: number; className?: string }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(340)
  const tooltipId = useId()
  const [active, setActive] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const refs = useRef<(SVGRectElement | null)[]>([])

  const n = points.length
  if (n === 0) return <p className="text-sm text-muted-foreground">No days in the test yet.</p>

  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right)
  const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom)
  const values = points.flatMap((p) => [p.A, p.B]).filter((v): v is number => v !== null)
  const ticks = niceTicks(0, Math.max(1, ...values), 3)
  const max = ticks[ticks.length - 1] ?? 1
  const x = (i: number) => MARGIN.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const y = (v: number) => MARGIN.top + plotH - (v / (max || 1)) * plotH
  const labelled = labelledIndexes(n, plotW, 56)
  const step = n <= 1 ? plotW : plotW / (n - 1)
  const hitLeft = (i: number) => (i === 0 ? MARGIN.left - 4 : x(i) - step / 2)
  const hitRight = (i: number) => (i === n - 1 ? MARGIN.left + plotW + 4 : x(i) + step / 2)

  const path = (key: 'A' | 'B') => {
    let d = ''
    let pen = false
    points.forEach((p, i) => {
      const v = p[key]
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }
  const last = (key: 'A' | 'B') => {
    for (let i = n - 1; i >= 0; i--) {
      const v = points[i]![key]
      if (v !== null) return { i, v }
    }
    return null
  }
  const ends = { A: last('A'), B: last('B') }
  // End labels only when they sit apart (else the legend and the readout carry them).
  const apart = ends.A && ends.B ? Math.abs(y(ends.A.v) - y(ends.B.v)) >= 14 : true

  const value = (v: number | null) => (v === null ? 'no visitors yet' : formatPercent(v))
  const readout = (i: number) => {
    const p = points[i]
    return p ? `${longAxisLabel(p.day)}: version A ${value(p.A)}, version B ${value(p.B)}` : ''
  }
  const move = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i))
    setFocusIndex(next)
    setActive(next)
    refs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }
    if (e.key in keys) {
      e.preventDefault()
      move(keys[e.key] as number)
    } else if (e.key === 'Escape') setActive(null)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / (rect.width || width)) * width
    const i = n <= 1 ? 0 : Math.round(((px - MARGIN.left) / plotW) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const tabStop = focusIndex ?? n - 1
  const shown = active === null ? undefined : points[active]

  return (
    <div className={cn('relative flex flex-col gap-1.5', CHART_THEME_CLASS, className)} data-testid="ab-chart">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={`${title} legend`}>
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="14" height="10" aria-hidden className="shrink-0">
              <line x1="0" x2="14" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <div ref={wrapRef} className="relative w-full">
        <svg
          role="group"
          aria-label={`${title}. Use the arrow keys to move between days.`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full touch-pan-y select-none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(focusIndex !== null && refs.current[focusIndex] === document.activeElement ? focusIndex : null)}
        >
          {ticks.map((t) => (
            <g key={t} aria-hidden>
              <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--muted-foreground)' : 'var(--viz-grid)'} strokeOpacity={t === 0 ? 0.5 : 1} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {`${Number(t.toFixed(2))}\u00a0%`}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            labelled.has(i) ? (
              <text key={`x-${p.day}`} x={x(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]" aria-hidden>
                {shortAxisLabel(p.day)}
              </text>
            ) : null,
          )}
          {SERIES.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-series={s.key} aria-hidden />
          ))}
          {SERIES.map((s) => {
            const end = ends[s.key]
            if (!end) return null
            return (
              <g key={`end-${s.key}`} aria-hidden>
                <circle cx={x(end.i)} cy={y(end.v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                {apart && (
                  <text x={x(end.i) + 8} y={y(end.v)} dy="0.32em" className="fill-foreground text-[11px] font-medium tabular-nums">
                    {s.key} {formatPercent(end.v)}
                  </text>
                )}
              </g>
            )
          })}
          {active !== null && (
            <g aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />
              {SERIES.map((s) => {
                const v = points[active]![s.key]
                return v === null ? null : <circle key={s.key} cx={x(active)} cy={y(v)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              })}
            </g>
          )}
          {points.map((p, i) => (
            <rect
              key={`h-${p.day}`}
              ref={(el) => {
                refs.current[i] = el
              }}
              role="img"
              aria-label={readout(i)}
              tabIndex={i === tabStop ? 0 : -1}
              x={hitLeft(i)}
              y={MARGIN.top}
              width={Math.max(1, hitRight(i) - hitLeft(i))}
              height={plotH}
              fill="transparent"
              className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
              onFocus={() => {
                setFocusIndex(i)
                setActive(i)
              }}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => onKeyDown(e, i)}
            />
          ))}
        </svg>
        {shown && active !== null && (
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{ left: Math.min(Math.max(x(active), 70), width - 70), transform: 'translate(-50%, -100%)' }}
          >
            <div className="mb-0.5 whitespace-nowrap text-muted-foreground">{longAxisLabel(shown.day)}</div>
            <dl className="flex flex-col gap-0.5">
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <svg width="10" height="4" aria-hidden>
                      <line x1="0" x2="10" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    {s.label}
                  </dt>
                  <dd className="font-mono font-semibold whitespace-nowrap text-foreground">{value(shown[s.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      <ChartDataTable
        caption={title}
        header="Day"
        columns={SERIES.map((s) => ({ key: s.key, label: s.label }))}
        rows={points.map((p) => ({ key: p.day, label: longAxisLabel(p.day), cells: { A: value(p.A), B: value(p.B) } }))}
      />
    </div>
  )
}
