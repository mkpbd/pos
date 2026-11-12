import type { LegendItem } from './legend-items'
import { seriesVar } from './palette'
import { textureVar } from './texture-ids'

/*
 * The legend: present for two or more series (or pie parts) — never for one, where the title names
 * what is plotted. Swatches mirror the mark (a short line for line charts, a small rect for bars,
 * areas and slices); names stay in the text token, never in the series colour.
 */

export function ChartLegend({ items, uid }: { items: LegendItem[]; uid: string }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="chart-legend">
      {items.map((item) => (
        <li key={item.key} className="inline-flex min-w-0 items-center gap-2">
          <svg width={14} height={10} aria-hidden="true" className="shrink-0">
            {item.mark === 'line' ? (
              <line x1={1} x2={13} y1={5} y2={5} strokeWidth={2} strokeLinecap="round" data-stroke="" style={{ stroke: seriesVar(item.slot) }} />
            ) : (
              <rect x={2} y={0} width={10} height={10} rx={2} data-fill="" style={{ fill: seriesVar(item.slot), ['--viz-tex' as string]: textureVar(uid, item.slot) }} />
            )}
          </svg>
          <span className="break-words">{item.name}</span>
        </li>
      ))}
    </ul>
  )
}
