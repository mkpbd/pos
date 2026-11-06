import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import type { CurrentUser } from '@/features/auth/types'
import { normalizeColumns, type ReportColumn, type ReportRow } from '@/features/reports/api'

/**
 * Phase 8 (AI1): Ask AI, business insights, customer insights, reorder explanations and the
 * organization's AI settings. AI is optional: with it off the ask / explain endpoints answer
 * 503 AI_UNAVAILABLE while the insight endpoints still return their deterministic facts with
 * `narrative: null`. Numbers are decimal strings computed by the server; the client only
 * formats them. Normalizers accept a few reasonable shapes so cosmetic contract differences
 * do not break the page.
 */

export const AI_PERMISSIONS = {
  ask: 'ai.ask',
  insights: 'ai.insights',
  manage: 'ai.manage',
} as const

/** The sidebar entry and route: either permission opens the AI Insights page. */
export const AI_PAGE_PERMISSIONS = [AI_PERMISSIONS.insights, AI_PERMISSIONS.ask]

export const MAX_QUESTION_LENGTH = 1000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const nameOf = (v: unknown): string | null => (isObj(v) ? str(v.name ?? v.label ?? v.title ?? v.product_name) : str(v))
const titleCase = (key: string) => key.replace(/_id$/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const range = (v: unknown): { from: string; to: string } | null => {
  if (!isObj(v)) return null
  const from = str(v.from ?? v.date_from ?? v.start)
  const to = str(v.to ?? v.date_to ?? v.end)
  return from && to ? { from, to } : null
}

/** Whether AI is on for the user's organization (bootstrap flag). Unknown counts as on: the API decides. */
export function aiEnabledFor(me: CurrentUser): boolean {
  const flag = me.ai_enabled ?? me.organization?.ai_enabled
  return flag !== false
}

// ---------------------------------------------------------------- usage

export type TokenUsage = { input_tokens: number; output_tokens: number }

function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!isObj(raw)) return null
  const input = num(raw.input_tokens ?? raw.input)
  const output = num(raw.output_tokens ?? raw.output)
  if (input === null && output === null) return null
  return { input_tokens: input ?? 0, output_tokens: output ?? 0 }
}

// ---------------------------------------------------------------- ask

export type AnswerReport = {
  key: string
  title: string
  params: Record<string, unknown>
  columns: ReportColumn[]
  rows: ReportRow[]
  totals: Record<string, unknown> | null
  /** SPA path of the full report, e.g. "/reports/sales_daily?date_from=…". */
  link: string | null
  /** Rows the full report has, when the server says (the answer carries at most 50). */
  total_rows: number | null
}

/** `ok: false` = the server rejected the call (e.g. a branch outside the user's scope); it never ran. */
export type ToolUse = { name: string; params: Record<string, unknown>; ok: boolean }

export type AskAnswer = {
  answer: string
  report: AnswerReport | null
  tools_used: ToolUse[]
  usage: TokenUsage | null
  /** The model hit its output limit; the answer may be cut short. */
  truncated: boolean
}

export type AskInput = { question: string; branch_id?: string | null }

