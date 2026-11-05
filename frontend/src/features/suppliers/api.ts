import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type Supplier = {
  id: string
  code: string
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  address: string | null
  tax_number: string | null
  payment_terms_days: number
  opening_balance: string
  notes: string | null
  is_active: boolean
  archived_at: string | null
}

export type SupplierInput = Omit<Supplier, 'id' | 'archived_at' | 'code'> & { code: string | null }

const supplierKeys = { all: ['suppliers'] as const }

/** Query string of GET /suppliers — shared by the list and its export. */
export function supplierListQuery(params: { page?: number; search?: string; archived?: boolean }) {
  return { ...params, archived: params.archived ? 1 : undefined }
}

export function useSuppliersQuery(params: { page: number; search?: string; archived?: boolean }) {
  return useQuery({
    queryKey: [...supplierKeys.all, params],
    queryFn: ({ signal }) => api.get<Supplier[]>('/suppliers', { signal, query: supplierListQuery(params) }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: supplierKeys.all })
}

export function useSaveSupplierMutation() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<SupplierInput> }) =>
      (id ? api.patch<Supplier>(`/suppliers/${id}`, input) : api.post<Supplier>('/suppliers', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useArchiveSupplierMutation() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: ({ id, restore }: { id: string; restore?: boolean }) =>
      (restore ? api.post<Supplier>(`/suppliers/${id}/restore`) : api.delete(`/suppliers/${id}`)).then(() => undefined),
    onSuccess: invalidate,
  })
}
