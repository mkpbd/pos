import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { purchasingKeys, type SupplierRef } from '@/features/purchasing/api'

/**
 * Supply chain SC3: supplier performance read model — on-time delivery, fill rate, lead time,
 * returns, price stability, RFQ responsiveness and a 0–100 score. Rates are percentages as
 * decimal strings ("92.5"); a metric is null when the period has no data for it.
 */

export type PerformanceMetrics = {
  orders: number
  spend: string
  on_time_rate: string | null
  fill_rate: string | null
  avg_lead_days: string | null
  return_rate: string | null
  price_change_pct: string | null
  quote_response_rate: string | null
  quotes_won: number
  score: string | null
}

export type SupplierPerformanceRow = PerformanceMetrics & { supplier: SupplierRef }

export type PerformanceTrendMonth = {
  /** "2026-03" */
  month: string
  orders?: number
  on_time_rate: string | null
  fill_rate: string | null
  spend: string
}

export type ProblemDelivery = {
  purchase_order: { id: string; number: string }
  expected_date: string | null
  received_date: string | null
  days_late: number | null
  ordered_quantity?: string | null
  received_quantity?: string | null
  short_quantity: string | null
  is_late?: boolean
  is_short?: boolean
}

export type SupplierPerformance = {
  supplier: SupplierRef
  date_from: string
  date_to: string
  currency?: string
  metrics: PerformanceMetrics
  trend: PerformanceTrendMonth[]
  problem_deliveries: ProblemDelivery[]
}

export type PerformanceFilters = { date_from: string; date_to: string; branch_id?: string; supplier_id?: string }

export type PerformanceSort = 'score' | 'orders' | 'spend' | 'on_time_rate' | 'fill_rate' | 'avg_lead_days' | 'return_rate' | 'price_change_pct' | 'quote_response_rate' | 'quotes_won'

/** List query exactly as sent (and as the export repeats it). */
export function performanceListQuery(filters: PerformanceFilters, sort: { key: PerformanceSort; desc: boolean }) {
  return {
    date_from: filters.date_from,
    date_to: filters.date_to,
    branch_id: filters.branch_id || undefined,
    supplier_id: filters.supplier_id || undefined,
    sort: `${sort.desc ? '-' : ''}${sort.key}`,
  }
}

const keys = { all: [...purchasingKeys.all, 'supplier-performance'] as const }

export function useSupplierPerformanceListQuery(query: ReturnType<typeof performanceListQuery> & { page?: number }, enabled = true) {
  return useQuery<Paginated<SupplierPerformanceRow>>({
    queryKey: [...keys.all, 'list', query],
    queryFn: ({ signal }) => api.get<SupplierPerformanceRow[]>('/purchasing/supplier-performance', { signal, query }).then(toPaginated),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** The single-supplier response, tolerant of metrics sent flat or nested. */
export function normalizePerformance(raw: Record<string, unknown>): SupplierPerformance {
  const metrics = (raw.metrics ?? raw) as PerformanceMetrics
  return {
    supplier: raw.supplier as SupplierRef,
    date_from: String(raw.date_from ?? ''),
    date_to: String(raw.date_to ?? ''),
    currency: raw.currency as string | undefined,
    metrics: {
      orders: metrics.orders ?? 0,
      spend: metrics.spend ?? '0.00',
      on_time_rate: metrics.on_time_rate ?? null,
      fill_rate: metrics.fill_rate ?? null,
      avg_lead_days: metrics.avg_lead_days ?? null,
      return_rate: metrics.return_rate ?? null,
      price_change_pct: metrics.price_change_pct ?? null,
      quote_response_rate: metrics.quote_response_rate ?? null,
      quotes_won: metrics.quotes_won ?? 0,
      score: metrics.score ?? null,
    },
    trend: (raw.trend ?? raw.monthly ?? []) as PerformanceTrendMonth[],
    problem_deliveries: (raw.problem_deliveries ?? raw.late_deliveries ?? []) as ProblemDelivery[],
  }
}

export function useSupplierPerformanceQuery(supplierId: string, filters: Omit<PerformanceFilters, 'supplier_id'>, enabled = true) {
  return useQuery<SupplierPerformance>({
    queryKey: [...keys.all, 'one', supplierId, filters],
    queryFn: ({ signal }) =>
      api
        .get<Record<string, unknown>>(`/purchasing/suppliers/${supplierId}/performance`, { signal, query: { date_from: filters.date_from, date_to: filters.date_to, branch_id: filters.branch_id || undefined } })
        .then((r) => normalizePerformance(r.data)),
    placeholderData: keepPreviousData,
    enabled,
  })
}
