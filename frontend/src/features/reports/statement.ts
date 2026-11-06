import type { ReportRun } from '@/features/reports/api'
import { percentChange } from '@/features/reports/format'
import { formatMoney } from '@/lib/money'

/**
 * Profit and loss as statement lines (revenue → COGS → gross profit → operating expenses →
 * other income → net profit), each with the previous period beside it. Accepts the run's
 * `data` as a flat list of lines, a `{ lines }` / `{ rows }` object, or `{ sections: [{ label,
 * lines, total }] }`. The server computes every figure; the change column is display only.
 */

export type StatementLineKind = 'heading' | 'line' | 'subtotal' | 'total'

export type StatementLine = {
  key: string
  label: string
  kind: StatementLineKind
  /** 0 = section level, 1 = detail line under it. */
  depth: number
  amount: string | null
  previous: string | null
  change: string | null
}

export type Statement = {
  lines: StatementLine[]
  hasComparison: boolean
  period: { from: string; to: string } | null
  previousPeriod: { from: string; to: string } | null
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)

function amountOf(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k]
    if (v !== undefined && v !== null) {
      if (typeof v === 'object') {
        const nested = v as Record<string, unknown>
        const inner = str(nested.amount ?? nested.value ?? nested.current)
        if (inner !== null) return inner
      } else {
        const s = str(v)
        if (s !== null) return s
      }
    }
  }
  return null
}

function kindOf(r: Record<string, unknown>): StatementLineKind {
  const t = str(r.kind ?? r.type ?? r.style)
  if (t === 'heading' || t === 'header' || t === 'section') return 'heading'
  if (t === 'total' || t === 'grand_total' || r.is_total === true) return 'total'
  if (t === 'subtotal' || r.is_subtotal === true) return 'subtotal'
  return 'line'
}

function toLine(raw: unknown, index: number, depthHint: number): StatementLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const label = str(r.label ?? r.title ?? r.name ?? r.category)
  if (!label) return null
  const amount = amountOf(r, 'amount', 'current', 'value', 'total')
  const previous = amountOf(r, 'previous', 'previous_amount', 'comparison', 'prior')
  const kind = kindOf(r)
  const depth = typeof r.depth === 'number' ? r.depth : typeof r.level === 'number' ? r.level : typeof r.indent === 'number' ? r.indent : kind === 'line' ? depthHint : 0
  return {
    key: str(r.key ?? r.id) ?? `${index}-${label}`,
    label,
    kind,
    depth,
    amount,
    previous,
    change: str(r.change_pct ?? r.change_percent) ?? percentChange(amount, previous),
  }
}

/** Headings opened where a flat list's `section` changes (sections without one just flow on). */
const SECTION_HEADINGS: Record<string, string> = { revenue: 'Revenue', expenses: 'Operating expenses', other_income: 'Other income' }

function flatLines(data: unknown[]): StatementLine[] {
  const out: StatementLine[] = []
  let section: string | null = null
  data.forEach((raw, i) => {
    const line = toLine(raw, i, 0)
    if (!line) return
    const next = raw && typeof raw === 'object' ? str((raw as Record<string, unknown>).section) : null
    if (next !== null && next !== section) {
      section = next
      const heading = SECTION_HEADINGS[next]
      if (heading && line.kind !== 'heading') out.push({ key: `section-${next}`, label: heading, kind: 'heading', depth: 0, amount: null, previous: null, change: null })
    }
    out.push(line)
  })
  return out
}

function linesFrom(data: unknown): StatementLine[] {
  if (Array.isArray(data)) return flatLines(data)
  if (!data || typeof data !== 'object') return []
  const r = data as Record<string, unknown>
  if (Array.isArray(r.lines)) return linesFrom(r.lines)
  if (Array.isArray(r.rows)) return linesFrom(r.rows)
  if (Array.isArray(r.sections)) {
    const out: StatementLine[] = []
    r.sections.forEach((section, si) => {
      if (!section || typeof section !== 'object') return
      const s = section as Record<string, unknown>
      const lines = Array.isArray(s.lines) ? s.lines : Array.isArray(s.items) ? s.items : []
      const sectionLabel = str(s.label ?? s.title)
      const total = s.total && typeof s.total === 'object' ? toLine({ kind: 'subtotal', label: sectionLabel ? `Total ${sectionLabel.toLowerCase()}` : 'Total', ...(s.total as object) }, si, 0) : null
      if (lines.length === 0) {
        // A section without detail is a single figure (e.g. gross profit).
        const single = toLine({ ...s, kind: s.kind ?? (str(s.type) === 'total' ? 'total' : 'subtotal') }, si, 0)
        if (single) out.push(single)
        return
      }
      if (sectionLabel) out.push({ key: `section-${str(s.key) ?? si}`, label: sectionLabel, kind: 'heading', depth: 0, amount: null, previous: null, change: null })
      lines.forEach((l, li) => {
        const line = toLine(l, li, 1)
        if (line) out.push({ ...line, key: `${si}-${line.key}` })
      })
      if (total) out.push(total)
    })
    for (const k of ['net_profit', 'net_income']) {
      const v = r[k]
      if (v && typeof v === 'object') {
        const line = toLine({ kind: 'total', label: 'Net profit', ...(v as object) }, 999, 0)
        if (line) out.push(line)
      }
    }
    return out
  }
  return []
}

function range(v: unknown): { from: string; to: string } | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const from = str(r.date_from ?? r.from)
  const to = str(r.date_to ?? r.to)
  return from && to ? { from, to } : null
}

export function toStatement(run: ReportRun): Statement {
  const lines = linesFrom(run.raw)
  const data = run.raw && typeof run.raw === 'object' && !Array.isArray(run.raw) ? (run.raw as Record<string, unknown>) : {}
  const params = run.params
  const period = range(data.period) ?? range(params)
  const previousPeriod = range(data.previous_period ?? data.comparison_period) ?? range(run.meta.previous_period ?? run.meta.comparison_period ?? run.meta.comparison) ?? range(params.previous ?? params.comparison)
  return { lines, hasComparison: lines.some((l) => l.previous !== null), period, previousPeriod }
}

/** Accounting style: deductions in brackets, "(1,200.00)". */
export function statementAmount(value: string | null): string {
  if (value === null) return '—'
  const text = value.trim()
  return text.startsWith('-') && !/^-0*(\.0*)?$/.test(text) ? `(${formatMoney(text.slice(1))})` : formatMoney(text.replace(/^-/, ''))
}
