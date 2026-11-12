/*
 * B6 chart data editor logic (pure): pasting a table from Excel / Google Sheets / CSV, reading
 * numbers the way shop owners type them, the chart limits (contract §3) and a plain-language hint
 * which chart kind fits the data.
 */

export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'stacked-column' | 'stacked-bar'
export type ChartSeriesData = { id: string; name: string; values: number[] }
export type ChartData = { labels: string[]; series: ChartSeriesData[] }

/** `typing`: edits with the same key are one undo step; `removedRow`: the row that was removed (Bangla labels shift up). */
export type ChartDataChange = { typing?: string; removedRow?: number }

/** Chart limits (contract §3; mirrored by the server). */
export const CHART_LIMITS = {
  labels: { min: 1, max: 24 },
  labelLength: 40,
  series: { min: 1, max: 6 },
  /** B8a: a stacked chart compares 2–6 parts of each total. */
  stackedSeries: { min: 2, max: 6 },
  seriesName: 40,
  pieLabels: 8,
  /** The store draws a pie / donut with more parts (or any negative value) as bars. */
  pieParts: 6,
  title: 120,
  description: 300,
  unit: 8,
  height: { min: 200, max: 600 },
} as const

export const CHART_KINDS: readonly ChartKind[] = ['column', 'bar', 'stacked-column', 'stacked-bar', 'line', 'area', 'pie', 'donut']

export const isPieKind = (kind: string) => kind === 'pie' || kind === 'donut'

/** B8a: stacked columns / bars (each bar split into its series). */
export const isStackedKind = (kind: string) => kind === 'stacked-column' || kind === 'stacked-bar'

/* ----------------------------------------------------------------------------------------------
 * Numbers
 * -------------------------------------------------------------------------------------------- */

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/**
 * A number as typed or pasted: Bangla digits, thousands separators (1,234 / 1 234), a currency
 * sign or unit around it (৳ 1,200, 12 %, $5), a minus or brackets for negatives. Null when it
 * isn't a number. A single comma followed by one or two digits is a decimal comma (12,5).
 */
export function parseNumber(raw: string): number | null {
  let text = raw.trim().replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
  if (text === '') return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  // Strip currency signs, units and spaces around the digits.
  text = text.replace(/^[^\d\-\u2212+.,]+/, '').replace(/[^\d.,]+$/, '').replace(/[\s\u00a0\u202f']/g, '')
  if (text.startsWith('-') || text.startsWith('\u2212')) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith('+')) text = text.slice(1)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '')
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.')
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.')
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/** A value for a grid cell: no exponent, no float noise. */
export function formatCell(value: number): string {
  if (!Number.isFinite(value)) return ''
  return String(Math.round(value * 1e6) / 1e6)
}

/* ----------------------------------------------------------------------------------------------
 * Pasted tables
 * -------------------------------------------------------------------------------------------- */

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells.map((c) => c.trim())
}

/**
 * Rows of cells from pasted text: tab-separated (Excel, Sheets, Numbers) or CSV (comma or
 * semicolon, with quotes). Blank lines at the end are dropped.
 */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  if (lines.length === 0) return []
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t').map((c) => c.trim()))
  const sample = lines.slice(0, 5).join('\n')
  const semicolons = (sample.match(/;/g) ?? []).length
  const commas = (sample.match(/,/g) ?? []).length
  const delimiter = semicolons > 0 && semicolons >= commas / 2 ? ';' : ','
  return lines.map((l) => splitCsvLine(l, delimiter))
}

/** True when a pasted text holds more than one cell. */
export function isMultiCell(text: string): boolean {
  return /[\t\n]/.test(text.replace(/\r?\n$/, ''))
}

export type TableImport = { data: Omit<ChartData, 'series'> & { series: { name: string; values: number[] }[] }; warnings: string[] }

/**
 * A whole table → chart data. Layout: labels down the first column, one series per further
 * column; the first row holds the series names when its cells (after the first) aren't numbers.
 * A table with labels across the first row and one row per series (wide) is turned around when
 * it has more columns than rows. Limits are applied (extra rows / columns are cut, with a warning);
 * cells that aren't numbers become 0, with a warning.
 */