/** Only same-app relative report paths become links ("/reports/…"); anything else is dropped. */
export function safeReportLink(raw: unknown): string | null {
  const link = str(raw)
  if (!link) return null
  const path = link.replace(/^\/admin(?=\/)/, '')
  return /^\/reports\/[a-z0-9_]+(\?[^\s<>"'`]*)?$/i.test(path) ? path : null
}

function normalizeReport(raw: unknown): AnswerReport | null {
  if (!isObj(raw)) return null
  const key = str(raw.key)
  if (!key) return null
  const rows = list(raw.rows ?? raw.data).filter(isObj)
  return {
    key,
    title: str(raw.title ?? raw.name) ?? titleCase(key),
    params: isObj(raw.params) ? raw.params : {},
    // The answer table is a snapshot: no server-side sorting here.
    columns: normalizeColumns(raw.columns).map((c) => ({ ...c, sortable: false })),
    rows,
    totals: isObj(raw.totals) && Object.keys(raw.totals).length > 0 ? raw.totals : null,
    link: safeReportLink(raw.link ?? raw.url),
    total_rows: num(raw.total_rows ?? raw.total ?? (isObj(raw.pagination) ? raw.pagination.total : undefined)),
  }
}

export function normalizeAnswer(raw: unknown): AskAnswer {
  const r = isObj(raw) ? raw : {}
  return {
    answer: str(r.answer ?? r.text ?? r.narrative) ?? '',
    report: normalizeReport(r.report),
    tools_used: list(r.tools_used ?? r.tools)
      .map((t) => (isObj(t) ? { name: str(t.name ?? t.tool) ?? 'tool', params: isObj(t.params ?? t.input) ? ((t.params ?? t.input) as Obj) : {}, ok: t.ok !== false } : typeof t === 'string' ? { name: t, params: {}, ok: true } : null))
      .filter((t): t is ToolUse => t !== null),
    usage: normalizeUsage(r.usage),
    truncated: r.truncated === true,
  }
}

export function useAskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AskInput) =>
      api.post<unknown>('/ai/ask', { question: input.question, ...(input.branch_id ? { branch_id: input.branch_id } : {}) }).then((r) => normalizeAnswer(r.data)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiKeys.usage }),
  })
}

// ---------------------------------------------------------------- explain reorder

export type ReorderExplanation = { narrative: string; usage: TokenUsage | null; generated_at: string | null }

export function useExplainReorderMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (storeId: string) =>
      api.post<unknown>('/ai/explain-reorder', { store_id: storeId }).then((r): ReorderExplanation => {
        const d = isObj(r.data) ? r.data : {}
        return { narrative: str(d.narrative ?? d.answer ?? d.explanation) ?? '', usage: normalizeUsage(d.usage), generated_at: str(d.generated_at) }
      }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiKeys.usage }),
  })
}

// ---------------------------------------------------------------- business insights

export type InsightPeriod = 'daily' | 'monthly'

/** Why a narrative is missing: disabled (AI off), unavailable, budget_exceeded, refused, empty. */
export type NarrativeStatus = 'ok' | 'disabled' | 'unavailable' | 'budget_exceeded' | 'refused' | 'empty' | (string & {})

export type InsightKpi = {
  key: string
  label: string
  kind: 'money' | 'count' | 'percent'
  value: string | null
  previous: string | null
  /** Percent change vs the previous period, as the server computed it (null when the previous figure is zero). */
  change: string | null
  /** An increase is bad news (returns). */
  inverse: boolean
}

export type InsightMover = { key: string; name: string; direction: 'up' | 'down'; net_sales: string | null; previous: string | null; change_pct: string | null }

export type InsightAnomaly = { date: string; net_sales: string | null; mean: string | null; z_score: string | null; direction: 'high' | 'low' }

/** A flagged margin drop or return spike; `value` / `previous` are percentages. */
export type InsightSignal = { key: string; kind: 'margin' | 'returns'; label: string; value: string | null; previous: string | null; amount: string | null }

export type SlowMover = { key: string; name: string; on_hand: string | null; stock_value: string | null; variants_in_stock: number | null }

export type ShortageRisk = { key: string; name: string; sku: string | null; store: string | null; on_hand: string | null; days_of_cover: string | null; lead_time_days: number | null; suggested_purchase: string | null; supplier: string | null }

export type InsightFacts = {
  period: InsightPeriod
  range: { from: string; to: string } | null
  previousRange: { from: string; to: string } | null
  currency: string | null
  kpis: InsightKpi[]
  topMovers: InsightMover[]
  anomalies: InsightAnomaly[]
  signals: InsightSignal[]
  slowMovers: { days: number; count: number; items: SlowMover[] }
  /** Null without purchases.view (the server leaves it out). */
  shortageRisk: { count: number; items: ShortageRisk[] } | null
}

