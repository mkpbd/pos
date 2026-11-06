import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

/**
 * GET /dashboard (Phase 7): KPIs with previous-period comparison, the daily sales trend split
 * POS / online, top products, low stock, recent transactions and sales by channel / branch.
 * Amounts are decimal strings. Cost and profit figures are null or absent without
 * products.view_cost. The normalizer accepts KPIs as `{ value, previous, change_pct }` objects
 * or flat values with a separate `previous` map.
 */

export const KPI_KEYS = ['total_sales', 'today_revenue', 'orders_count', 'gross_profit', 'average_ticket', 'returns_amount'] as const
export type KpiKey = (typeof KPI_KEYS)[number]

export type Kpi = { value: string | null; previous: string | null; change: string | null }

export type TrendPoint = { date: string; net_sales: string; pos: string | null; online: string | null; orders: number | null; gross_profit: string | null }

export type TopProduct = { key: string; product_id: string | null; name: string; sku: string | null; quantity: string; net_sales: string; orders: number | null }

export type LowStockItem = { key: string; name: string; sku: string | null; store: string | null; on_hand: string; reorder_point: string | null }

export type RecentTransaction = {
  key: string
  kind: 'sale' | 'web_order'
  id: string
  number: string
  at: string | null
  total: string | null
  status: string | null
  customer: string | null
}

export type ChannelSales = { channel: string; label: string; net_sales: string; orders: number | null }

export type BranchSales = { id: string; name: string; net_sales: string; orders: number | null }

export type Dashboard = {
  range: { from: string; to: string } | null
  previousRange: { from: string; to: string } | null
  currency: string | null
  kpis: Partial<Record<KpiKey, Kpi>>
  trend: TrendPoint[]
  topProducts: TopProduct[]
  lowStock: { count: number; items: LowStockItem[] }
  recent: RecentTransaction[]
  byChannel: ChannelSales[]
  byBranch: BranchSales[] | null
  generatedAt: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const nameOf = (v: unknown): string | null => (isObj(v) ? str(v.name ?? v.label ?? v.title) : str(v))

/** A value that may be a plain amount or `{ net_sales | amount | value }`. */
function amount(v: unknown, ...keys: string[]): string | null {
  if (isObj(v)) {
    for (const k of [...keys, 'net_sales', 'amount', 'value', 'total']) {
      const s = str(v[k])
      if (s !== null) return s
    }
    return null
  }
  return str(v)
}

function range(v: unknown): { from: string; to: string } | null {
  if (!isObj(v)) return null
  const from = str(v.date_from ?? v.from)
  const to = str(v.date_to ?? v.to)
  return from && to ? { from, to } : null
}

function normalizeKpis(raw: unknown, previousMap: unknown): Partial<Record<KpiKey, Kpi>> {
  const out: Partial<Record<KpiKey, Kpi>> = {}
  if (!isObj(raw)) return out
  const prev = isObj(previousMap) ? previousMap : {}
  for (const key of KPI_KEYS) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (isObj(v)) {
      out[key] = {
        value: str(v.value ?? v.current ?? v.amount),
        previous: str(v.previous ?? v.previous_value ?? v.prior),
        // `change` is the absolute difference; only the percentage is shown.
        change: str(v.change_pct ?? v.change_percent),
      }
    } else {
      out[key] = { value: str(v), previous: str(prev[key]), change: null }
    }
  }
  return out
}

function normalizeTrend(raw: unknown): TrendPoint[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.points) ? raw.points : []
  return list.filter(isObj).map((p) => {
    const pos = p.pos ?? p.pos_sales ?? p.pos_net_sales ?? (isObj(p.channels) ? p.channels.pos : undefined)
    const online = p.online ?? p.online_sales ?? p.online_net_sales ?? (isObj(p.channels) ? p.channels.online : undefined)
    return {
      date: str(p.date ?? p.day) ?? '',
      net_sales: amount(p.net_sales ?? p.total ?? p.value) ?? '0.00',
      pos: amount(pos),
      online: amount(online),
      orders: num(p.orders ?? p.orders_count),
      gross_profit: str(p.gross_profit),
    }
  }).filter((p) => p.date !== '')
}

function normalizeTopProducts(raw: unknown): TopProduct[] {
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((r, i) => {
    const product = isObj(r.product) ? r.product : {}
    const variant = isObj(r.variant) ? r.variant : {}
    const id = str(r.product_id ?? product.id)
    const base = nameOf(r.product) ?? str(r.product_name ?? r.name ?? variant.product_name) ?? 'Product'
    const variantName = str(r.variant_name ?? variant.name ?? variant.variant_name)
    return {
      key: `${id ?? str(r.variant_id ?? variant.id) ?? i}-${i}`,
      product_id: id,
      name: variantName ? `${base} — ${variantName}` : base,
      sku: str(r.sku ?? variant.sku),
      quantity: str(r.quantity ?? r.qty) ?? '0',
      net_sales: amount(r.net_sales ?? r.revenue ?? r.total) ?? '0.00',
      orders: num(r.orders ?? r.orders_count),
    }
  })
}

