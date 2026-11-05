import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useInvalidateMoney } from '@/features/payments/api'
import { salesKeys } from '@/features/sales/api'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { MoneyMethod } from '@/lib/payment-methods'

export type CustomerGroup = {
  id: string
  name: string
  description: string | null
  discount_percent: string
  customers_count?: number
}

export type Customer = {
  id: string
  code: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  tax_number: string | null
  group: { id: string; name: string; discount_percent: string } | null
  credit_limit: string
  opening_balance: string
  notes: string | null
  is_active: boolean
  archived_at: string | null
  /** Online store sign-in (E7). Only on GET /customers/{id}; absent from list rows. */
  online_account?: OnlineAccount | null
}

export type OnlineAccountStatus = 'active' | 'disabled'

export type OnlineAccount = {
  email: string
  email_verified_at: string | null
  last_login_at: string | null
  status: OnlineAccountStatus
  created_at: string
}

export type CustomerInput = {
  code?: string | null
  name: string
  phone: string | null
  email: string | null
  address: string | null
  tax_number: string | null
  notes: string | null
  // Commercial terms: only accepted for users with customers.manage.
  customer_group_id?: string | null
  credit_limit?: string
  opening_balance?: string
  is_active?: boolean
}

const customerKeys = {
  all: ['customers'] as const,
  groups: ['customer-groups'] as const,
  detail: (id: string | undefined) => ['customers', 'detail', id] as const,
}

export type CustomerListParams = { page: number; search?: string; customer_group_id?: string; archived?: boolean }

/** Query string of GET /customers — shared by the list and its export. */
export function customerListQuery(params: Omit<CustomerListParams, 'page'> & { page?: number }) {
  return { ...params, archived: params.archived ? 1 : undefined }
}

