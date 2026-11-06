import { formatDay } from '@/features/promotions/report'
import { changeDirection, formatChange } from '@/features/reports/format'
import { statementAmount, type Statement } from '@/features/reports/statement'
import { cn } from '@/lib/utils'

const periodLabel = (p: { from: string; to: string } | null, fallback: string) => (p ? (p.from === p.to ? formatDay(p.from) : `${formatDay(p.from)} – ${formatDay(p.to)}`) : fallback)

/**
 * Profit and loss laid out as a statement: sections with indented detail lines, subtotals with
 * a rule above, the net result double-ruled — current period beside the previous one.
 * Deductions (discounts, returns, costs, expenses) arrive as negative amounts and show in brackets.
 */
export function PnlStatement({ title, statement, currency }: { title: string; statement: Statement; currency?: string | null }) {
  const { lines, hasComparison } = statement
  const current = periodLabel(statement.period, 'This period')
  const previous = periodLabel(statement.previousPeriod, 'Previous period')

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[22rem] text-sm" aria-label={title} data-testid="pnl-statement">
        <caption className="sr-only">{`${title}${currency ? `, amounts in ${currency}` : ''}`}</caption>
        <thead className="border-b bg-muted text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium sm:px-4">
              <span className="sr-only">Line</span>
              {currency && <span aria-hidden>{currency}</span>}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">{current}</th>
            {hasComparison && (
              <>
                <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">{previous}</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell sm:px-4">Change</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            if (line.kind === 'heading') {
              return (
                <tr key={line.key} className="border-t first:border-t-0">
                  <th scope="rowgroup" colSpan={hasComparison ? 4 : 2} className="px-3 pt-4 pb-1 text-left text-xs font-bold tracking-[0.08rem] text-heading uppercase sm:px-4">
                    {line.label}
                  </th>
                </tr>
              )
            }
            const strong = line.kind !== 'line'
            const direction = changeDirection(line.change)
            return (
              <tr
                key={line.key}
                data-kind={line.kind}
                className={cn(line.kind === 'subtotal' && 'border-t', line.kind === 'total' && 'border-t-2 border-b-4 border-double border-b-border bg-muted/40')}
              >
                <th scope="row" className={cn('px-3 py-1.5 text-left sm:px-4', line.depth > 0 ? 'pl-7 font-normal sm:pl-8' : '', strong ? 'font-semibold text-foreground' : 'font-normal')}>
                  {line.label}
                </th>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums sm:px-4', strong && 'font-semibold', line.kind === 'total' && line.amount?.startsWith('-') && 'text-destructive')}>{statementAmount(line.amount)}</td>
                {hasComparison && (
                  <>
                    <td className={cn('px-3 py-1.5 text-right font-mono text-muted-foreground tabular-nums sm:px-4', strong && 'font-semibold')}>{statementAmount(line.previous)}</td>
                    <td className="hidden px-3 py-1.5 text-right font-mono text-xs tabular-nums sm:table-cell sm:px-4">
                      {line.change === null ? <span className="text-muted-foreground">—</span> : <span className={cn(direction === 'flat' && 'text-muted-foreground')}>{formatChange(line.change)}</span>}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
