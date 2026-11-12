/*
 * B6: the chart's data editor. A small spreadsheet: one row per label (category), one column per
 * series. Paste a block of cells from Excel / Google Sheets / CSV into any cell and it fills from
 * there (the grid grows up to the limits); "Paste a table" replaces everything, reading the series
 * names from the first row. Enter and the up / down arrows move between rows. Problems show at
 * once (live validation), next to the cell and in a list under the grid.
 */

import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ChartAreaIcon, ChartBarIcon, ChartColumnIcon, ChartLineIcon, ChartPieIcon, ClipboardPasteIcon, DonutIcon, LightbulbIcon, PlusIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SERIES_LIGHT } from '@/storefront/builder/elements/chart/palette'
import { newItemId } from './b6-model'
import {
  CHART_KINDS,
  CHART_LIMITS,
  chartDataProblems,
  formatCell,
  importTable,
  isMultiCell,
  isPieKind,
  kindHint,
  KIND_LABELS,
  parseNumber,
  parseTable,
  pasteAt,
  type ChartData,
  type ChartDataChange,
  type ChartKind,
} from './chart-data'

const KIND_ICONS: Record<ChartKind, typeof ChartBarIcon> = {
  column: ChartColumnIcon,
  bar: ChartBarIcon,
  line: ChartLineIcon,
  area: ChartAreaIcon,
  pie: ChartPieIcon,
  donut: DonutIcon,
}

const KIND_TIPS: Record<ChartKind, string> = {
  column: 'Compare a few items side by side.',
  bar: 'Compare items; fits long names.',
  line: 'Show change over time.',
  area: 'Show one total changing over time.',
  pie: 'Parts of a whole (one series, a few slices).',
  donut: 'Parts of a whole, with room in the middle.',
}

