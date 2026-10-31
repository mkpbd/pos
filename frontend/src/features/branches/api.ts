import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

export type StoreType = 'store' | 'warehouse'

export type Store = {
  id: string
  branch_id: string
  code: string
  name: string
  type: StoreType
  is_active: boolean
}

export type Branch = {
  id: string
  code: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  timezone: string | null
  is_active: boolean
  allow_negative_stock: boolean
  stores: Store[]
  created_at: string
}

export type BranchListParams = { page: number; search?: string; is_active?: boolean; per_page?: number }

export type BranchInput = {
  code: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  timezone?: string | null
  allow_negative_stock?: boolean
  is_active?: boolean
}

export type StoreInput = { code: string; name: string; type: StoreType; is_active?: boolean }

export const branchKeys = {
  all: ['branches'] as const,
  list: (params: BranchListParams) => ['branches', 'list', params] as const,
}

export function useBranchesQuery(params: BranchListParams) {
  return useQuery({
    queryKey: branchKeys.list(params),
    queryFn: ({ signal }) =>
      api
        .get<Branch[]>('/branches', { signal, query: { ...params, is_active: params.is_active === undefined ? undefined : Number(params.is_active) } })
        .then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

function useInvalidateBranches() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: branchKeys.all })
    // Branch names/status feed the branch switcher.
    void queryClient.invalidateQueries({ queryKey: authKeys.me })
  }
}

export function useSaveBranchMutation() {
  const invalidate = useInvalidateBranches()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BranchInput }) =>
      (id ? api.patch<Branch>(`/branches/${id}`, input) : api.post<Branch>('/branches', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useSaveStoreMutation(branchId: string) {
  const invalidate = useInvalidateBranches()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: StoreInput }) =>
      (id ? api.patch<Store>(`/branches/${branchId}/stores/${id}`, input) : api.post<Store>(`/branches/${branchId}/stores`, input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}
