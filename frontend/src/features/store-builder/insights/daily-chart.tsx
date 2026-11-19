import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChartDataTable } from '@/components/common/charts/chart-data-table'
import { CHART_THEME_CLASS, compactNumber, labelledIndexes, niceTicks, useElementWidth } from '@/components/common/charts/chart-utils'
import { longAxisLabel, shortAxisLabel } from '@/features/reports/format'
import { todayIn } from '@/features/promotions/report'
import { cn } from '@/lib/utils'
import { formatCount } from './insights-model'

/*
 * B15: one figure per day as thin columns on one axis (views or orders — never both on one scale),
 * with the days a version was published marked by a hairline and "v3". Hover or arrow keys give
 * the day's readout; a visually hidden table carries every value.
 */

export type DailyPoint = { day: string; value: number }

const MARGIN = { top: 16, right: 8, bottom: 22, left: 36 }

/** A column with a 4 px rounded top and a square foot on the baseline. */
function columnPath(x: number, w: number, top: number, base: number): string {
  const h = base - top
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`
}

export function DailyChart({ title, points, publishes, timeZone, height = 150, className }: {
  /** The chart's accessible name and its table's caption ("People who visited each day"). */
  title: string
  points: DailyPoint[]
  /** Published versions (to mark on their day). */
  publishes: { number: number; published_at: string }[]
  timeZone: string | undefined
  height?: number
  className?: string
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(340)
  const tooltipId = useId()
  const [active, setActive] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const refs = useRef<(SVGRectElement | null)[]>([])

  const n = points.length
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right)
  const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom)
  const ticks = niceTicks(0, Math.max(1, ...points.map((p) => p.value)), 3)
  const max = ticks[ticks.length - 1] ?? 1
  const y = (v: number) => MARGIN.top + plotH - (v / (max || 1)) * plotH
  const step = n > 0 ? plotW / n : plotW
  const barW = Math.max(1, Math.min(24, step - 2))
  const left = (i: number) => MARGIN.left + i * step
  const center = (i: number) => left(i) + step / 2
  const labelled = labelledIndexes(n, plotW, 56)

  const releaseByDay = new Map<string, number[]>()
  for (const v of publishes) {
    const date = new Date(v.published_at)
    if (Number.isNaN(date.getTime())) continue
    const day = todayIn(timeZone, date)
    releaseByDay.set(day, [...(releaseByDay.get(day) ?? []), v.number])
  }
  const releaseText = (day: string) => {
    const list = releaseByDay.get(day)
    return list ? `Published ${list.map((number) => `v${number}`).join(', ')}` : null
  }
  const readout = (i: number) => {
    const p = points[i]
    if (!p) return ''
    const release = releaseText(p.day)
    return `${longAxisLabel(p.day)}: ${formatCount(p.value)}${release ? `. ${release}` : ''}`
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

  if (n === 0) return <p className="text-sm text-muted-foreground">No days in this period.</p>

  const shown = active === null ? undefined : points[active]
  const tabStop = focusIndex ?? n - 1

  return (
    <div className={cn('relative', CHART_THEME_CLASS, className)} data-testid="insights-daily-chart">
      <div ref={wrapRef} className="relative w-full">
        <svg
          role="group"
          aria-label={`${title}. Use the arrow keys to move between days.`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full select-none"
          onPointerLeave={() => setActive(focusIndex !== null && refs.current[focusIndex] === document.activeElement ? focusIndex : null)}
        >
          {ticks.map((t) => (
            <g key={t} aria-hidden>
              <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--muted-foreground)' : 'var(--viz-grid)'} strokeOpacity={t === 0 ? 0.5 : 1} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {compactNumber(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            labelled.has(i) ? (
              <text key={`x-${p.day}`} x={center(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]" aria-hidden>
                {shortAxisLabel(p.day)}
              </text>
            ) : null,
          )}
          {points.map((p, i) => {
            const list = releaseByDay.get(p.day)
            return list ? (
              <g key={`v-${p.day}`} aria-hidden data-testid="publish-marker">
                <line x1={center(i)} x2={center(i)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1} />
                <text x={Math.min(Math.max(center(i), MARGIN.left + 8), MARGIN.left + plotW - 8)} y={MARGIN.top - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  v{list[list.length - 1]}
                </text>
              </g>
            ) : null
          })}
          {points.map((p, i) => (
            <path key={`b-${p.day}`} d={columnPath(center(i) - barW / 2, barW, y(p.value), y(0))} fill="var(--viz-1)" fillOpacity={active === null || active === i ? 1 : 0.55} aria-hidden />
          ))}
          {points.map((p, i) => (
            <rect
              key={`h-${p.day}`}
              ref={(el) => {
                refs.current[i] = el
              }}
              role="img"
              aria-label={readout(i)}
              tabIndex={i === tabStop ? 0 : -1}
              x={left(i)}
              y={MARGIN.top}
              width={step}
              height={plotH}
              fill="transparent"
              className="outline-none focus-visible:stroke-ring focus-visible:stroke-2"
              onPointerEnter={() => setActive(i)}
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
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{ left: Math.min(Math.max(center(active), 70), width - 70), transform: 'translate(-50%, -100%)' }}
          >
            <div className="font-mono text-sm font-semibold text-foreground">{formatCount(shown.value)}</div>
            <div className="whitespace-nowrap text-muted-foreground">{longAxisLabel(shown.day)}</div>
            {releaseText(shown.day) && <div className="whitespace-nowrap text-muted-foreground">{releaseText(shown.day)}</div>}
          </div>
        )}
      </div>
      <ChartDataTable
        caption={title}
        header="Day"
        columns={[{ key: 'value', label: title }, { key: 'release', label: 'Published' }]}
        rows={points.map((p) => ({ key: p.day, label: longAxisLabel(p.day), cells: { value: formatCount(p.value), release: releaseText(p.day) ?? '—' } }))}
      />
    </div>
  )
}