export type Insights = {
  facts: InsightFacts
  narrative: string | null
  narrativeStatus: NarrativeStatus | null
  /** Whether AI is on for the organization (narratives possible). */
  aiEnabled: boolean | null
  generatedAt: string | null
}

const KPI_LABELS: Record<string, { label: string; kind: InsightKpi['kind']; inverse?: boolean }> = {
  net_sales: { label: 'Net sales', kind: 'money' },
  orders: { label: 'Orders', kind: 'count' },
  average_ticket: { label: 'Average ticket', kind: 'money' },
  gross_sales: { label: 'Gross sales', kind: 'money' },
  returns: { label: 'Returns', kind: 'money', inverse: true },
  gross_profit: { label: 'Gross profit', kind: 'money' },
  margin: { label: 'Gross margin', kind: 'percent' },
}

function normalizeKpi(key: string, raw: unknown): InsightKpi {
  const r = isObj(raw) ? raw : { value: raw }
  const known = KPI_LABELS[key]
  const kind: InsightKpi['kind'] = known?.kind ?? (/(_pct|_rate|margin)$/.test(key) ? 'percent' : typeof r.value === 'number' ? 'count' : 'money')
  return {
    key,
    label: str(r.label) ?? known?.label ?? titleCase(key),
    kind,
    value: str(r.value),
    previous: str(r.previous),
    // `change` is the absolute difference; only the percentage is shown as a change.
    change: str(r.change_pct),
    inverse: known?.inverse ?? /return/.test(key),
  }
}

function normalizeKpis(raw: unknown): InsightKpi[] {
  if (Array.isArray(raw)) return raw.filter(isObj).map((k) => normalizeKpi(str(k.key) ?? 'kpi', k))
  if (isObj(raw)) return Object.entries(raw).map(([key, v]) => normalizeKpi(key, v))
  return []
}

const productName = (r: Obj): string => nameOf(r.product ?? r.name ?? r.product_name) ?? 'Unnamed item'

function normalizeMovers(raw: unknown): InsightMover[] {
  const groups: [InsightMover['direction'], unknown][] = isObj(raw) ? [['up', raw.up], ['down', raw.down]] : [['up', raw]]
  return groups.flatMap(([direction, rows]) =>
    list(rows).filter(isObj).map((r, i) => ({
      key: `${direction}-${str(r.product_id) ?? i}`,
      name: productName(r),
      direction,
      net_sales: str(r.net_sales),
      previous: str(r.previous),
      change_pct: str(r.change_pct),
    })),
  )
}

function normalizeAnomaly(r: Obj): InsightAnomaly | null {
  const date = str(r.date)
  if (!date) return null
  const z = str(r.z_score)
  const direction = str(r.direction)
  return {
    date,
    net_sales: str(r.value ?? r.net_sales),
    mean: str(r.mean),
    z_score: z,
    direction: direction === 'drop' || direction === 'low' || (!direction && !!z?.startsWith('-')) ? 'low' : 'high',
  }
}

function normalizeSignals(f: Obj): InsightSignal[] {
  const signals: InsightSignal[] = []
  const margin = f.margin_drop
  if (isObj(margin) && margin.flagged === true) {
    const points = str(margin.change_points)
    signals.push({ key: 'margin', kind: 'margin', label: points ? `Gross margin fell ${points.replace(/^-/, '')} points` : 'Gross margin fell', value: str(margin.current), previous: str(margin.previous), amount: null })
  }
  const returns = f.return_spike
  if (isObj(returns) && returns.flagged === true) {
    signals.push({ key: 'returns', kind: 'returns', label: 'Returns jumped', value: str(returns.rate), previous: str(returns.previous_rate), amount: str(returns.returns) })
  }
  return signals
}

