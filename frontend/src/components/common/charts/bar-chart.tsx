import { useRef, useState, type KeyboardEvent } from 'react'
import { ChartDataTable } from '@/components/common/charts/chart-data-table'
import { CHART_THEME_CLASS, plotValue, SERIES_COLORS } from '@/components/common/charts/chart-utils'
import { cn } from '@/lib/utils'

export type BarDatum = {
  key: string
  label: string
  /** Decimal string (or count) — plotted, and shown through `formatValue`. */
  value: string | number
  /** Extra lines for the tooltip and the data table (e.g. "12 orders", "38% of sales"). */
  details?: { label: string; value: string }[]
  /** Fixed colour (e.g. one per channel); defaults to the first series colour. */
  color?: string
}

type Props = {
  title: string
  data: BarDatum[]
  formatValue: (value: string) => string
  /** Heading of the table's first column. */
  categoryHeader?: string
  valueHeader?: string
  className?: string
  emptyText?: string
}

/**
 * Horizontal bars with direct value labels. Every bar is drawn in SVG on a shared scale; the
 * list is one tab stop and Up/Down (Home/End) move between bars, each showing its tooltip on
 * focus as on hover. A visually hidden table repeats the values.
 */
export function BarChart({ title, data, formatValue, categoryHeader = 'Category', valueHeader = 'Value', className, emptyText = 'No data for this period.' }: Props) {
  const [active, setActive] = useState<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])

  if (data.length === 0) {
    return <p className={cn('rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground', className)}>{emptyText}</p>
  }

  const max = Math.max(...data.map((d) => Math.abs(plotValue(d.value))), 0) || 1
  const display = (d: BarDatum) => formatValue(String(d.value))
  const spoken = (d: BarDatum) => [`${d.label}: ${display(d)}`, ...(d.details ?? []).map((x) => `${x.label} ${x.value}`)].join(', ')

  const move = (i: number) => {
    const next = Math.max(0, Math.min(data.length - 1, i))
    setFocusIndex(next)
    refs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, number> = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: data.length - 1 }
    if (e.key in keys) {
      e.preventDefault()
      move(keys[e.key] as number)
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <div className={cn('relative flex flex-col', CHART_THEME_CLASS, className)}>
      <ul role="list" aria-label={`${title}. Use the arrow keys to move between bars.`} className="flex flex-col gap-2.5">
        {data.map((d, i) => {
          const pct = Math.max(0, (Math.abs(plotValue(d.value)) / max) * 100)
          const color = d.color ?? SERIES_COLORS[0]
          return (
            <li
              key={d.key}
              ref={(el) => {
                refs.current[i] = el
              }}
              tabIndex={i === focusIndex ? 0 : -1}
              aria-label={spoken(d)}
              className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => {
                setFocusIndex(i)
                setActive(i)
              }}
              onBlur={() => setActive(null)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <div className="flex items-baseline justify-between gap-3 text-sm" aria-hidden>
                <span className="min-w-0 truncate">{d.label}</span>
                <span className="shrink-0 font-mono font-medium text-foreground">{display(d)}</span>
              </div>
              <svg className="mt-1 block h-2.5 w-full" aria-hidden preserveAspectRatio="none" viewBox="0 0 100 10">
                <rect x="0" y="0" width="100" height="10" rx="2" fill="var(--muted)" />
                <rect x="0" y="0" width={pct} height="10" rx="2" fill={color} className={cn('transition-opacity', active !== null && active !== i && 'opacity-60')} data-bar={d.key} />
              </svg>
              {active === i && d.details && d.details.length > 0 && (
                <div role="tooltip" className="pointer-events-none absolute top-full right-0 z-10 mt-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <div className="font-mono font-semibold text-foreground">{display(d)}</div>
                  {d.details.map((x) => (
                    <div key={x.label} className="flex justify-between gap-3 text-muted-foreground">
                      <span>{x.label}</span>
                      <span className="font-mono text-foreground">{x.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <ChartDataTable
        caption={title}
        header={categoryHeader}
        columns={[{ key: '__value', label: valueHeader }, ...uniqueDetailLabels(data).map((l) => ({ key: l, label: l }))]}
        rows={data.map((d) => ({ key: d.key, label: d.label, cells: { __value: display(d), ...Object.fromEntries((d.details ?? []).map((x) => [x.label, x.value])) } }))}
      />
    </div>
  )
}

function uniqueDetailLabels(data: BarDatum[]): string[] {
  const labels: string[] = []
  for (const d of data) for (const x of d.details ?? []) if (!labels.includes(x.label)) labels.push(x.label)
  return labels
}
