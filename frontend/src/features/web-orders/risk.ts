import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { BD_MOBILE, bdPhoneFrom } from '@/storefront/account/schemas'
import { webOrderKeys, type BulkResult } from '@/features/web-orders/api'

/*
 * BD1b: cash-on-delivery risk controls on web orders — the delivery history of a phone number
 * (GET /web-orders/phone-report, and `phone_report` on the order), blocked numbers
 * (/web-orders/blocked-phones) and confirming orders held for a call (POST …/confirm, bulk/confirm).
 */

/** What a phone number's past web orders came to; `success_rate` = delivered ÷ (delivered + returned), null with neither. */
export type PhoneReport = {
  phone: string
  orders: number
  delivered: number
  returned: number
  cancelled: number
  in_progress: number
  success_rate: number | null
  last_order_at: string | null
  blocked: boolean
  block_reason: string | null
}

/** The list row's risk summary (`risk` on GET /web-orders rows). */
export type OrderRisk = { success_rate: number | null; blocked: boolean }

export type BlockedPhone = {
  id: string
  phone: string
  reason: string | null
  created_by: { id: string; name: string | null } | null
  created_at: string
}

export const riskKeys = {
  blockedAll: ['web-orders', 'blocked-phones'] as const,
  blocked: (params: { search?: string; page: number }) => ['web-orders', 'blocked-phones', params] as const,
  phoneReport: (phone: string) => ['web-orders', 'phone-report', phone] as const,
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export type RiskTone = 'good' | 'fair' | 'poor' | 'none'

/** Green from 80 %, amber 50–79 %, red below 50 %, grey without any finished delivery. */
export function riskTone(rate: number | null | undefined): RiskTone {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return 'none'
  if (rate >= 80) return 'good'
  if (rate >= 50) return 'fair'
  return 'poor'
}

export const RISK_DOT: Record<RiskTone, string> = {
  good: 'bg-success',
  fair: 'bg-warning',
  poor: 'bg-destructive',
  none: 'bg-muted-foreground/40',
}

export const RISK_TONE_LABEL: Record<RiskTone, string> = {
  good: 'good delivery record',
  fair: 'mixed delivery record',
  poor: 'poor delivery record',
  none: 'no finished deliveries yet',
}

/** "80%" or "—" without a rate. */
export function rateLabel(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate)}%`
}

/** One line for a number: "New number" or "8 delivered · 2 returned · 80%". */
export function phoneReportSummary(report: Pick<PhoneReport, 'orders' | 'delivered' | 'returned' | 'success_rate'>): string {
  if (report.orders === 0) return 'New number'
  const parts = [`${report.delivered} delivered`, `${report.returned} returned`]
  if (report.success_rate !== null) parts.push(rateLabel(report.success_rate))
  return parts.join(' · ')
}

/** A typed Bangladeshi mobile as the server keeps it (01XXXXXXXXX), or null when it is not one. */
export function normalizedMobile(input: string): string | null {
  const phone = bdPhoneFrom(input)
  return BD_MOBILE.test(phone) ? phone : null
}

/** Ids of the chosen orders that are waiting for a call (only those can be confirmed). */
export function confirmableIds(selected: string[], rows: { id: string; status: string }[]): string[] {
  const waiting = new Set(rows.filter((r) => r.status === 'pending_confirmation').map((r) => r.id))
  return selected.filter((id) => waiting.has(id))
}

const BULK_CONFIRM_ERRORS: Record<string, string> = {
  INVALID_STATUS_TRANSITION: 'not awaiting confirmation any more',
  NOT_FOUND: 'not found',
  ORDER_NOT_FOUND: 'not found',
}

export function bulkConfirmErrorLabel(code: string | null | undefined, message?: string | null): string {
  if (code && BULK_CONFIRM_ERRORS[code]) return BULK_CONFIRM_ERRORS[code] as string
  return message || code || 'refused'
}

export function bulkConfirmSummary(results: BulkResult[]): string {
  const done = results.filter((r) => r.ok).length
  const refused = results.length - done
  const moved = `${done} ${done === 1 ? 'order' : 'orders'} confirmed`
  return refused === 0 ? `${moved}.` : `${moved}; ${refused} not changed.`
}

// ── API ──────────────────────────────────────────────────────────────────────

function useRefreshOrders() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
}

/** Delivery history of a number (GET /web-orders/phone-report?phone=); off until the number is a valid mobile. */
export function usePhoneReportQuery(phone: string | null) {
  return useQuery({
    queryKey: riskKeys.phoneReport(phone ?? ''),
    queryFn: ({ signal }) => api.get<PhoneReport>('/web-orders/phone-report', { signal, query: { phone } }).then((r) => r.data),
    enabled: !!phone,
    staleTime: 30_000,
  })
}

/** Pending-confirmation orders → confirmed, up to 100 (`{ids}`); each order reports back like bulk/process. */
export function useBulkConfirmMutation() {
  const refresh = useRefreshOrders()
  return useMutation({
    mutationFn: ({ orderIds, idempotencyKey }: { orderIds: string[]; idempotencyKey: string }) =>
      api
        .post<BulkResult[] | { results: BulkResult[] }>('/web-orders/bulk/confirm', { ids: orderIds }, { idempotencyKey })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.results ?? []))),
    onSettled: refresh,
  })
}

export function useBlockedPhonesQuery(params: { search?: string; page: number }) {
  return useQuery<Paginated<BlockedPhone>>({
    queryKey: riskKeys.blocked(params),
    queryFn: ({ signal }) => api.get<BlockedPhone[]>('/web-orders/blocked-phones', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

/** Blocking or unblocking changes the order risk badges and the delivery history of the number too. */
function useRefreshBlocks() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: riskKeys.blockedAll })
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
  }
}

export function useBlockPhoneMutation() {
  const refresh = useRefreshBlocks()
  return useMutation({
    mutationFn: (input: { phone: string; reason?: string | null }) =>
      api.post<BlockedPhone>('/web-orders/blocked-phones', { phone: input.phone, ...(input.reason ? { reason: input.reason } : {}) }).then((r) => r.data),
    onSuccess: refresh,
  })
}

export function useUnblockPhoneMutation() {
  const refresh = useRefreshBlocks()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/web-orders/blocked-phones/${id}`),
    onSuccess: refresh,
  })
}

/** Finds the block of a number (to unblock it from an order, which only knows the number). */
export async function findBlockedPhone(phone: string): Promise<BlockedPhone | null> {
  const r = await api.get<BlockedPhone[]>('/web-orders/blocked-phones', { query: { search: phone, page: 1 } })
  return r.data.find((b) => b.phone === phone) ?? null
}