function normalizeSlowMovers(raw: unknown): InsightFacts['slowMovers'] {
  const r = isObj(raw) ? raw : { items: raw }
  const items = list(r.items).filter(isObj).map((row, i): SlowMover => ({
    key: str(row.product_id) ?? String(i),
    name: productName(row),
    on_hand: str(row.on_hand),
    stock_value: str(row.stock_value),
    variants_in_stock: num(row.variants_in_stock),
  }))
  return { days: num(r.days) ?? 30, count: num(r.count) ?? items.length, items }
}

function normalizeShortage(raw: unknown): InsightFacts['shortageRisk'] {
  if (raw === null || raw === undefined) return null
  const r = isObj(raw) ? raw : { items: raw }
  const items = list(r.items).filter(isObj).map((row, i): ShortageRisk => ({
    key: `${str(row.variant_id ?? row.sku) ?? i}-${str(row.store_id) ?? ''}`,
    name: productName(row),
    sku: str(row.sku),
    store: nameOf(row.store),
    on_hand: str(row.on_hand),
    days_of_cover: str(row.days_of_cover),
    lead_time_days: num(row.lead_time_days),
    suggested_purchase: str(row.suggested_purchase),
    supplier: nameOf(row.supplier),
  }))
  return { count: num(r.count) ?? items.length, items }
}

/** GET /ai/insights: `{facts, narrative, narrative_status, ai_enabled, generated_at, cached}`. */
export function normalizeInsights(raw: unknown, meta: Obj = {}): Insights {
  const d = isObj(raw) ? raw : {}
  const f = isObj(d.facts) ? d.facts : {}
  const facts: InsightFacts = {
    period: str(f.period) === 'monthly' ? 'monthly' : 'daily',
    range: range({ from: f.date_from, to: f.date_to }),
    previousRange: range({ from: f.previous_from, to: f.previous_to }),
    currency: str(f.currency ?? meta.currency),
    kpis: normalizeKpis(f.kpis),
    topMovers: normalizeMovers(f.top_movers),
    anomalies: list(f.anomalies).filter(isObj).map(normalizeAnomaly).filter((a): a is InsightAnomaly => a !== null),
    signals: normalizeSignals(f),
    slowMovers: normalizeSlowMovers(f.slow_movers),
    shortageRisk: normalizeShortage(f.shortage_risk),
  }
  return {
    facts,
    narrative: str(d.narrative),
    narrativeStatus: str(d.narrative_status),
    aiEnabled: typeof d.ai_enabled === 'boolean' ? d.ai_enabled : null,
    generatedAt: str(d.generated_at ?? meta.generated_at),
  }
}

export const aiKeys = {
  all: ['ai'] as const,
  insights: (period: InsightPeriod, branchId: string | null) => ['ai', 'insights', period, branchId] as const,
  customers: (branchId: string | null) => ['ai', 'customer-insights', branchId] as const,
  settings: ['ai', 'settings'] as const,
  usage: ['ai', 'usage'] as const,
}

export function useInsightsQuery(period: InsightPeriod, branchId: string | null, enabled = true) {
  return useQuery({
    queryKey: aiKeys.insights(period, branchId),
    queryFn: ({ signal }) => api.get<unknown>('/ai/insights', { signal, query: { period, branch_id: branchId } }).then((r) => normalizeInsights(r.data, r.meta as Obj)),
    staleTime: 5 * 60_000,
    enabled,
  })
}

// ---------------------------------------------------------------- customer insights

export const SEGMENT_KEYS = ['champions', 'loyal', 'potential', 'new', 'at_risk', 'hibernating'] as const

