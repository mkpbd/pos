import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Pagination } from '@/lib/api/client'

/**
 * Phase 7 report registry (GET /reports) and report runs (GET /reports/{key}).
 *
 * The registry is the whitelist the UI (and later the AI assistant) renders from: each
 * definition names its params, columns, default sort and whether it has a totals row. The
 * server resolves scope (organization, accessible branches) and permissions; the UI only hides
 * what the server would refuse anyway. Normalizers below accept the few shapes a definition
 * may reasonably take (params as a list or a keyed map, Laravel-style rules), so the screen
 * does not break on cosmetic contract differences.
 */

export const REPORT_GROUPS = ['sales', 'inventory', 'purchasing', 'finance', 'customers'] as const
export type ReportGroup = (typeof REPORT_GROUPS)[number]

export const GROUP_LABELS: Record<ReportGroup, { title: string; description: string }> = {
  sales: { title: 'Sales', description: 'POS and online sales by day, month, product, category, branch and cashier.' },
  inventory: { title: 'Inventory', description: 'Stock value, movements, low stock and expiring batches.' },
  purchasing: { title: 'Purchasing', description: 'Goods received from suppliers and what is still owed to them.' },
  finance: { title: 'Finance', description: 'Profit and loss, tax, expenses and payments collected.' },
  customers: { title: 'Customers', description: 'Customer balances and how long they have been outstanding.' },
}

export type ColumnType = 'money' | 'quantity' | 'number' | 'percent' | 'date' | 'datetime' | 'text'

export type ReportColumn = {
  key: string
  label: string
  type: ColumnType
  /** Cost / profit figure: shown only with products.view_cost (the server omits it otherwise). */
  cost_sensitive: boolean
  sortable: boolean
}

export type ParamType = 'date' | 'id' | 'enum' | 'integer' | 'boolean' | 'string'

export type ParamOption = { value: string; label: string }

export type ReportParam = {
  key: string
  type: ParamType
  /** For `id` params: branch, store, product, category, brand, cashier, supplier or customer. */
  entity: string | null
  label: string
  required: boolean
  options: ParamOption[]
  default: string | null
  min: number | null
  max: number | null
}

export type ReportDefinition = {
  key: string
  title: string
  description: string | null
  group: ReportGroup
  permission: string | null
  params: ReportParam[]
  columns: ReportColumn[]
  /** e.g. "-net_sales" */
  default_sort: string | null
  has_totals: boolean
  /** P&L renders as a statement, not a table. */
  layout: 'table' | 'statement'
  /** False for reports that return every row at once (statements, short summaries). */
  paginated: boolean
  /** Cost-sensitive columns the server leaves out for this user. */
  omitted_columns: string[]
  /** Longest period the server accepts, in days (366 for daily rows, five years otherwise). */
  max_range_days: number | null
}

export type ReportRow = Record<string, unknown>

export type ReportRun = {
  rows: ReportRow[]
  pagination: Pagination | null
  totals: Record<string, unknown> | null
  /** Params as the server resolved them (organization timezone, defaults filled in). */
  params: Record<string, unknown>
  generated_at: string | null
  /** Column keys the server left out (cost-gated), when it says so. */
  omitted_columns: string[]
  /** Columns as the server sent them for this run, when it does (overrides the definition's). */
  columns: ReportColumn[] | null
  /** Column labels for this run (e.g. "Category" for a grouped column). */
  labels: Record<string, string>
  currency: string | null
  /** Raw `data` when it is not a list of rows (statement layouts). */
  raw: unknown
  meta: Record<string, unknown>
}

const COLUMN_TYPES: ColumnType[] = ['money', 'quantity', 'number', 'percent', 'date', 'datetime', 'text']

