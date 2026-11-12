import { useLocale } from '../../../i18n/locale'
import { formatShare, formatValue } from './format'
import { isPieKind, pieParts, stackTotal, type ChartModel } from './model'
import { useChartMessages } from './messages'

/*
 * The chart's table-view twin (the WCAG-clean equivalent): every value, always in the DOM so screen
 * readers reach it; the toggle only shows or hides it visually. Wide tables scroll inside their
 * own box, never the page.
 */
export function ChartDataTable({ id, model, visible }: { id: string; model: ChartModel; visible: boolean }) {
  const m = useChartMessages()
  const { formatNumber, digits } = useLocale()
  const pie = isPieKind(model.requestedKind)
  const shares = pie ? new Map(pieParts(model).map((p) => [p.index, p.share])) : null
  const value = (v: number | null) => (v === null ? '—' : formatValue(v, model.unit, model.unitPosition, formatNumber))

  return (
    <div id={id} className={visible ? 'viz-table-wrap max-w-full overflow-x-auto' : 'viz-table-wrap sr-only'} data-testid="chart-table" data-visible={visible ? 'true' : 'false'}>
      <table className="w-full border-collapse text-left text-sm tabular-nums">
        {model.title && <caption className="sr-only">{model.title}</caption>}
        <thead>
          <tr className="border-b border-sf-border text-[var(--viz-ink)]">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {m.category}
            </th>
            {model.series.map((s) => (
              <th key={s.id} scope="col" className="py-2 pr-4 text-right font-semibold">
                {s.name || m.value}
              </th>
            ))}
            {shares && (
              <th scope="col" className="py-2 pr-4 text-right font-semibold">
                {m.share}
              </th>
            )}
            {model.stacked && (
              <th scope="col" className="py-2 pr-4 text-right font-semibold">
                {m.total}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {model.labels.map((label, li) => (
            <tr key={li} className="border-b border-sf-border/60">
              <th scope="row" className="py-2 pr-4 font-normal">
                {label}
              </th>
              {model.series.map((s) => (
                <td key={s.id} className="py-2 pr-4 text-right">
                  {digits(value(s.values[li] ?? null))}
                </td>
              ))}
              {shares && <td className="py-2 pr-4 text-right">{shares.has(li) ? digits(formatShare(shares.get(li) as number, formatNumber)) : '—'}</td>}
              {model.stacked && <td className="py-2 pr-4 text-right font-semibold">{digits(value(stackTotal(model, li)))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
