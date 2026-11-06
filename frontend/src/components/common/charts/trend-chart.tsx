import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChartDataTable } from '@/components/common/charts/chart-data-table'
import { CHART_THEME_CLASS, compactNumber, labelledIndexes, niceTicks, plotValue, SERIES_COLORS, useElementWidth } from '@/components/common/charts/chart-utils'
import { cn } from '@/lib/utils'

export type TrendSeries = { key: string; label: string; color?: string }

export type TrendPoint = {
  key: string
  /** Short x-axis label ("3 Nov"). */
  label: string
  /** Full label for the tooltip, the data table and screen readers ("Tue, 3 Nov 2026"). */
  longLabel?: string
  /** Decimal strings (or counts) by series key. */
  values: Record<string, string | number | null | undefined>
}

type Props = {
  /** Accessible name of the chart and caption of its data table. */
  title: string
  data: TrendPoint[]
  series: TrendSeries[]
  /** Formats a value for tooltips and the table (e.g. money). */
  formatValue: (value: string) => string
  /** Line only, or lines with filled areas (stacked when `stacked`). */
  variant?: 'line' | 'area'
  /** Stack the series (parts of one whole, e.g. POS + online = net sales). */
  stacked?: boolean
  /** An extra value shown in the tooltip and table but not plotted (e.g. the server's total). */
  total?: { key: string; label: string }
  /** Heading of the table's first column. */
  xHeader?: string
  height?: number
  className?: string
  emptyText?: string
}

const MARGIN = { top: 12, right: 12, bottom: 26, left: 44 }

const asText = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined || value === '' ? null : String(value)

/**
 * Line / area chart over an ordered x axis (days or months), drawn as plain SVG.
 *
 * Accessibility: the plot is one tab stop; arrow keys (Home/End) move between points, each
 * with a full spoken label, and the same readout appears as a tooltip on hover and focus. A
 * visually hidden table carries every value. Colours come from CSS variables that follow the
 * light/dark theme; series are named in a legend, never by colour alone.
 */