/** The chart kind as a row of pressed buttons with icons, and a hint whether it fits the data. */
export function ChartKindPicker({ kind, data, onChange }: { kind: ChartKind; data: ChartData; onChange: (kind: ChartKind) => void }) {
  const hint = kindHint(kind, data)
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Chart kind</legend>
      <div role="radiogroup" aria-label="Chart kind" aria-describedby={`${id}-hint`} className="grid grid-cols-3 gap-1.5">
        {CHART_KINDS.map((k) => {
          const Icon = KIND_ICONS[k]
          const active = k === kind
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              title={KIND_TIPS[k]}
              onClick={() => onChange(k)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                active && 'border-primary bg-primary/10 font-medium',
              )}
            >
              <Icon className={cn('size-5', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              {KIND_LABELS[k]}
            </button>
          )
        })}
      </div>
      <p
        id={`${id}-hint`}
        data-testid="chart-kind-hint"
        className={cn('flex gap-1.5 text-sm', hint.tone === 'problem' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {hint.tone === 'problem' ? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> : <LightbulbIcon className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span>
          {hint.text}
          {hint.suggested !== kind && (
            <>
              {' '}
              <button type="button" className="underline underline-offset-2" onClick={() => onChange(hint.suggested)}>
                Use {KIND_LABELS[hint.suggested].toLowerCase()}
              </button>
            </>
          )}
        </span>
      </p>
    </fieldset>
  )
}

type CellKey = `${number}:${number}`
const cellKey = (row: number, col: number): CellKey => `${row}:${col}`

export type ChartDataEditorProps = {
  kind: string
  data: ChartData
  /** `typing`: a key for edits that are one undo step (typing in one cell). */
  onChange: (data: ChartData, change?: ChartDataChange) => void
  /** Server problems by form key (`labels.2`, `series.0.name`, …). */
  errors?: Record<string, string>
}

export function ChartDataEditor({ kind, data, onChange, errors = {} }: ChartDataEditorProps) {
  const gridId = useId()
  const [drafts, setDrafts] = useState<Record<CellKey, string>>({})
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const { labels, series } = data
  const problems = chartDataProblems(kind, data)
  const problemAt = (key: string) => errors[key] ?? problems.find((p) => p.key === key)?.message
  const rowsFull = labels.length >= CHART_LIMITS.labels.max
  const seriesFull = series.length >= CHART_LIMITS.series.max || (isPieKind(kind) && series.length >= 1)

  const newSeriesId = (taken: readonly { id: string }[]) => newItemId(taken, 's')

  const setLabel = (row: number, text: string) => onChange({ labels: labels.map((l, i) => (i === row ? text : l)), series }, { typing: `label.${row}` })
  const setName = (s: number, name: string) => onChange({ labels, series: series.map((x, i) => (i === s ? { ...x, name } : x)) }, { typing: `name.${s}` })
  const setValue = (row: number, s: number, text: string) => {
    const key = cellKey(row, s + 1)
    setDrafts((d) => ({ ...d, [key]: text }))
    const value = parseNumber(text)
    if (value !== null) onChange({ labels, series: series.map((x, i) => (i === s ? { ...x, values: x.values.map((v, j) => (j === row ? value : v)) } : x)) }, { typing: `value.${row}.${s}` })
  }
  const endEdit = (row: number, col: number) => setDrafts((d) => {
    const next = { ...d }
    delete next[cellKey(row, col)]
    return next
  })

  const addRow = () => {
    if (rowsFull) return
    onChange({ labels: [...labels, `Label ${labels.length + 1}`], series: series.map((s) => ({ ...s, values: [...s.values, 0] })) })
  }
  const removeRow = (row: number) => {
    if (labels.length <= CHART_LIMITS.labels.min) return
    setDrafts({})
    onChange({ labels: labels.filter((_, i) => i !== row), series: series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== row) })) }, { removedRow: row })
  }
  const addSeries = () => {
    if (seriesFull) return
    onChange({ labels, series: [...series, { id: newSeriesId(series), name: `Series ${series.length + 1}`, values: labels.map(() => 0) }] })
  }
  const removeSeries = (s: number) => {
    const removed = series[s]
    if (!removed || series.length <= CHART_LIMITS.series.min) return
    setDrafts({})
    onChange({ labels, series: series.filter((_, i) => i !== s) })
  }

  const onPaste = (row: number, col: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!isMultiCell(text)) return
    event.preventDefault()
    setDrafts({})
    onChange(pasteAt(data, row, col, parseTable(text), newSeriesId))
    setNotes([])
  }

  const importAll = () => {
    const result = importTable(parseTable(pasteText))
    if (!result) {
      setNotes(['Nothing to paste: copy some cells first.'])
      return
    }
    // Existing series keep their ids (and so their Bangla names); extra ones get new ids.
    const kept: ChartData['series'] = []
    result.data.series.forEach((s, i) => kept.push({ ...s, id: series[i]?.id ?? newSeriesId([...series, ...kept]) }))
    setDrafts({})
    onChange({ labels: result.data.labels, series: kept })
    setNotes(result.warnings)
    setPasteOpen(false)
    setPasteText('')
  }

  /** Enter / ↓ next row, ↑ previous row (same column). */
  const onKeyDown = (row: number, col: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    const down = event.key === 'Enter' || event.key === 'ArrowDown'
    const up = event.key === 'ArrowUp'
    if (!down && !up) return
    const target = row + (down ? 1 : -1)
    if (target < 0) return
    event.preventDefault()
    if (target >= labels.length) {
      if (event.key !== 'Enter' || rowsFull) return
      addRow()
      requestAnimationFrame(() => document.getElementById(`${gridId}-${target}-${col}`)?.focus())
      return
    }
    document.getElementById(`${gridId}-${target}-${col}`)?.focus()
  }

  const inputClass = 'h-8 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 text-sm outline-none hover:border-input focus:border-ring focus:ring-2 focus:ring-ring/40 aria-invalid:border-destructive aria-invalid:bg-destructive/5'

  return (
    <div className="flex flex-col gap-2" data-testid="chart-data-editor">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium" id={`${gridId}-caption`}>Data</h3>
        <Button type="button" variant="outline" size="sm" aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}>
          <ClipboardPasteIcon data-icon="inline-start" /> Paste a table
        </Button>
      </div>
      {pasteOpen && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
          <label htmlFor={`${gridId}-paste`} className="text-sm">
            Copy cells in Excel or Google Sheets (labels in the first column, series names in the first row) and paste them here. This replaces the data below.
          </label>
          <Textarea id={`${gridId}-paste`} rows={4} className="font-mono text-xs" placeholder={'Month\tSales\nJan\t120\nFeb\t150'} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pasteText.trim() === ''} onClick={importAll}>Use this data</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm" aria-labelledby={`${gridId}-caption`}>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="min-w-28 border-b px-1.5 py-1 text-left text-xs font-medium text-muted-foreground">Label</th>
              {series.map((s, i) => {
                const problem = problemAt(`series.${i}.name`)
                return (
                  <th key={s.id} scope="col" className="min-w-24 border-b border-l px-0.5 py-0.5 font-normal">
                    <div className="flex items-center">
                      <span
                        role="img"
                        aria-label={`Colour ${i + 1} of the chart palette`}
                        title="Series colours follow a fixed order chosen for readability (also for colour-blind shoppers)."
                        data-testid="series-swatch"
                        className="ml-1 size-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: isPieKind(kind) ? undefined : SERIES_LIGHT[i] }}
                      />
                      <input
                        aria-label={`Name of series ${i + 1}`}
                        className={cn(inputClass, 'font-medium')}
                        maxLength={CHART_LIMITS.seriesName}
                        value={s.name}
                        aria-invalid={problem ? true : undefined}
                        title={problem}
                        onChange={(e) => setName(i, e.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={`Remove series ${s.name || i + 1}`}
                        title="Remove this series"
                        disabled={series.length <= CHART_LIMITS.series.min}
                        onClick={() => removeSeries(i)}
                        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:hidden [&_svg]:size-3.5"
                      >
                        <XIcon aria-hidden />
                      </button>
                    </div>
                  </th>
                )
              })}
              <th scope="col" className="w-8 border-b border-l p-0.5">
                <button
                  type="button"
                  aria-label="Add a series"
                  title={seriesFull ? (isPieKind(kind) ? 'A pie or donut shows one series.' : `At most ${CHART_LIMITS.series.max} series.`) : 'Add a series (a column of numbers)'}
                  disabled={seriesFull}
                  onClick={addSeries}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 [&_svg]:size-4"
                >
                  <PlusIcon aria-hidden />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label, row) => {
              const labelProblem = problemAt(`labels.${row}`)
              return (
                <tr key={row} className="border-b last:border-b-0">
                  <th scope="row" className="p-0.5 text-left font-normal">
                    <input
                      id={`${gridId}-${row}-0`}
                      aria-label={`Label of row ${row + 1}`}
                      className={inputClass}
                      maxLength={CHART_LIMITS.labelLength}
                      value={label}
                      aria-invalid={labelProblem ? true : undefined}
                      title={labelProblem}
                      onChange={(e) => setLabel(row, e.target.value)}
                      onPaste={onPaste(row, 0)}
                      onKeyDown={onKeyDown(row, 0)}
                    />
                  </th>
                  {series.map((s, i) => {
                    const key = cellKey(row, i + 1)
                    const draft = drafts[key]
                    const value = s.values[row]
                    const text = draft ?? (typeof value === 'number' ? formatCell(value) : '')
                    const invalid = (draft !== undefined && parseNumber(draft) === null) || problemAt(`series.${i}.values.${row}`) !== undefined
                    return (
                      <td key={s.id} className="border-l p-0.5">
                        <input
                          id={`${gridId}-${row}-${i + 1}`}
                          aria-label={`${s.name || `Series ${i + 1}`}, ${label || `row ${row + 1}`}`}
                          inputMode="decimal"
                          className={cn(inputClass, 'text-right tabular-nums')}
                          value={text}
                          aria-invalid={invalid ? true : undefined}
                          title={invalid ? 'Enter a number, e.g. 1200 or 12.5' : undefined}
                          onChange={(e) => setValue(row, i, e.target.value)}
                          onBlur={() => endEdit(row, i + 1)}
                          onPaste={onPaste(row, i + 1)}
                          onKeyDown={onKeyDown(row, i + 1)}
                        />
                      </td>
                    )
                  })}
                  <td className="border-l p-0.5">
                    <button
                      type="button"
                      aria-label={`Remove row ${label || row + 1}`}
                      title="Remove this row"
                      disabled={labels.length <= CHART_LIMITS.labels.min}
                      onClick={() => removeRow(row)}
                      className="flex size-7 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 [&_svg]:size-3.5"
                    >
                      <XIcon aria-hidden />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={rowsFull} onClick={addRow} title={rowsFull ? `At most ${CHART_LIMITS.labels.max} rows.` : undefined}>
          <PlusIcon data-icon="inline-start" /> Add row
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {labels.length}/{isPieKind(kind) ? CHART_LIMITS.pieLabels : CHART_LIMITS.labels.max} rows · {series.length}/{isPieKind(kind) ? 1 : CHART_LIMITS.series.max} series
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Tip: paste cells copied from a spreadsheet into any cell; Enter moves to the next row.</p>
      <p className="text-xs text-muted-foreground">
        {isPieKind(kind) ? 'Slices' : 'Series'} get their colours in a fixed order (blue, orange, green, yellow, pink, dark green), chosen to stay readable for colour-blind shoppers.
      </p>
      {notes.length > 0 && (
        <ul role="status" className="list-disc pl-5 text-sm text-muted-foreground">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-sm text-destructive" data-testid="chart-problems">
          {[...new Set(problems.map((p) => p.message))].slice(0, 5).map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
    </div>
  )
}
