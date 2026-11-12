/*
 * B8a: the comparison table's grid editor. One row per feature (its label in the first column),
 * one column per compared product / plan; each cell is "Yes", "No" or a short text. Rows are
 * added, removed and moved with buttons (keyboard friendly); the columns themselves are edited in
 * the list above the grid.
 */

import { useId } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ComparisonCell, ComparisonCellKind, ComparisonColumn, ComparisonRow } from '@/storefront/builder/types'
import { newItemId, type ItemListChange } from './b6-model'
import { EMPTY_CELL } from './b8a-model'
import { FieldError, type Errors } from './fields'

export type ComparisonGridProps = {
  columns: readonly ComparisonColumn[]
  rows: readonly ComparisonRow[]
  onChange: (rows: ComparisonRow[], change?: ItemListChange) => void
  /** Problems by form key (`rows`, `rows.2.label`, `rows.2.cells.<column_id>.text`). */
  errors?: Errors
  limits: { min: number; max: number }
  textLimits: { label: number; cell: number }
}

const KIND_OPTIONS: readonly { value: ComparisonCellKind; label: string }[] = [
  { value: 'yes', label: '✓ Yes' },
  { value: 'no', label: '✗ No' },
  { value: 'text', label: 'Text' },
]

export function ComparisonGrid({ columns, rows, onChange, errors = {}, limits, textLimits }: ComparisonGridProps) {
  const id = useId()
  const canAdd = rows.length < limits.max
  const canRemove = rows.length > limits.min
  const columnName = (column: ComparisonColumn, index: number) => column.title.trim() || `Column ${index + 1}`
  const rowName = (row: ComparisonRow, index: number) => row.label.trim() || `Row ${index + 1}`

  const update = (index: number, next: ComparisonRow, typing?: string) =>
    onChange(rows.map((row, i) => (i === index ? next : row)), typing ? { typing: `${next.id}.${typing}` } : undefined)
  const setCell = (index: number, columnId: string, cell: ComparisonCell, typing?: string) => {
    const row = rows[index]!
    update(index, { ...row, cells: { ...row.cells, [columnId]: cell } }, typing)
  }
  const add = () => {
    if (!canAdd) return
    const cells = Object.fromEntries(columns.map((c) => [c.id, { kind: 'yes' as const, text: '' }]))
    onChange([...rows, { id: newItemId(rows), label: 'New feature', cells }])
    requestAnimationFrame(() => document.getElementById(`${id}-label-${rows.length}`)?.focus())
  }
  const remove = (index: number) => {
    const row = rows[index]
    if (!row || !canRemove) return
    onChange(rows.filter((_, i) => i !== index), { removed: row.id })
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row!)
    onChange(next)
  }

  const inputClass =
    'h-8 w-full min-w-0 rounded-sm border border-input bg-background px-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40 aria-invalid:border-destructive aria-invalid:bg-destructive/5'
  const iconButton =
    'flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5'

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2" data-testid="comparison-grid">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-title`} className="flex-1 text-sm font-medium">Rows</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{rows.length} of {limits.max}</span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm" aria-labelledby={`${id}-title`}>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="min-w-32 border-b px-1.5 py-1 text-left text-xs font-medium text-muted-foreground">Feature</th>
              {columns.map((column, c) => (
                <th key={column.id} scope="col" className="min-w-24 max-w-32 truncate border-b border-l px-1.5 py-1 text-left text-xs font-medium" title={columnName(column, c)}>
                  {columnName(column, c)}
                </th>
              ))}
              <th scope="col" className="border-b border-l px-1.5 py-1 text-xs font-medium text-muted-foreground">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const labelError = errors[`rows.${r}.label`]
              return (
                <tr key={row.id} className="border-b align-top last:border-b-0">
                  <th scope="row" className="p-1 text-left font-normal">
                    <input
                      id={`${id}-label-${r}`}
                      aria-label={`Feature of row ${r + 1}`}
                      className={inputClass}
                      maxLength={textLimits.label}
                      value={row.label}
                      aria-invalid={labelError ? true : undefined}
                      title={labelError}
                      onChange={(e) => update(r, { ...row, label: e.target.value }, 'label')}
                    />
                  </th>
                  {columns.map((column, c) => {
                    const cell = row.cells[column.id] ?? EMPTY_CELL
                    const where = `${rowName(row, r)}, ${columnName(column, c)}`
                    const textError = errors[`rows.${r}.cells.${column.id}.text`] ?? errors[`rows.${r}.cells.${column.id}`]
                    return (
                      <td key={column.id} className="border-l p-1">
                        <div className="flex flex-col gap-1">
                          <select
                            aria-label={where}
                            className={cn(inputClass, 'pr-6')}
                            value={cell.kind}
                            onChange={(e) => setCell(r, column.id, { kind: e.target.value as ComparisonCellKind, text: e.target.value === 'text' ? cell.text : '' })}
                          >
                            {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {cell.kind === 'text' && (
                            <input
                              aria-label={`${where}: text`}
                              placeholder="e.g. 2 years"
                              className={inputClass}
                              maxLength={textLimits.cell}
                              value={cell.text}
                              aria-invalid={textError ? true : undefined}
                              title={textError}
                              onChange={(e) => setCell(r, column.id, { kind: 'text', text: e.target.value }, `cells.${column.id}`)}
                            />
                          )}
                        </div>
                      </td>
                    )
                  })}
                  <td className="border-l p-1">
                    <div className="flex">
                      <button type="button" className={iconButton} aria-label={`Move row ${r + 1} up`} title="Move up" disabled={r === 0} onClick={() => move(r, r - 1)}>
                        <ArrowUpIcon aria-hidden />
                      </button>
                      <button type="button" className={iconButton} aria-label={`Move row ${r + 1} down`} title="Move down" disabled={r === rows.length - 1} onClick={() => move(r, r + 1)}>
                        <ArrowDownIcon aria-hidden />
                      </button>
                      <button type="button" className={iconButton} aria-label={`Remove row ${r + 1}`} title={canRemove ? 'Remove this row' : `At least ${limits.min}.`} disabled={!canRemove} onClick={() => remove(r)}>
                        <XIcon aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <FieldError message={errors.rows} />
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={!canAdd} onClick={add} title={canAdd ? undefined : `At most ${limits.max} rows.`}>
        <PlusIcon data-icon="inline-start" /> Add row
      </Button>
      <p className="text-xs text-muted-foreground">Shoppers see ✓ and ✗ with the words “Yes” and “No” for screen readers. On phones the table scrolls sideways and the first column stays put.</p>
      {Object.keys(errors).some((k) => /^rows\.\d+\./.test(k)) && (
        <ul role="alert" className="flex flex-col gap-0.5 text-sm text-destructive" data-testid="comparison-problems">
          {[...new Set(Object.entries(errors).filter(([k]) => /^rows\.\d+\./.test(k)).map(([, m]) => m))].slice(0, 4).map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </section>
  )
}