export function importTable(rows: string[][]): TableImport | null {
  const clean = rows.filter((r) => r.some((c) => c !== ''))
  if (clean.length === 0) return null
  const width = Math.max(...clean.map((r) => r.length))
  let grid = clean.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  const warnings: string[] = []

  const numericShare = (cells: string[]) => (cells.length === 0 ? 0 : cells.filter((c) => parseNumber(c) !== null).length / cells.length)
  // Wide: labels across the top, series down the side (more columns than rows, first row text).
  if (grid.length >= 2 && width > grid.length + 1 && numericShare(grid[0]!.slice(1)) === 0 && numericShare(grid.slice(1).flatMap((r) => r.slice(1))) > 0.5) {
    grid = Array.from({ length: width }, (_, c) => grid.map((r) => r[c] ?? ''))
  }

  const cols = grid[0]!.length
  if (cols < 2) {
    // One column: values only (labels become "1", "2", …) unless they aren't numbers.
    const values = grid.map((r) => parseNumber(r[0] ?? ''))
    if (values.every((v) => v === null)) return { data: { labels: grid.map((r) => r[0] ?? '').slice(0, CHART_LIMITS.labels.max), series: [{ name: 'Series 1', values: grid.map(() => 0).slice(0, CHART_LIMITS.labels.max) }] }, warnings: ['Only names were pasted; enter the numbers next to them.'] }
    grid = grid.map((r, i) => [String(i + 1), r[0] ?? ''])
  }
  const header = numericShare(grid[0]!.slice(1)) === 0 && grid.length > 1
  const names = header ? grid[0]!.slice(1) : grid[0]!.slice(1).map((_, i) => `Series ${i + 1}`)
  let body = header ? grid.slice(1) : grid
  let seriesCount = names.length

  if (body.length > CHART_LIMITS.labels.max) {
    warnings.push(`Only the first ${CHART_LIMITS.labels.max} rows were used (a chart shows at most ${CHART_LIMITS.labels.max} labels).`)
    body = body.slice(0, CHART_LIMITS.labels.max)
  }
  if (seriesCount > CHART_LIMITS.series.max) {
    warnings.push(`Only the first ${CHART_LIMITS.series.max} columns of numbers were used (at most ${CHART_LIMITS.series.max} series).`)
    seriesCount = CHART_LIMITS.series.max
  }
  let notNumbers = 0
  const series = names.slice(0, seriesCount).map((name, s) => ({
    name: (name || `Series ${s + 1}`).slice(0, CHART_LIMITS.seriesName),
    values: body.map((r) => {
      const cell = r[s + 1] ?? ''
      const value = parseNumber(cell)
      if (value === null && cell !== '') notNumbers++
      return value ?? 0
    }),
  }))
  if (notNumbers > 0) warnings.push(`${notNumbers} cell${notNumbers === 1 ? ' wasn’t a number and is' : 's weren’t numbers and are'} 0 now.`)
  const labels = body.map((r, i) => (r[0] || `Label ${i + 1}`).slice(0, CHART_LIMITS.labelLength))
  if (body.some((r) => (r[0] ?? '').length > CHART_LIMITS.labelLength)) warnings.push(`Long labels were cut to ${CHART_LIMITS.labelLength} characters.`)
  return { data: { labels, series }, warnings }
}

/**
 * Pasting a block of cells into the grid at (row, col): col 0 = the label column, col ≥ 1 = a
 * series. The grid grows (rows and series) up to the limits. Returns the new data.
 */
export function pasteAt(data: ChartData, row: number, col: number, block: string[][], newSeriesId: (taken: readonly { id: string }[]) => string): ChartData {
  const labels = [...data.labels]
  const series = data.series.map((s) => ({ ...s, values: [...s.values] }))
  for (let r = 0; r < block.length; r++) {
    const target = row + r
    if (target >= CHART_LIMITS.labels.max) break
    while (labels.length <= target) {
      labels.push(`Label ${labels.length + 1}`)
      for (const s of series) s.values.push(0)
    }
    const cells = block[r] ?? []
    for (let c = 0; c < cells.length; c++) {
      const targetCol = col + c
      const cell = cells[c] ?? ''
      if (targetCol === 0) {
        labels[target] = cell.slice(0, CHART_LIMITS.labelLength)
        continue
      }
      const s = targetCol - 1
      if (s >= CHART_LIMITS.series.max) break
      while (series.length <= s) series.push({ id: newSeriesId(series), name: `Series ${series.length + 1}`, values: labels.map(() => 0) })
      const value = parseNumber(cell)
      if (value !== null) series[s]!.values[target] = value
    }
  }
  return { labels, series }
}

