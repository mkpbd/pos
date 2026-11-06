import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ReportColumn, ReportRow } from '@/features/reports/api'
import { formatCell, isNumericType } from '@/features/reports/format'
import { parseSort } from '@/features/reports/params'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: Record<string, unknown> | null
  sort: string | null
  onSort: (sort: string) => void
  timeZone?: string
  /** Shown in the caption, e.g. "Amounts in BDT". */
  note?: string
}

/** Rows of a report with sortable headers (server-side sort) and its totals row. */
export function ReportTable({ title, columns, rows, totals, sort, onSort, timeZone, note }: Props) {
  const current = parseSort(sort)

  const toggle = (column: ReportColumn) => {
    // Numbers sort high-to-low first; text and dates A–Z / oldest first.
    const firstDesc = isNumericType(column.type)
    const desc = current?.key === column.key ? !current.desc : firstDesc
    onSort(`${desc ? '-' : ''}${column.key}`)
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table aria-label={title}>
        {note && <caption className="sr-only">{`${title}. ${note}`}</caption>}
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => {
              const active = current?.key === c.key
              const Icon = !active ? ArrowUpDownIcon : current.desc ? ArrowDownIcon : ArrowUpIcon
              return (
                <TableHead
                  key={c.key}
                  scope="col"
                  className={cn(isNumericType(c.type) && 'text-right', i === 0 && 'sticky left-0 z-[1] bg-muted')}
                  aria-sort={active ? (current.desc ? 'descending' : 'ascending') : c.sortable ? 'none' : undefined}
                >
                  {c.sortable ? (
                    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => toggle(c)}>
                      {c.label}
                      <Icon className={cn('size-3.5', !active && 'text-muted-foreground/60')} aria-hidden />
                      <span className="sr-only">{active ? (current.desc ? ', sorted high to low' : ', sorted low to high') : ', sort'}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={rowKey(row, r)}>
              {columns.map((c, i) => (
                <TableCell
                  key={c.key}
                  className={cn(isNumericType(c.type) && 'text-right font-mono tabular-nums', i === 0 && 'sticky left-0 z-[1] bg-card font-medium', isNegative(row[c.key]) && 'text-destructive')}
                >
                  {cellText(row, c, timeZone)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {totals && (
          <TableFooter>
            <TableRow data-testid="report-totals">
              {columns.map((c, i) => {
                const value = totals[c.key]
                const text = value === undefined || value === null ? (i === 0 ? 'Total' : '') : formatCell(c.type, value, { timeZone })
                return i === 0 ? (
                  <TableHead key={c.key} scope="row" className="sticky left-0 z-[1] bg-muted font-semibold text-foreground">{text}</TableHead>
                ) : (
                  <TableCell key={c.key} className={cn('font-semibold', isNumericType(c.type) && 'text-right font-mono tabular-nums')}>{text}</TableCell>
                )
              })}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  )
}

/** A `<key>_label` sibling (e.g. month_label "Nov 2026") is the display form of the value. */
function cellText(row: ReportRow, column: ReportColumn, timeZone?: string): string {
  const label = row[`${column.key}_label`]
  return typeof label === 'string' && label !== '' ? label : formatCell(column.type, row[column.key], { timeZone })
}

function rowKey(row: ReportRow, index: number): string {
  const id = row.id ?? row.key
  return typeof id === 'string' || typeof id === 'number' ? `${id}-${index}` : String(index)
}

function isNegative(value: unknown): boolean {
  return typeof value === 'string' && /^-\d/.test(value.trim())
}