export const SEGMENT_INFO: Record<string, { label: string; description: string }> = {
  champions: { label: 'Champions', description: 'Bought recently, buy often and spend the most.' },
  loyal: { label: 'Loyal', description: 'Buy regularly and spend well.' },
  potential: { label: 'Potential', description: 'Recent customers with room to buy more often.' },
  new: { label: 'New', description: 'First purchase was recent.' },
  at_risk: { label: 'At risk', description: 'Used to buy often but have not come back lately.' },
  hibernating: { label: 'Hibernating', description: 'Low spend and a long time since their last purchase.' },
}

export type CustomerSegment = { key: string; label: string; description: string | null; count: number; monetary: string | null }

export type MaskedCustomer = {
  key: string
  segment: string
  /** Null without customers.view (the server leaves names out). */
  name: string | null
  /** Last digits of the phone only (least data), e.g. "•••• 123". */
  phone_hint: string | null
  orders: number | null
  spend: string | null
  last_purchase_at: string | null
  recency_days: number | null
}

export type LoyaltySuggestion = { key: string; segment: string | null; text: string; count: number | null }

export type CustomerInsights = {
  segments: CustomerSegment[]
  topCustomers: MaskedCustomer[]
  suggestions: LoyaltySuggestion[]
  narrative: string | null
  narrativeStatus: NarrativeStatus | null
  aiEnabled: boolean | null
  range: { from: string; to: string } | null
  totalCustomers: number | null
  currency: string | null
  generatedAt: string | null
}

const segmentKey = (v: unknown) => (str(v) ?? '').toLowerCase().replace(/[\s-]+/g, '_')

function phoneHint(r: Obj): string | null {
  const last = str(r.phone_last3 ?? r.phone_last_digits ?? r.phone_suffix)
  if (last) return `•••${last.replace(/\D/g, '').slice(-3)}`
  const masked = str(r.phone_masked ?? r.masked_phone ?? r.phone_hint ?? r.contact)
  // A masked value from the server is shown as is, but never more than its last three digits.
  if (masked) {
    const digits = masked.replace(/\D/g, '')
    return digits.length > 0 ? `•••${digits.slice(-3)}` : null
  }
  return null
}

function normalizeCustomer(r: Obj, i: number, segment: string | null): MaskedCustomer {
  return {
    key: `${str(r.customer_id ?? r.id) ?? i}-${segment ?? ''}`,
    segment: segmentKey(r.segment ?? segment),
    name: nameOf(r.name ?? r.customer),
    phone_hint: phoneHint(r),
    orders: num(r.frequency ?? r.orders ?? r.orders_count),
    spend: str(r.monetary ?? r.spend ?? r.total_spent ?? r.net_sales),
    last_purchase_at: str(r.last_purchase_at ?? r.last_purchase_on ?? r.last_order_at),
    recency_days: num(r.recency_days ?? r.recency),
  }
}