function normalizeLowStock(raw: unknown): { count: number; items: LowStockItem[] } {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.items) ? raw.items : []
  const count = isObj(raw) ? (num(raw.count ?? raw.total) ?? list.length) : list.length
  const items = list.filter(isObj).map((r, i) => {
    const variant = isObj(r.variant) ? r.variant : {}
    const base = str(r.product_name ?? variant.product_name) ?? nameOf(r.product) ?? str(r.name) ?? 'Product'
    const variantName = str(r.variant_name ?? variant.variant_name ?? variant.name)
    return {
      key: `${str(r.variant_id ?? variant.id ?? r.id) ?? i}-${nameOf(r.store) ?? ''}-${i}`,
      name: variantName ? `${base} — ${variantName}` : base,
      sku: str(r.sku ?? variant.sku),
      store: nameOf(r.store) ?? str(r.store_name),
      on_hand: str(r.on_hand ?? r.quantity) ?? '0',
      reorder_point: str(r.reorder_point ?? r.reorder_level),
    }
  })
  return { count, items }
}

function normalizeRecent(raw: unknown): RecentTransaction[] {
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((r, i) => {
    const type = str(r.type ?? r.kind ?? r.channel) ?? ''
    const kind: RecentTransaction['kind'] = type === 'web_order' || type === 'online' || type === 'web' ? 'web_order' : 'sale'
    const id = str(r.id) ?? ''
    return {
      key: `${kind}-${id || i}`,
      kind,
      id,
      number: str(r.number ?? r.reference) ?? '—',
      at: str(r.at ?? r.occurred_at ?? r.date ?? r.sold_at ?? r.placed_at ?? r.created_at),
      total: str(r.total ?? r.amount),
      status: str(r.status),
      customer: nameOf(r.customer) ?? str(r.customer_name),
    }
  })
}

const CHANNEL_LABELS: Record<string, string> = { pos: 'POS', online: 'Online' }

function normalizeChannels(raw: unknown): ChannelSales[] {
  const list: Obj[] = Array.isArray(raw) ? raw.filter(isObj) : isObj(raw) ? Object.entries(raw).map(([channel, v]): Obj => ({ channel, ...(isObj(v) ? v : { net_sales: v }) })) : []
  return list.map((r) => {
    const channel = str(r.channel ?? r.key) ?? 'other'
    return { channel, label: str(r.label) ?? CHANNEL_LABELS[channel] ?? channel, net_sales: amount(r.net_sales ?? r.amount ?? r.total) ?? '0.00', orders: num(r.orders ?? r.orders_count) }
  })
}

function normalizeBranches(raw: unknown): BranchSales[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter(isObj).map((r, i) => ({
    id: str(r.branch_id ?? (isObj(r.branch) ? r.branch.id : null)) ?? String(i),
    name: nameOf(r.branch) ?? str(r.branch_name ?? r.name) ?? 'Branch',
    net_sales: amount(r.net_sales ?? r.amount ?? r.total) ?? '0.00',
    orders: num(r.orders ?? r.orders_count),
  }))
}

export function normalizeDashboard(data: unknown, meta: Obj = {}): Dashboard {
  const d = isObj(data) ? data : {}
  const params = isObj(meta.params) ? meta.params : {}
  return {
    range: range(d.range) ?? range(d.period) ?? range(params),
    previousRange: range(d.previous_range ?? d.previous_period ?? d.comparison) ?? range(meta.previous_period) ?? range({ from: params.previous_from, to: params.previous_to }),
    currency: str(d.currency ?? meta.currency ?? params.currency),
    kpis: normalizeKpis(d.kpis ?? d.kpi, d.previous ?? d.previous_kpis),
    trend: normalizeTrend(d.sales_trend ?? d.trend),
    topProducts: normalizeTopProducts(d.top_products),
    lowStock: normalizeLowStock(d.low_stock),
    recent: normalizeRecent(d.recent_transactions ?? d.recent),
    byChannel: normalizeChannels(d.sales_by_channel ?? d.channels),
    byBranch: normalizeBranches(d.sales_by_branch),
    generatedAt: str(d.generated_at ?? meta.generated_at),
  }
}

export type DashboardQuery = { date_from: string; date_to: string; branch_id?: string }

export function useDashboardQuery(query: DashboardQuery) {
  return useQuery<Dashboard>({
    queryKey: ['dashboard', query],
    queryFn: ({ signal }) => api.get<unknown>('/dashboard', { signal, query }).then((r) => normalizeDashboard(r.data, r.meta as Obj)),
    placeholderData: keepPreviousData,
    // The server caches for 60 s; refreshing more often would only repeat the same figures.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}
