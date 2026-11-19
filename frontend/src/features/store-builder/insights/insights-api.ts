import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

/*
 * B15 "know what works": the admin insights API (storefront.view).
 *  - GET /storefront/builder/documents/{id}/insights?from=&to=&device= — one page's figures;
 *  - GET /storefront/builder/insights?from=&to= — a short summary per page for the Pages list.
 * Days are store-local Y-m-d dates; money is a NUMERIC string. Rates (conversion, view / click
 * rate, reach, average scroll) are percentage strings 0–100 ("3.10"), null when there is nothing
 * to divide by; LCP / INP are ms, CLS a "0.050" string. The device filter is left out for all
 * devices. The readers keep the panel working when a field is missing (a new page has no figures).
 */

export type InsightsDevice = 'all' | 'desktop' | 'tablet' | 'mobile'
export type VitalRating = 'good' | 'needs_improvement' | 'poor'
export type VitalKey = 'lcp' | 'cls' | 'inp'

export type InsightsRange = { from: string; to: string; device: InsightsDevice }

export type InsightsVitals = {
  /** Milliseconds (75th percentile); null = not enough visits measured. */
  lcp_p75: number | null
  cls_p75: number | null
  inp_p75: number | null
  rating: Record<VitalKey, VitalRating | null>
}

export type InsightsTotals = {
  views: number
  unique_visitors: number
  /** How far people scrolled on average, 0–100; null without views. */
  avg_scroll: number | null
  clicks: number
  orders: number
  /** NUMERIC string. */
  revenue: string
  /** Orders per 100 different visitors; null without visitors. */
  conversion: number | null
  vitals: InsightsVitals
}

export type InsightsDay = { day: string; views: number; unique_visitors: number; orders: number; revenue: string }

export type InsightsSection = {
  node_id: string
  label: string
  type: string
  views: number
  /** Share of page views in which this section was seen, 0–100. */
  view_rate: number | null
  clicks: number
  click_rate: number | null
  orders: number
  revenue: string
  /** Share of page views that scrolled down to it, 0–100 (never grows down the page). */
  reach: number | null
  /** false: the section is no longer on the live page ("Removed section"). */
  live: boolean
}

/** One heat map cell: column 0–19, row 0–19 inside the section, clicks. */
export type HeatCell = [cx: number, cy: number, clicks: number]

export type DocumentInsights = {
  totals: InsightsTotals
  daily: InsightsDay[]
  sections: InsightsSection[]
  heat: Record<string, HeatCell[]>
  versions: { number: number; published_at: string }[]
  currency: string | null
  /** The store's timezone (days are store-local). */
  timezone: string | null
}

export type PageInsightsSummary = { document_id: string; views: number; unique_visitors: number; orders: number; revenue: string; conversion: number | null }

/* ------------------------------------------------------------------------------- readers ----- */

type Raw = Record<string, unknown>
const obj = (value: unknown): Raw => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {})

/** A count (numbers or numeric strings); anything else is 0. */
export function count(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/** A measurement or percentage; null when absent or not a number. */
export function measure(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

const money = (value: unknown): string => (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '0')

const RATINGS: readonly VitalRating[] = ['good', 'needs_improvement', 'poor']

/** Google's Core Web Vitals limits (good up to, needs improvement up to). */
export const VITAL_LIMITS: Record<VitalKey, [number, number]> = { lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500] }

export function rateVital(key: VitalKey, value: number | null): VitalRating | null {
  if (value === null) return null
  const [good, fair] = VITAL_LIMITS[key]
  return value <= good ? 'good' : value <= fair ? 'needs_improvement' : 'poor'
}

function readVitals(value: unknown): InsightsVitals {
  const raw = obj(value)
  const rating = obj(raw.rating)
  const values = { lcp: measure(raw.lcp_p75), cls: measure(raw.cls_p75), inp: measure(raw.inp_p75) }
  const pick = (key: VitalKey): VitalRating | null => {
    const given = rating[key] ?? raw[`${key}_rating`]
    return RATINGS.includes(given as VitalRating) ? (given as VitalRating) : rateVital(key, values[key])
  }
  return { lcp_p75: values.lcp, cls_p75: values.cls, inp_p75: values.inp, rating: { lcp: pick('lcp'), cls: pick('cls'), inp: pick('inp') } }
}

function readTotals(value: unknown): InsightsTotals {
  const raw = obj(value)
  return {
    views: count(raw.views),
    unique_visitors: count(raw.unique_visitors),
    avg_scroll: measure(raw.avg_scroll),
    clicks: count(raw.clicks),
    orders: count(raw.orders),
    revenue: money(raw.revenue),
    conversion: measure(raw.conversion),
    vitals: readVitals(raw.vitals),
  }
}

function readHeat(value: unknown): Record<string, HeatCell[]> {
  const out: Record<string, HeatCell[]> = {}
  for (const [nodeId, cells] of Object.entries(obj(value))) {
    if (!Array.isArray(cells)) continue
    const list: HeatCell[] = []
    for (const cell of cells) {
      if (!Array.isArray(cell) || cell.length < 3) continue
      const [cx, cy, clicks] = [Number(cell[0]), Number(cell[1]), count(cell[2])]
      if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cx > 19 || cy < 0 || cy > 19 || clicks <= 0) continue
      list.push([cx, cy, clicks])
    }
    if (list.length > 0) out[nodeId] = list
  }
  return out
}