export function normalizeCustomerInsights(raw: unknown, meta: Obj = {}): CustomerInsights {
  const d = isObj(raw) ? raw : {}
  const f = isObj(d.facts) ? { ...d, ...d.facts } : d
  const segmentsRaw = f.segments
  const segmentEntries: [string, unknown][] = Array.isArray(segmentsRaw)
    ? segmentsRaw.filter(isObj).map((s) => [segmentKey(s.key ?? s.segment ?? s.name), s])
    : isObj(segmentsRaw)
      ? Object.entries(segmentsRaw).map(([k, v]) => [segmentKey(k), v])
      : []
  const segments: CustomerSegment[] = segmentEntries.map(([key, v]) => {
    const s = isObj(v) ? v : { count: v }
    return {
      key,
      label: str(s.label) ?? SEGMENT_INFO[key]?.label ?? titleCase(key),
      description: str(s.description) ?? SEGMENT_INFO[key]?.description ?? null,
      count: num(s.count ?? s.customers) ?? 0,
      monetary: str(s.monetary ?? s.spend ?? s.net_sales),
    }
  })
  // Keep the canonical order (best customers first) whatever order the server used.
  segments.sort((a, b) => order(a.key) - order(b.key))

  const topRaw = f.top_customers ?? f.customers
  const topCustomers: MaskedCustomer[] = Array.isArray(topRaw)
    ? topRaw.filter(isObj).map((r, i) => normalizeCustomer(r, i, null))
    : isObj(topRaw)
      ? Object.entries(topRaw).flatMap(([seg, rows]) => list(rows).filter(isObj).map((r, i) => normalizeCustomer(r, i, seg)))
      : segmentEntries.flatMap(([seg, v]) => (isObj(v) ? list(v.top_customers ?? v.customers).filter(isObj).map((r, i) => normalizeCustomer(r, i, seg)) : []))

  const suggestions: LoyaltySuggestion[] = list(f.suggestions ?? f.loyalty_suggestions)
    .map((s, i): LoyaltySuggestion | null => {
      if (typeof s === 'string') return { key: String(i), segment: null, text: s, count: null }
      if (!isObj(s)) return null
      const text = str(s.text ?? s.message ?? s.suggestion ?? s.title)
      return text ? { key: str(s.key ?? s.code) ?? String(i), segment: s.segment ? segmentKey(s.segment) : null, text, count: num(s.count ?? s.customers) } : null
    })
    .filter((s): s is LoyaltySuggestion => s !== null)

  return {
    segments,
    topCustomers,
    suggestions,
    narrative: str(d.narrative),
    narrativeStatus: str(d.narrative_status),
    aiEnabled: typeof d.ai_enabled === 'boolean' ? d.ai_enabled : null,
    range: range(f.range ?? f.period),
    totalCustomers: num(f.customers_analyzed ?? f.total_customers),
    currency: str(f.currency ?? meta.currency),
    generatedAt: str(d.generated_at ?? meta.generated_at),
  }
}

function order(key: string): number {
  const i = (SEGMENT_KEYS as readonly string[]).indexOf(key)
  return i === -1 ? SEGMENT_KEYS.length : i
}

export function useCustomerInsightsQuery(branchId: string | null, enabled = true) {
  return useQuery({
    queryKey: aiKeys.customers(branchId),
    queryFn: ({ signal }) => api.get<unknown>('/ai/customer-insights', { signal, query: { branch_id: branchId } }).then((r) => normalizeCustomerInsights(r.data, r.meta as Obj)),
    staleTime: 5 * 60_000,
    enabled,
  })
}

// ---------------------------------------------------------------- settings and usage

export type AiSettings = {
  enabled: boolean
  /** Null: the application default applies. 0 means unlimited. */
  monthly_token_budget: number | null
  /** The application default budget (AI_MONTHLY_TOKEN_BUDGET), when the server says. */
  default_monthly_token_budget: number | null
  data_sharing_level: string
  /** False when AI is switched off for the whole application (AI_ENABLED) — the org switch then has no effect. */
  available: boolean
}

export type AiSettingsInput = { enabled: boolean; monthly_token_budget: number | null }

export function normalizeSettings(raw: unknown): AiSettings {
  const d = isObj(raw) ? raw : {}
  return {
    enabled: d.enabled === true,
    monthly_token_budget: num(d.monthly_token_budget),
    default_monthly_token_budget: num(d.default_monthly_token_budget ?? d.default_budget),
    data_sharing_level: str(d.data_sharing_level) ?? 'aggregates',
    // AI_ENABLED and a configured provider are both needed for the organization switch to matter.
    available: d.available !== false && d.app_enabled !== false && d.provider_configured !== false,
  }
}

export type FeatureUsage = { feature: string; requests: number; tokens: number }

export type AiUsage = {
  month: string | null
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  /** Effective budget for the month; 0 or null = unlimited. */
  budget: number | null
  by_feature: FeatureUsage[]
}