const titleCase = (key: string) => key.replace(/_id$/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

const KNOWN_PARAM_LABELS: Record<string, string> = {
  date_from: 'From',
  date_to: 'To',
  as_of: 'As of',
  branch_id: 'Branch',
  store_id: 'Store',
  product_id: 'Product',
  category_id: 'Category',
  brand_id: 'Brand',
  cashier_id: 'Cashier',
  supplier_id: 'Supplier',
  customer_id: 'Customer',
  channel: 'Channel',
  group_by: 'Group by',
}

const KNOWN_OPTIONS: Record<string, ParamOption[]> = {
  channel: [
    { value: 'all', label: 'All channels' },
    { value: 'pos', label: 'POS' },
    { value: 'online', label: 'Online' },
  ],
  group_by: [
    { value: 'day', label: 'Day' },
    { value: 'month', label: 'Month' },
  ],
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function normalizeOptions(raw: unknown, key: string): ParamOption[] {
  const known = KNOWN_OPTIONS[key]
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((o) => {
      if (typeof o === 'object' && o !== null) {
        const r = o as Record<string, unknown>
        const value = asString(r.value ?? r.id ?? r.key) ?? ''
        return { value, label: asString(r.label ?? r.name) ?? known?.find((k) => k.value === value)?.label ?? titleCase(value) }
      }
      const value = String(o)
      return { value, label: known?.find((k) => k.value === value)?.label ?? titleCase(value) }
    })
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>).map(([value, label]) => ({ value, label: asString(label) ?? value }))
  }
  return known ?? []
}

/** Laravel-style rules ("required|date", ["nullable", "in:pos,online"]) → partial spec. */
function fromRules(rules: unknown): Partial<Record<string, unknown>> {
  const list = Array.isArray(rules) ? rules.map(String) : typeof rules === 'string' ? rules.split('|') : []
  const spec: Record<string, unknown> = {}
  for (const rule of list) {
    const [name = '', arg = ''] = rule.split(':')
    if (name === 'required') spec.required = true
    else if (name === 'date' || name === 'date_format') spec.type = 'date'
    else if (name === 'uuid' || name === 'ulid') spec.type = 'id'
    else if (name === 'integer' || name === 'numeric') spec.type = 'integer'
    else if (name === 'boolean') spec.type = 'boolean'
    else if (name === 'in') {
      spec.type = 'enum'
      spec.options = arg.split(',')
    } else if (name === 'min') spec.min = arg
    else if (name === 'max') spec.max = arg
  }
  return spec
}

function inferType(key: string, declared: string | null): ParamType {
  const t = (declared ?? '').toLowerCase()
  if (t === 'date' || t === 'date_range') return 'date'
  if (t === 'uuid' || t === 'id' || t === 'ulid' || t === 'entity' || t === 'reference') return 'id'
  if (t === 'enum' || t === 'select' || t === 'in') return 'enum'
  if (t === 'integer' || t === 'int' || t === 'number' || t === 'numeric') return 'integer'
  if (t === 'boolean' || t === 'bool') return 'boolean'
  if (t === 'string' || t === 'text') return 'string'
  if (key.endsWith('_id')) return 'id'
  if (key.startsWith('date_') || key === 'as_of') return 'date'
  if (key in KNOWN_OPTIONS) return 'enum'
  return 'string'
}

function normalizeParam(key: string, raw: unknown): ReportParam {
  const spec: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(fromRules((raw as Record<string, unknown>).rules) as object), ...(raw as Record<string, unknown>) } : fromRules(raw)
  const options = normalizeOptions(spec.options ?? spec.values ?? spec.enum, key)
  let type = inferType(key, asString(spec.type))
  if (type === 'string' && options.length > 0) type = 'enum'
  const entity = asString(spec.entity) ?? (type === 'id' ? key.replace(/_id$/, '') : null)
  // Booleans travel as 1 / 0 (Laravel's boolean rule does not accept "true" / "false").
  const fallback = type === 'boolean' && typeof spec.default === 'boolean' ? (spec.default ? '1' : '0') : asString(spec.default)
  return {
    key,
    type,
    entity,
    label: asString(spec.label) ?? KNOWN_PARAM_LABELS[key] ?? titleCase(key),
    required: spec.required === true || spec.required === 'true',
    options: type === 'enum' ? options : options.length > 0 ? options : [],
    default: fallback,
    min: asNumber(spec.min),
    max: asNumber(spec.max),
  }
}

function normalizeParams(raw: unknown): ReportParam[] {
  if (Array.isArray(raw)) {
    return raw
      .map((p) => {
        if (typeof p === 'string') return normalizeParam(p, {})
        const r = (p ?? {}) as Record<string, unknown>
        const key = asString(r.key ?? r.name)
        return key ? normalizeParam(key, r) : null
      })
      .filter((p): p is ReportParam => p !== null)
  }
  if (raw && typeof raw === 'object') return Object.entries(raw as Record<string, unknown>).map(([key, spec]) => normalizeParam(key, spec))
  return []
}

