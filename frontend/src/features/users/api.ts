import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type UserStatus = 'active' | 'inactive'

export type ManagedUser = {
  id: string
  name: string
  email: string
  phone: string | null
  status: UserStatus
  is_platform_admin: boolean
  last_login_at: string | null
  roles: { id: string; name: string; system_key: string | null }[]
  branch_ids: string[]
  created_at: string
}

export type UserListParams = { page: number; search?: string; status?: UserStatus; role_id?: string; branch_id?: string }

export type UserInput = {
  name: string
  email: string
  phone: string | null
  password?: string
  status: UserStatus
  role_ids: string[]
  branch_ids: string[]
}

export const userKeys = {
  all: ['users'] as const,
  list: (params: UserListParams) => ['users', 'list', params] as const,
}

export function useUsersQuery(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => api.get<ManagedUser[]>('/users', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useSaveUserMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<UserInput> }) =>
      (id ? api.patch<ManagedUser>(`/users/${id}`, input) : api.post<ManagedUser>('/users', input)).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}