export function normalizeUsageReport(raw: unknown): AiUsage {
  const d = isObj(raw) ? raw : {}
  const tokens = isObj(d.tokens) ? d.tokens : d
  const input = num(tokens.input_tokens ?? tokens.input) ?? 0
  const output = num(tokens.output_tokens ?? tokens.output) ?? 0
  const byRaw = d.by_feature ?? d.features
  const entries: [string, unknown][] = Array.isArray(byRaw) ? byRaw.filter(isObj).map((f) => [str(f.feature ?? f.key ?? f.name) ?? 'other', f]) : isObj(byRaw) ? Object.entries(byRaw) : []
  return {
    month: str(d.month ?? d.period),
    requests: num(d.requests ?? d.request_count) ?? 0,
    input_tokens: input,
    output_tokens: output,
    total_tokens: num(tokens.total_tokens ?? tokens.total ?? d.used_tokens ?? d.tokens_used) ?? input + output,
    budget: num(d.budget ?? d.monthly_token_budget ?? d.token_budget),
    by_feature: entries.map(([feature, v]) => {
      const f = isObj(v) ? v : {}
      const fIn = num(f.input_tokens) ?? 0
      const fOut = num(f.output_tokens) ?? 0
      return { feature, requests: num(f.requests ?? f.count) ?? 0, tokens: num(f.tokens ?? f.total_tokens) ?? fIn + fOut }
    }),
  }
}

export const FEATURE_LABELS: Record<string, string> = {
  ask: 'Ask AI',
  explain_reorder: 'Reorder explanations',
  insights: 'Business insights',
  daily_insights: 'Daily insights',
  customer_insights: 'Customer insights',
}

export function useAiSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: aiKeys.settings,
    queryFn: ({ signal }) => api.get<unknown>('/ai/settings', { signal }).then((r) => normalizeSettings(r.data)),
    enabled,
  })
}

export function useUpdateAiSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AiSettingsInput) => api.patch<unknown>('/ai/settings', input).then((r) => normalizeSettings(r.data)),
    onSuccess: (settings) => {
      queryClient.setQueryData(aiKeys.settings, settings)
      // ai_enabled in the session payload, cached insights (narratives) and usage follow the switch.
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      void queryClient.invalidateQueries({ queryKey: aiKeys.all })
    },
  })
}

export function useAiUsageQuery(enabled = true) {
  return useQuery({
    queryKey: aiKeys.usage,
    queryFn: ({ signal }) => api.get<unknown>('/ai/usage', { signal }).then((r) => normalizeUsageReport(r.data)),
    enabled,
  })
}

// ---------------------------------------------------------------- errors

export type AiErrorInfo = { kind: 'unavailable' | 'budget' | 'rate' | 'validation' | 'other'; title: string; message: string }

/** Plain-language explanation of an AI request failure. */
export function describeAiError(error: unknown): AiErrorInfo {
  if (error instanceof ApiError) {
    if (error.code === 'AI_UNAVAILABLE' || error.status === 503) {
      return {
        kind: 'unavailable',
        title: 'The AI assistant is unavailable',
        message: 'AI is turned off for your organization or the AI service cannot be reached right now. Reports, the dashboard and everything else keep working.',
      }
    }
    if (error.code === 'AI_BUDGET_EXCEEDED') {
      return {
        kind: 'budget',
        title: 'Monthly AI budget used up',
        message: 'Your organization has used its AI token budget for this month. An administrator can raise it under Organization → AI assistant, or it resets next month.',
      }
    }
    if (error.status === 429) {
      return { kind: 'rate', title: 'Too many questions at once', message: 'Please wait a minute before asking again.' }
    }
    if (error.code === 'VALIDATION_FAILED') {
      const first = Object.values(error.fieldErrors)[0]?.[0]
      return { kind: 'validation', title: 'Check your question', message: first ?? error.message }
    }
    return { kind: 'other', title: 'Something went wrong', message: error.message }
  }
  return { kind: 'other', title: 'Something went wrong', message: error instanceof Error ? error.message : 'An unexpected error occurred.' }
}
