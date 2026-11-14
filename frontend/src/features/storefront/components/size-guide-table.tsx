import type { ClipboardEvent, KeyboardEvent } from 'react'
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { moveItem, newId, pasteIntoDraft, SIZE_GUIDE_LIMITS, type GuideDraft } from '@/features/storefront/size-guides'
import { cn } from '@/lib/utils'

type Props = {
  draft: GuideDraft
  onChange: (next: GuideDraft) => void
  /** "en": the table itself (structure editable); "bn": Bangla texts of the same cells. */
  mode: 'en' | 'bn'
  errors: Record<string, string>
  disabled?: boolean
}

function parseBlock(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((line) => line.split('\t').map((c) => c.trim()))
}

/**
 * The size guide's measurement table as an editable grid: column names in the header row, one row
 * per size. Arrow keys / Enter move between cells and a block copied from a spreadsheet pastes in
 * (adding rows and columns up to 40 × 12). In Bangla mode only the texts change.
 */
export function SizeGuideTable({ draft, onChange, mode, errors, disabled }: Props) {
  const bn = mode === 'bn'
  const L = SIZE_GUIDE_LIMITS
  const label = (i: number) => draft.columns[i]?.label.trim() || `column ${i + 1}`
  const rowName = (r: number) => draft.rows[r]?.cells[draft.columns[0]?.id ?? '']?.trim() || `row ${r + 1}`

  const setColumn = (i: number, value: string) => {
    const column = draft.columns[i]
    if (!column) return
    if (bn) onChange({ ...draft, bn: { ...draft.bn, columns: { ...draft.bn.columns, [column.id]: value } } })
    else onChange({ ...draft, columns: draft.columns.map((c, n) => (n === i ? { ...c, label: value } : c)) })
  }
  const setCell = (r: number, c: number, value: string) => {
    const row = draft.rows[r]
    const column = draft.columns[c]
    if (!row || !column) return
    if (bn) onChange({ ...draft, bn: { ...draft.bn, cells: { ...draft.bn.cells, [row.id]: { ...draft.bn.cells[row.id], [column.id]: value } } } })
    else onChange({ ...draft, rows: draft.rows.map((x, n) => (n === r ? { ...x, cells: { ...x.cells, [column.id]: value } } : x)) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target
    if (!(t instanceof HTMLInputElement) || t.dataset.r === undefined) return
    const r = Number(t.dataset.r)
    const c = Number(t.dataset.c)
    let to: [number, number] | null = null
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) to = [r + 1, c]
    else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) to = [r - 1, c]
    else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) to = [r, c - 1]
    else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length && t.selectionEnd === t.value.length) to = [r, c + 1]
    if (!to) return
    if (e.key === 'Enter') e.preventDefault()
    const next = e.currentTarget.querySelector<HTMLInputElement>(`input[data-r="${to[0]}"][data-c="${to[1]}"]`)
    if (next) {
      e.preventDefault()
      next.focus()
      next.select()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const t = e.target
    if (bn || !(t instanceof HTMLInputElement) || t.dataset.r === undefined) return
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return
    e.preventDefault()
    const r = Number(t.dataset.r)
    const c = Number(t.dataset.c)
    const block = parseBlock(text)
    if (r === -1) {
      // Pasted into the header: the first line names the columns, the rest fills rows.
      const [head = [], ...body] = block
      const named = pasteIntoDraft(draft, 0, c, body)
      const columns = [...named.columns]
      while (columns.length < Math.min(L.columns, c + head.length)) columns.push({ id: newId('c'), label: '' })
      head.forEach((value, i) => {
        const column = columns[c + i]
        if (column) columns[c + i] = { ...column, label: value }
      })
      onChange({ ...named, columns })
    } else {
      onChange(pasteIntoDraft(draft, r, c, block))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto rounded-md border" onKeyDown={onKeyDown} onPaste={onPaste}>
        <table className="text-sm" aria-label={bn ? 'Size table in Bangla' : 'Size table'}>
          <thead className="bg-muted/50">
            <tr>
              {draft.columns.map((column, c) => {
                const error = errors[bn ? `translations.bn.columns.${column.id}` : `columns.${c}.label`]
                return (
                  <th key={column.id} scope="col" className="min-w-32 px-1 py-1.5 text-left align-top font-medium">
                    <Input
                      data-r={-1}
                      data-c={c}
                      lang={bn ? 'bn' : undefined}
                      aria-label={bn ? `Column ${c + 1} name in Bangla` : `Column ${c + 1} name`}
                      placeholder={bn ? column.label : 'Column name'}
                      maxLength={L.label}
                      value={bn ? (draft.bn.columns[column.id] ?? '') : column.label}
                      aria-invalid={error ? true : undefined}
                      disabled={disabled}
                      className="h-8 font-medium"
                      onChange={(e) => setColumn(c, e.target.value)}
                    />
                    {error && <p className="mt-0.5 text-xs font-normal text-destructive">{error}</p>}
                    {!bn && !disabled && (
                      <div className="mt-0.5 flex">
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${label(c)} left`} disabled={c === 0} onClick={() => onChange({ ...draft, columns: moveItem(draft.columns, c, -1) })}><ArrowLeftIcon /></Button>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${label(c)} right`} disabled={c === draft.columns.length - 1} onClick={() => onChange({ ...draft, columns: moveItem(draft.columns, c, 1) })}><ArrowRightIcon /></Button>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove column ${label(c)}`} disabled={draft.columns.length === 1} onClick={() => onChange({ ...draft, columns: draft.columns.filter((_, n) => n !== c) })}><Trash2Icon /></Button>
                      </div>
                    )}
                  </th>
                )
              })}
              {!bn && <th className="w-20"><span className="sr-only">Row actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, r) => (
              <tr key={row.id} className="border-t">
                {draft.columns.map((column, c) => {
                  const error = errors[bn ? `translations.bn.cells.${row.id}.${column.id}` : `rows.${r}.cells.${column.id}`]
                  return (
                    <td key={column.id} className={cn('px-1 py-1 align-top', c === 0 && 'bg-muted/20')}>
                      <Input
                        data-r={r}
                        data-c={c}
                        lang={bn ? 'bn' : undefined}
                        aria-label={`${label(c)}, ${rowName(r)}${bn ? ' in Bangla' : ''}`}
                        placeholder={bn ? (row.cells[column.id] ?? '') : undefined}
                        maxLength={L.cell}
                        value={bn ? (draft.bn.cells[row.id]?.[column.id] ?? '') : (row.cells[column.id] ?? '')}
                        aria-invalid={error ? true : undefined}
                        disabled={disabled}
                        className={cn('h-8', c === 0 && 'font-medium')}
                        onChange={(e) => setCell(r, c, e.target.value)}
                      />
                      {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
                    </td>
                  )
                })}
                {!bn && (
                  <td className="px-1 py-1 align-top whitespace-nowrap">
                    {!disabled && (
                      <>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${rowName(r)} up`} disabled={r === 0} onClick={() => onChange({ ...draft, rows: moveItem(draft.rows, r, -1) })}><ArrowUpIcon /></Button>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Move ${rowName(r)} down`} disabled={r === draft.rows.length - 1} onClick={() => onChange({ ...draft, rows: moveItem(draft.rows, r, 1) })}><ArrowDownIcon /></Button>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove row ${rowName(r)}`} disabled={draft.rows.length === 1} onClick={() => onChange({ ...draft, rows: draft.rows.filter((_, n) => n !== r) })}><Trash2Icon /></Button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!bn && !disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={draft.rows.length >= L.rows} onClick={() => onChange({ ...draft, rows: [...draft.rows, { id: newId('r'), cells: {} }] })}>
            <PlusIcon data-icon="inline-start" /> Add row
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={draft.columns.length >= L.columns} onClick={() => onChange({ ...draft, columns: [...draft.columns, { id: newId('c'), label: '' }] })}>
            <PlusIcon data-icon="inline-start" /> Add column
          </Button>
          <span className="text-xs text-muted-foreground">
            {draft.rows.length}/{L.rows} rows · {draft.columns.length}/{L.columns} columns. Tip: copy a table from Excel and paste it into a cell.
          </span>
        </div>
      )}
      {!bn && (errors.columns || errors.rows) && <p className="text-sm text-destructive">{errors.columns ?? errors.rows}</p>}
    </div>
  )
}