export function readDocumentInsights(value: unknown): DocumentInsights {
  const raw = obj(value)
  const daily = Array.isArray(raw.daily) ? raw.daily : []
  const sections = Array.isArray(raw.sections) ? raw.sections : []
  const versions = Array.isArray(raw.versions) ? raw.versions : []
  return {
    totals: readTotals(raw.totals),
    daily: daily
      .map(obj)
      .filter((d) => typeof d.day === 'string')
      .map((d) => ({ day: d.day as string, views: count(d.views), unique_visitors: count(d.unique_visitors), orders: count(d.orders), revenue: money(d.revenue) })),
    sections: sections
      .map(obj)
      .filter((s) => typeof s.node_id === 'string')
      .map((s) => ({
        node_id: s.node_id as string,
        label: typeof s.label === 'string' ? s.label : '',
        type: typeof s.type === 'string' ? s.type : 'section',
        views: count(s.views),
        view_rate: measure(s.view_rate),
        clicks: count(s.clicks),
        click_rate: measure(s.click_rate),
        orders: count(s.orders),
        revenue: money(s.revenue),
        reach: measure(s.reach),
        live: s.live !== false,
      })),
    heat: readHeat(raw.heat),
    versions: versions
      .map(obj)
      .filter((v) => typeof v.published_at === 'string' && Number.isFinite(Number(v.number)))
      .map((v) => ({ number: Number(v.number), published_at: v.published_at as string })),
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : null,
  }
}

export function readInsightsSummary(value: unknown): Record<string, PageInsightsSummary> {
  const list = Array.isArray(value) ? value : Array.isArray(obj(value).documents) ? (obj(value).documents as unknown[]) : []
  const out: Record<string, PageInsightsSummary> = {}
  for (const item of list.map(obj)) {
    const id = typeof item.document_id === 'string' ? item.document_id : typeof item.id === 'string' ? item.id : null
    if (!id) continue
    out[id] = { document_id: id, views: count(item.views), unique_visitors: count(item.unique_visitors), orders: count(item.orders), revenue: money(item.revenue), conversion: measure(item.conversion) }
  }
  return out
}

/* ------------------------------------------------------------------------------- requests ---- */

const BASE = '/storefront/builder'

export const insightsKeys = {
  all: ['store-builder', 'insights'] as const,
  document: (id: string, range: InsightsRange) => ['store-builder', 'insights', 'document', id, range.from, range.to, range.device] as const,
  summary: (from: string, to: string) => ['store-builder', 'insights', 'summary', from, to] as const,
}

export async function fetchDocumentInsights(id: string, range: InsightsRange, signal?: AbortSignal): Promise<DocumentInsights> {
  const response = await api.get<unknown>(`${BASE}/documents/${encodeURIComponent(id)}/insights`, {
    query: { from: range.from, to: range.to, device: range.device === 'all' ? undefined : range.device },
    signal,
  })
  return readDocumentInsights(response.data)
}

export async function fetchInsightsSummary(range: { from: string; to: string }, signal?: AbortSignal): Promise<Record<string, PageInsightsSummary>> {
  const response = await api.get<unknown>(`${BASE}/insights`, { query: { from: range.from, to: range.to }, signal })
  return readInsightsSummary(response.data)
}

export function useDocumentInsightsQuery(id: string, range: InsightsRange, enabled: boolean) {
  return useQuery({
    queryKey: insightsKeys.document(id, range),
    queryFn: ({ signal }) => fetchDocumentInsights(id, range, signal),
    enabled,
    // Refetch keeps the frame: the previous figures stay (dimmed) while a new range loads.
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  })
}

export function useInsightsSummaryQuery(range: { from: string; to: string }, enabled: boolean) {
  return useQuery({
    queryKey: insightsKeys.summary(range.from, range.to),
    queryFn: ({ signal }) => fetchInsightsSummary(range, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}