export function TrendChart({ title, data, series, formatValue, variant = 'line', stacked = false, total, xHeader = 'Date', height = 240, className, emptyText = 'No data for this period.' }: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const tooltipId = useId()
  const [active, setActive] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const [hasFocus, setHasFocus] = useState(false)
  const pointRefs = useRef<(SVGRectElement | null)[]>([])

  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }))
  const n = data.length
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right)
  const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom)

  const layout = useMemo(() => {
    // Per point, per series: [bottom, top] in data units (bottom = 0 unless stacked).
    const stacks = data.map((p) => {
      let base = 0
      return series.map((s) => {
        const v = plotValue(p.values[s.key])
        const from = stacked ? base : 0
        const to = stacked ? base + v : v
        if (stacked) base = to
        return [from, to] as const
      })
    })
    const all = stacks.flat().flat()
    const ticks = niceTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1)
    return { stacks, ticks, min: ticks[0] ?? 0, max: ticks[ticks.length - 1] ?? 1 }
  }, [data, series, stacked])

  const x = (i: number) => MARGIN.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1))
  const y = (v: number) => MARGIN.top + plotH - ((v - layout.min) / (layout.max - layout.min || 1)) * plotH
  const labelled = labelledIndexes(n, plotW)

  const readout = (i: number) => {
    const p = data[i]
    if (!p) return ''
    const parts = colored.map((s) => `${s.label} ${formatPoint(p.values[s.key])}`)
    if (total) parts.push(`${total.label} ${formatPoint(p.values[total.key])}`)
    return `${p.longLabel ?? p.label}: ${parts.join(', ')}`
  }
  function formatPoint(value: string | number | null | undefined) {
    const text = asText(value)
    return text === null ? '—' : formatValue(text)
  }

  const moveFocus = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i))
    setFocusIndex(next)
    setActive(next)
    pointRefs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, number> = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: n - 1 }
    if (e.key in keys) {
      e.preventDefault()
      moveFocus(keys[e.key] as number)
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / (rect.width || width)) * width
    const i = n <= 1 ? 0 : Math.round(((px - MARGIN.left) / plotW) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }

  if (n === 0) {
    return (
      <div className={cn('flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground', className)} style={{ minHeight: Math.min(height, 160) }}>
        {emptyText}
      </div>
    )
  }

  const tabStop = focusIndex ?? n - 1
  const shown = active
  const shownPoint = shown === null ? undefined : data[shown]
  const step = n <= 1 ? plotW : plotW / (n - 1)
  // Hit areas: half-way to each neighbour, the outer ones reaching the chart's edges.
  const hitLeft = (i: number) => (i === 0 ? 0 : x(i) - step / 2)
  const hitRight = (i: number) => (i === n - 1 ? width : x(i) + step / 2)

  const linePath = (si: number) => data.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(layout.stacks[i]![si]![1]).toFixed(1)}`).join(' ')
  const areaPath = (si: number) => {
    const top = data.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(layout.stacks[i]![si]![1]).toFixed(1)}`).join(' ')
    const bottom = data.map((_, j) => n - 1 - j).map((i) => `L${x(i).toFixed(1)},${y(layout.stacks[i]![si]![0]).toFixed(1)}`).join(' ')
    return `${top} ${bottom} Z`
  }

  return (
    <div className={cn('relative flex flex-col gap-2', CHART_THEME_CLASS, className)}>
      {colored.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={`${title} legend`}>
          {colored.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <svg width="14" height="10" aria-hidden className="shrink-0">
                {variant === 'area' ? <rect x="0" y="1" width="14" height="8" rx="2" fill={s.color} /> : <line x1="0" x2="14" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />}
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={wrapRef} className="relative w-full">
        <svg
          role="group"
          aria-label={`${title}. Use the arrow keys to move between points.`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full touch-pan-y select-none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(hasFocus ? focusIndex : null)}
        >
          {layout.ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={MARGIN.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]" aria-hidden>
                {compactNumber(t)}
              </text>
            </g>
          ))}
          {data.map((p, i) =>
            labelled.has(i) ? (
              <text key={p.key} x={x(i)} y={height - 8} textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]" aria-hidden>
                {p.label}
              </text>
            ) : null,
          )}
          {variant === 'area' && colored.map((s, si) => <path key={`area-${s.key}`} d={areaPath(si)} fill={s.color} fillOpacity={stacked ? 0.28 : 0.12} stroke="none" />)}
          {colored.map((s, si) => (
            <path key={`line-${s.key}`} d={linePath(si)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-series={s.key} />
          ))}
          {shown !== null && (
            <g aria-hidden>
              <line x1={x(shown)} x2={x(shown)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} />
              {colored.map((s, si) => (
                <circle key={s.key} cx={x(shown)} cy={y(layout.stacks[shown]![si]![1])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          )}
          {data.map((p, i) => (
            <rect
              key={p.key}
              ref={(el) => {
                pointRefs.current[i] = el
              }}
              role="img"
              aria-label={readout(i)}
              tabIndex={i === tabStop ? 0 : -1}
              x={hitLeft(i)}
              y={MARGIN.top}
              width={hitRight(i) - hitLeft(i)}
              height={plotH}
              fill="transparent"
              className="outline-none"
              onFocus={() => {
                setHasFocus(true)
                setFocusIndex(i)
                setActive(i)
              }}
              onBlur={() => {
                setHasFocus(false)
                setActive(null)
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
            />
          ))}
          {hasFocus && focusIndex !== null && (
            <line x1={x(focusIndex)} x2={x(focusIndex)} y1={MARGIN.top - 4} y2={MARGIN.top + plotH} stroke="var(--ring)" strokeWidth={2} strokeDasharray="4 3" aria-hidden />
          )}
        </svg>
        {shownPoint && shown !== null && (
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: Math.min(Math.max(x(shown), 80), width - 80), transform: 'translateX(-50%)' }}
          >
            <div className="mb-1 font-medium text-muted-foreground">{shownPoint.longLabel ?? shownPoint.label}</div>
            <dl className="flex flex-col gap-0.5">
              {colored.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                    <svg width="10" height="4" aria-hidden><line x1="0" x2="10" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
                    {s.label}
                  </dt>
                  <dd className="font-mono font-semibold whitespace-nowrap text-foreground">{formatPoint(shownPoint.values[s.key])}</dd>
                </div>
              ))}
              {total && (
                <div className="flex items-center justify-between gap-3 border-t pt-0.5">
                  <dt className="whitespace-nowrap text-muted-foreground">{total.label}</dt>
                  <dd className="font-mono font-semibold whitespace-nowrap text-foreground">{formatPoint(shownPoint.values[total.key])}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
      <ChartDataTable
        caption={title}
        header={xHeader}
        columns={[...colored.map((s) => ({ key: s.key, label: s.label })), ...(total ? [{ key: total.key, label: total.label }] : [])]}
        rows={data.map((p) => ({
          key: p.key,
          label: p.longLabel ?? p.label,
          cells: Object.fromEntries([...colored.map((s) => s.key), ...(total ? [total.key] : [])].map((k) => [k, formatPoint(p.values[k])])),
        }))}
      />
    </div>
  )
}
