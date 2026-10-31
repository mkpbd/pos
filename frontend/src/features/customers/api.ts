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

const customerKeys = { all: ['customers'] as const, groups: ['customer-groups'] as const }

export function useCustomersQuery(params: { page: number; search?: string; customer_group_id?: string; archived?: boolean }) {
  return useQuery({
    queryKey: [...customerKeys.all, params],
    queryFn: ({ signal }) =>
      api.get<Customer[]>('/customers', { signal, query: { ...params, archived: params.archived ? 1 : undefined } }).then(toPaginated),
    placeholderData: (previous) => previous,
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

export function useCustomerPaymentsQuery(params: { page: number; customer_id?: string; branch_id?: string; search?: string }) {
  return useQuery<Paginated<CustomerPayment>>({
    queryKey: accountKeys.payments(params),
    queryFn: ({ signal }) => api.get<CustomerPayment[]>('/customer-payments', { signal, query: { ...params, sort: '-created_at' } }).then(toPaginated),
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
