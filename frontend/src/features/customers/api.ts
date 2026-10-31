import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

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
