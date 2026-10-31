import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import { paymentsKeys, type PaymentDirection, type PaymentEntry } from '@/features/payments/api'
import type { MoneyMethod } from '@/lib/payment-methods'

export type UserRef = { id: string; name: string | null }
export type BranchRef = { id: string; code: string; name: string }
export type SessionStatus = 'open' | 'closed'

export type CashRegister = {
  id: string
  code: string
  name: string
  is_active: boolean
  branch: BranchRef | null
  open_session: { id: string; number: string; opened_at: string; opened_by: UserRef } | null
}

/** Session header, as listed by GET /register-sessions. */
export type RegisterSession = {
  id: string
  number: string
  status: SessionStatus
  currency: string
  branch: BranchRef | null
  register: { id: string; code: string; name: string } | null
  opening_float: string
  opened_by: UserRef
  opened_at: string
  /** Frozen when the session closes; the live figure of an open session is `cash.expected`. */
  expected_cash: string | null
  counted_cash: string | null
  variance: string | null
  closing_notes: string | null
  closed_by: UserRef | null
  closed_at: string | null
}

/** X report while open, Z report once closed. */
export type SessionReport = RegisterSession & {
  cash: { opening_float: string; cash_in: string; cash_out: string; expected: string; counted: string | null; variance: string | null }
  by_method: { method: MoneyMethod; label: string; in: string; out: string; net: string }[]
  by_source: { source_type: string; label: string; in: string; out: string; entries: number }[]
  entries: PaymentEntry[]
}

export type CashRegisterInput = { branch_id?: string; code: string; name: string; is_active: boolean }
export type CashMovementInput = { direction: PaymentDirection; amount: string; reason: string }

export type SessionsParams = { page: number; status?: SessionStatus; branch_id?: string; cash_register_id?: string }

export const registersKeys = {
  all: ['registers'] as const,
  list: (params: { branch_id?: string }) => ['registers', 'list', params] as const,
  sessions: (params: SessionsParams) => ['registers', 'sessions', params] as const,
  current: ['registers', 'current'] as const,
  session: (id: string) => ['registers', 'session', id] as const,
}

export function useCashRegistersQuery(params: { branch_id?: string } = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: registersKeys.list(params),
    queryFn: ({ signal }) => api.get<CashRegister[]>('/cash-registers', { signal, query: params }).then((r) => r.data),
    enabled: options.enabled ?? true,
  })
}

export function useRegisterSessionsQuery(params: SessionsParams, options: { enabled?: boolean } = {}) {
  return useQuery<Paginated<RegisterSession>>({
    queryKey: registersKeys.sessions(params),
    queryFn: ({ signal }) => api.get<RegisterSession[]>('/register-sessions', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  })
}

/** The caller's open session (null when none). Needs `cash_registers.operate`. */
export function useCurrentSessionQuery(enabled = true) {
  return useQuery({
    queryKey: registersKeys.current,
    queryFn: ({ signal }) => api.get<SessionReport | null>('/register-sessions/current', { signal }).then((r) => r.data ?? null),
    enabled,
  })
}

export function useSessionReportQuery(id?: string) {
  return useQuery({
    queryKey: registersKeys.session(id ?? ''),
    queryFn: ({ signal }) => api.get<SessionReport>(`/register-sessions/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Stores a fresh report everywhere it is shown, then refreshes the lists around it. */
function useApplyReport() {
  const queryClient = useQueryClient()
  return (report: SessionReport, { mine }: { mine: boolean }) => {
    queryClient.setQueryData(registersKeys.session(report.id), report)
    const current = queryClient.getQueryData<SessionReport | null>(registersKeys.current)
    if (mine || current?.id === report.id) {
      queryClient.setQueryData(registersKeys.current, report.status === 'open' ? report : null)
    }
    void queryClient.invalidateQueries({ queryKey: registersKeys.all, predicate: (q) => q.queryKey[1] === 'list' || q.queryKey[1] === 'sessions' })
    void queryClient.invalidateQueries({ queryKey: paymentsKeys.all })
  }
}

export function useSaveCashRegisterMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CashRegisterInput }) =>
      (id ? api.put<CashRegister>(`/cash-registers/${id}`, input) : api.post<CashRegister>('/cash-registers', input)).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registersKeys.all })
    },
  })
}

export function useOpenSessionMutation() {
  const apply = useApplyReport()
  return useMutation({
    mutationFn: ({ registerId, openingFloat }: { registerId: string; openingFloat: string }) =>
      api.post<SessionReport>(`/cash-registers/${registerId}/sessions`, { opening_float: openingFloat }).then((r) => r.data),
    onSuccess: (report) => apply(report, { mine: true }),
  })
}

/** Cash in / out. The caller supplies the Idempotency-Key and reuses it when retrying the same movement. */
export function useCashMovementMutation() {
  const apply = useApplyReport()
  return useMutation({
    mutationFn: ({ sessionId, input, idempotencyKey }: { sessionId: string; input: CashMovementInput; idempotencyKey: string }) =>
      api.post<SessionReport>(`/register-sessions/${sessionId}/cash-movements`, input, { idempotencyKey }).then((r) => r.data),
    onSuccess: (report) => apply(report, { mine: true }),
  })
}

export function useCloseSessionMutation() {
  const apply = useApplyReport()
  return useMutation({
    mutationFn: ({ sessionId, countedCash, notes }: { sessionId: string; countedCash: string; notes: string | null }) =>
      api.post<SessionReport>(`/register-sessions/${sessionId}/close`, { counted_cash: countedCash, notes }).then((r) => r.data),
    onSuccess: (report) => apply(report, { mine: false }),
  })
}

/** Badge variant and wording for a cash variance (counted − expected). */
export function varianceTone(variance: string | null): { variant: 'success' | 'warning' | 'destructive'; label: string } | null {
  if (variance === null) return null
  if (/^-?0*(\.0*)?$/.test(variance.trim())) return { variant: 'success', label: 'Balanced' }
  return variance.trim().startsWith('-') ? { variant: 'destructive', label: 'Short' } : { variant: 'warning', label: 'Over' }
}