export function useCustomersQuery(params: CustomerListParams) {
  return useQuery({
    queryKey: [...customerKeys.all, params],
    queryFn: ({ signal }) => api.get<Customer[]>('/customers', { signal, query: customerListQuery(params) }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useCustomerQuery(id: string | undefined) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => api.get<Customer>(`/customers/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Disable or re-enable the customer's online store sign-in (customers.manage). */
export function useSetOnlineAccountStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ customerId, status }: { customerId: string; status: OnlineAccountStatus }) =>
      api.patch<OnlineAccount>(`/customer-accounts/${customerId}`, { status }).then((r) => r.data),
    onSuccess: (account, { customerId }) => {
      queryClient.setQueryData<Customer>(customerKeys.detail(customerId), (c) => (c ? { ...c, online_account: account } : c))
      void queryClient.invalidateQueries({ queryKey: customerKeys.all })
    },
  })
}

export function useCustomerGroupsQuery() {
  return useQuery({
    queryKey: customerKeys.groups,
    queryFn: ({ signal }) => api.get<CustomerGroup[]>('/customer-groups', { signal }).then((r) => r.data),
  })
}

export function useSaveCustomerMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CustomerInput }) =>
      (id ? api.patch<Customer>(`/customers/${id}`, input) : api.post<Customer>('/customers', input)).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all })
      void queryClient.invalidateQueries({ queryKey: customerKeys.groups })
    },
  })
}

export function useArchiveCustomerMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, restore }: { id: string; restore?: boolean }) =>
      (restore ? api.post<Customer>(`/customers/${id}/restore`) : api.delete(`/customers/${id}`)).then(() => undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  })
}

export function useSaveCustomerGroupMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: { name: string; description: string | null; discount_percent: string } }) =>
      (id ? api.patch<CustomerGroup>(`/customer-groups/${id}`, input) : api.post<CustomerGroup>('/customer-groups', input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.groups }),
  })
}

export function useDeleteCustomerGroupMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/customer-groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.groups }),
  })
}

// ── Accounts receivable (Phase 6) ────────────────────────────────────────────

export type CustomerPayment = {
  id: string
  number: string
  customer: { id: string; code: string; name: string; phone?: string | null } | null
  branch_id: string
  currency: string
  amount: string
  method: MoneyMethod
  method_label: string
  reference: string | null
  notes: string | null
  created_by: { id: string; name: string | null } | null
  created_at: string
}

export type CustomerPaymentInput = {
  customer_id: string
  branch_id: string
  amount: string
  method: MoneyMethod
  reference: string | null
  notes: string | null
}

/** Signed amount: positive raises what the customer owes, negative lowers it. */
export type CustomerStatementEntryType = 'sale' | 'sale_payment' | 'sale_cancellation' | 'sale_return' | 'refund' | 'payment'

export type CustomerStatementEntry = {
  date: string
  type: CustomerStatementEntryType
  id: string
  number: string
  description: string
  amount: string
  balance: string
}

export type CustomerStatement = {
  customer: { id: string; code: string; name: string; phone: string | null; credit_limit: string }
  opening_balance: string
  entries: CustomerStatementEntry[]
  closing_balance: string
}

export const STATEMENT_ENTRY_LABELS: Record<CustomerStatementEntryType, string> = {
  sale: 'Invoice',
  sale_payment: 'Paid at the till',
  sale_cancellation: 'Invoice cancelled',
  sale_return: 'Return',
  refund: 'Refund',
  payment: 'Payment received',
}

export const accountKeys = {
  all: ['customer-accounts'] as const,
  payments: (params: Record<string, unknown>) => ['customer-accounts', 'payments', params] as const,
  statement: (customerId: string | undefined, params: Record<string, unknown>) => ['customer-accounts', 'statement', customerId, params] as const,
}

export type CustomerPaymentsParams = { page: number; customer_id?: string; branch_id?: string; search?: string }

/** Query string of GET /customer-payments — shared by the list and its export. */
export function customerPaymentsListQuery(params: Omit<CustomerPaymentsParams, 'page'> & { page?: number }) {
  return { ...params, sort: '-created_at' }
}

export function useCustomerPaymentsQuery(params: CustomerPaymentsParams) {
  return useQuery<Paginated<CustomerPayment>>({
    queryKey: accountKeys.payments(params),
    queryFn: ({ signal }) => api.get<CustomerPayment[]>('/customer-payments', { signal, query: customerPaymentsListQuery(params) }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useCustomerStatementQuery(customerId: string | undefined, params: { from?: string; to?: string }) {
  return useQuery({
    queryKey: accountKeys.statement(customerId, params),
    queryFn: ({ signal }) => api.get<CustomerStatement>(`/customers/${customerId}/statement`, { signal, query: params }).then((r) => r.data),
    enabled: !!customerId,
  })
}

/** Idempotent: pass the same key when retrying the same payment. */
export function useReceiveCustomerPaymentMutation() {
  const queryClient = useQueryClient()
  const invalidateMoney = useInvalidateMoney()

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CustomerPaymentInput; idempotencyKey: string }) =>
      api.post<CustomerPayment>('/customer-payments', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      invalidateMoney()
      // Balances shown on the Customers page and at the till (GET /sales/customer-balances).
      void queryClient.invalidateQueries({ queryKey: [...salesKeys.all, 'customer-balances'] })
    },
  })
}

// ── Web activity (E10b) ──────────────────────────────────────────────────────

export type WebActivityOrder = {
  id: string
  number: string
  placed_at: string
  status: string
  status_label?: string
  payment_status?: string
  total: string
  currency?: string
}

/** The customer's online store activity: account, orders, returns, reviews, wishlist and cart. */
export type WebActivity = {
  account: { email: string; verified: boolean; created_at: string; last_login_at: string | null; status: OnlineAccountStatus } | null
  orders: { count: number; total_spent: string; last_order_at: string | null; average_order: string | null }
  returns_count: number
  reviews: { count: number; pending: number }
  wishlist_count: number
  cart: { item_count: number; updated_at: string | null } | null
  recent_orders: WebActivityOrder[]
}

export function useWebActivityQuery(customerId: string) {
  return useQuery({
    queryKey: ['customers', 'web-activity', customerId] as const,
    queryFn: ({ signal }) => api.get<WebActivity>(`/customers/${customerId}/web-activity`, { signal }).then((r) => r.data),
  })
}