/* ----------------------------------------------------------------------------------------------
 * Checks and hints
 * -------------------------------------------------------------------------------------------- */

export type ChartProblem = { key: string; message: string }

/** Problems of the chart's data (form keys: `labels`, `labels.<i>`, `series`, `series.<i>.name`, `series.<i>.values.<j>`). */
export function chartDataProblems(kind: string, data: ChartData): ChartProblem[] {
  const out: ChartProblem[] = []
  const { labels, series } = data
  if (labels.length < CHART_LIMITS.labels.min) out.push({ key: 'labels', message: 'Add at least one row.' })
  if (labels.length > CHART_LIMITS.labels.max) out.push({ key: 'labels', message: `At most ${CHART_LIMITS.labels.max} rows.` })
  labels.forEach((label, i) => {
    if (label.trim() === '') out.push({ key: `labels.${i}`, message: `Row ${i + 1} needs a label.` })
    else if (label.length > CHART_LIMITS.labelLength) out.push({ key: `labels.${i}`, message: `Row ${i + 1}: at most ${CHART_LIMITS.labelLength} characters.` })
  })
  if (series.length < CHART_LIMITS.series.min) out.push({ key: 'series', message: 'Add at least one series (a column of numbers).' })
  if (series.length > CHART_LIMITS.series.max) out.push({ key: 'series', message: `At most ${CHART_LIMITS.series.max} series.` })
  series.forEach((s, i) => {
    if (s.name.trim() === '') out.push({ key: `series.${i}.name`, message: `Series ${i + 1} needs a name.` })
    else if (s.name.length > CHART_LIMITS.seriesName) out.push({ key: `series.${i}.name`, message: `Series ${i + 1}: at most ${CHART_LIMITS.seriesName} characters.` })
    if (s.values.length !== labels.length) out.push({ key: `series.${i}.values`, message: `Series ${i + 1} needs one number per row.` })
    s.values.forEach((v, j) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) out.push({ key: `series.${i}.values.${j}`, message: `Row ${j + 1} of ${s.name || `series ${i + 1}`} isn’t a number.` })
    })
  })
  if (isPieKind(kind)) {
    if (series.length !== 1) out.push({ key: 'series', message: 'A pie or donut chart shows exactly one series. Remove the others or pick another kind.' })
    if (labels.length > CHART_LIMITS.pieLabels) out.push({ key: 'labels', message: `A pie or donut chart shows at most ${CHART_LIMITS.pieLabels} slices.` })
    if (series[0]?.values.some((v) => v < 0)) out.push({ key: 'series', message: 'A pie or donut chart can’t show negative numbers.' })
  }
  if (isStackedKind(kind)) {
    if (series.length < CHART_LIMITS.stackedSeries.min) out.push({ key: 'series', message: 'A stacked chart needs at least 2 series: add a column of numbers, or pick another kind.' })
    series.forEach((s, i) =>
      s.values.forEach((v, j) => {
        if (v < 0) out.push({ key: `series.${i}.values.${j}`, message: `Row ${j + 1} of ${s.name || `series ${i + 1}`}: a stacked chart can’t show negative numbers.` })
      }),
    )
  }
  return out
}

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|week|wk|mon|tue|wed|thu|fri|sat|sun|জানু|ফেব্রু|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টে|অক্টো|নভে|ডিসে)/i
const YEARISH = /^(\d{4}|\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?|\d{4}[/-]\d{1,2}([/-]\d{1,2})?|[a-z]{3,9}\.? ?'?\d{2,4})$/i

/** Whether the labels look like points in time (months, quarters, years, dates, weekdays). */
export function looksLikeTime(labels: readonly string[]): boolean {
  if (labels.length < 3) return false
  const timey = labels.filter((l) => MONTHS.test(l.trim()) || YEARISH.test(l.trim())).length
  return timey / labels.length >= 0.75
}

export type KindHint = { suggested: ChartKind; text: string; tone: 'ok' | 'tip' | 'problem' }

/** A plain-language hint whether the chosen kind fits the data, and which kind would. */
export function kindHint(kind: ChartKind, data: ChartData): KindHint {
  const { labels, series } = data
  const time = looksLikeTime(labels)
  const longLabels = labels.some((l) => l.length > 12)
  const allPositive = series.every((s) => s.values.every((v) => v >= 0))
  const pieFits = series.length === 1 && labels.length >= 2 && labels.length <= 5 && allPositive
  const asBars = labels.length > CHART_LIMITS.pieParts
  const suggested: ChartKind = time ? (series.length === 1 ? 'area' : 'line') : longLabels || labels.length > 8 ? 'bar' : 'column'

  if (isStackedKind(kind)) {
    const horizontal = kind === 'stacked-bar'
    if (series.length < 2) return { suggested, text: 'A stacked chart splits each bar into parts, so it needs at least 2 series.', tone: 'problem' }
    if (!allPositive) return { suggested, text: 'Parts of a stack can’t be negative. Use columns or lines.', tone: 'problem' }
    if (!horizontal && (longLabels || labels.length > 8)) return { suggested: 'stacked-bar', text: 'Long or many labels fit better on horizontal stacked bars.', tone: 'tip' }
    return { suggested: kind, text: 'Good for showing what each total is made of; the tooltip shows every part and the total.', tone: 'ok' }
  }
  if (isPieKind(kind)) {
    if (series.length !== 1) return { suggested, text: 'A pie or donut shows one series only. With several series, columns or lines compare them better.', tone: 'problem' }
    if (labels.length > CHART_LIMITS.pieLabels) return { suggested, text: `A pie or donut shows at most ${CHART_LIMITS.pieLabels} slices; bars read better with this many.`, tone: 'problem' }
    if (!allPositive) return { suggested, text: 'Slices can’t be negative. Use columns or bars.', tone: 'problem' }
    if (asBars) return { suggested: 'bar', text: `With more than ${CHART_LIMITS.pieParts} parts your store shows this as bars instead of slices, because thin slices can’t be told apart.`, tone: 'problem' }
    if (!pieFits) return { suggested, text: `Slices are hard to compare beyond about five (the store shows at most ${CHART_LIMITS.pieParts}). Bars show the same thing more clearly.`, tone: 'tip' }
    return { suggested: kind, text: `Good for parts of a whole that add up to 100 %, with up to ${CHART_LIMITS.pieParts} slices.`, tone: 'ok' }
  }
  if (kind === 'line' || kind === 'area') {
    if (!time && labels.length < 3) return { suggested, text: 'Lines show change over time. With only a few separate items, columns compare them better.', tone: 'tip' }
    if (!time) return { suggested, text: 'Lines suit labels in order, such as months or years. For separate items (products, branches), use columns or bars.', tone: 'tip' }
    if (kind === 'area' && series.length > 1) return { suggested: 'line', text: 'Overlapping areas hide each other. Lines compare several series more clearly.', tone: 'tip' }
    return { suggested: kind, text: 'Good for change over time.', tone: 'ok' }
  }
  if (time && labels.length >= 6) return { suggested, text: 'Your labels look like time. A line shows the trend more clearly than separate bars.', tone: 'tip' }
  if (kind === 'column' && (longLabels || labels.length > 8)) return { suggested: 'bar', text: 'Long or many labels fit better on horizontal bars.', tone: 'tip' }
  return { suggested: kind, text: kind === 'bar' ? 'Good for comparing items, even with long names.' : 'Good for comparing a few items side by side.', tone: 'ok' }
}

export const KIND_LABELS: Record<ChartKind, string> = {
  column: 'Columns',
  bar: 'Bars',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  donut: 'Donut',
  'stacked-column': 'Stacked',
  'stacked-bar': 'Stacked bars',
}
