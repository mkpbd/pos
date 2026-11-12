import { useLocale } from '../../../i18n/locale'
import type { ChartLayout, Stop } from './layout'
import { tooltipBox } from './tooltip-box'
import { seriesVar } from './palette'

/*
 * One tooltip for hover and keyboard focus. It enhances, never gates: every value is also in the
 * data table. Values lead (strong ink), the series name follows (secondary); rows are keyed by a
 * short stroke of the series colour (line keys, not boxes). Owner text is rendered as React text
 * nodes (never HTML). Kept inside the chart's width so it never causes horizontal scroll.
 */

export function ChartTooltip({ id, stop, layout }: { id: string; stop: Stop; layout: ChartLayout }) {
  const { digits } = useLocale()
  const box = tooltipBox(stop, layout)
  return (
    <div
      id={id}
      role="tooltip"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute z-10 rounded-lg border border-sf-border bg-[var(--viz-surface)] px-3 py-2 text-xs shadow-lg"
      style={{ left: box.left, top: box.top, width: box.width }}
    >
      <p className="mb-1 truncate text-[var(--viz-ink-2)]">{stop.title}</p>
      <ul className="flex flex-col gap-1">
        {stop.rows.map((row) => (
          <li key={`${row.slot}-${row.name}`} className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: seriesVar(row.slot) }} />
            <strong className="text-sm font-bold text-[var(--viz-ink)] tabular-nums">{digits(row.value)}</strong>
            {row.share && <span className="text-[var(--viz-ink-2)] tabular-nums">{digits(row.share)}</span>}
            {row.name && <span className="min-w-0 truncate text-[var(--viz-ink-2)]">{row.name}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