function normalizeColumn(raw: unknown): ReportColumn | null {
  if (typeof raw === 'string') return { key: raw, label: titleCase(raw), type: 'text', cost_sensitive: false, sortable: true }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const key = asString(r.key ?? r.name)
  if (!key) return null
  const type = asString(r.type) as ColumnType | null
  return {
    key,
    label: asString(r.label ?? r.title) ?? titleCase(key),
    type: type && COLUMN_TYPES.includes(type) ? type : 'text',
    cost_sensitive: r.cost_sensitive === true,
    sortable: r.sortable !== false,
  }
}

function normalizeColumns(raw: unknown): ReportColumn[] {
  if (Array.isArray(raw)) return raw.map(normalizeColumn).filter((c): c is ReportColumn => c !== null)
  if (raw && typeof raw === 'object') return Object.entries(raw as Record<string, unknown>).map(([key, spec]) => normalizeColumn({ key, ...(spec as object) })).filter((c): c is ReportColumn => c !== null)
  return []
}

export function normalizeDefinition(raw: Record<string, unknown>): ReportDefinition {
  const key = asString(raw.key) ?? ''
  const group = asString(raw.group) as ReportGroup | null
  const totals = raw.totals ?? raw.has_totals ?? raw.totals_row
  const layout = asString(raw.layout ?? raw.format)
  return {
    key,
    title: asString(raw.title ?? raw.name) ?? titleCase(key),
    description: asString(raw.description),
    group: group && (REPORT_GROUPS as readonly string[]).includes(group) ? group : 'sales',
    permission: asString(raw.permission),
    params: normalizeParams(raw.params ?? raw.parameters),
    columns: normalizeColumns(raw.columns),
    default_sort: asString(raw.default_sort ?? raw.sort),
    has_totals: totals === true || (Array.isArray(totals) && totals.length > 0) || (typeof totals === 'object' && totals !== null && !Array.isArray(totals)),
    layout: layout === 'statement' || key === 'profit_and_loss' ? 'statement' : 'table',
    paginated: raw.paginated !== false,
    omitted_columns: Array.isArray(raw.omitted_columns) ? raw.omitted_columns.map(String) : [],
    max_range_days: asNumber(raw.max_range_days),
  }
}

function normalizeRun(res: { data: unknown; meta: Record<string, unknown> }): ReportRun {
  const meta = res.meta ?? {}
  const omitted = meta.omitted_columns ?? meta.hidden_columns ?? meta.redacted_columns
  const columns = meta.columns ? normalizeColumns(meta.columns) : null
  const labels = meta.labels && typeof meta.labels === 'object' && !Array.isArray(meta.labels) ? (meta.labels as Record<string, unknown>) : {}
  return {
    rows: Array.isArray(res.data) ? (res.data as ReportRow[]) : Array.isArray((res.data as Record<string, unknown> | null)?.rows) ? ((res.data as Record<string, unknown>).rows as ReportRow[]) : [],
    pagination: (meta.pagination as Pagination | undefined) ?? null,
    totals: (meta.totals as Record<string, unknown> | null | undefined) ?? null,
    params: (meta.params as Record<string, unknown> | undefined) ?? {},
    generated_at: asString(meta.generated_at),
    omitted_columns: Array.isArray(omitted) ? omitted.map(String) : [],
    columns: columns && columns.length > 0 ? columns : null,
    labels: Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    currency: asString(meta.currency ?? (meta.params as Record<string, unknown> | undefined)?.currency),
    raw: res.data,
    meta,
  }
}

export const reportKeys = {
  all: ['reports'] as const,
  registry: ['reports', 'registry'] as const,
  run: (key: string, query: Record<string, string>) => ['reports', 'run', key, query] as const,
}

export function useReportRegistryQuery(enabled = true) {
  return useQuery({
    queryKey: reportKeys.registry,
    queryFn: ({ signal }) => api.get<Record<string, unknown>[]>('/reports', { signal }).then((r) => (Array.isArray(r.data) ? r.data.map(normalizeDefinition) : [])),
    staleTime: 5 * 60_000,
    enabled,
  })
}

/** Runs one report; `query` is exactly what the URL holds (and what the export repeats). */
export function useReportRunQuery(key: string, query: Record<string, string>, enabled = true) {
  return useQuery<ReportRun>({
    queryKey: reportKeys.run(key, query),
    queryFn: ({ signal }) => api.get<unknown>(`/reports/${encodeURIComponent(key)}`, { signal, query }).then((r) => normalizeRun({ data: r.data, meta: r.meta as Record<string, unknown> })),
    placeholderData: keepPreviousData,
    enabled,
  })
}
