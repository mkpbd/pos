import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

export type Role = {
  id: string
  name: string
  description: string | null
  system_key: string | null
  is_system: boolean
  users_count: number
  permissions: string[]
}

export type PermissionGroup = {
  module: string
  permissions: { name: string; description: string }[]
}

export type RoleInput = { name: string; description: string | null; permissions: string[] }

export const roleKeys = {
  all: ['roles'] as const,
  list: ['roles', 'list'] as const,
  permissions: ['permissions'] as const,
}

export function useRolesQuery(enabled = true) {
  return useQuery({
    queryKey: roleKeys.list,
    queryFn: ({ signal }) => api.get<Role[]>('/roles', { signal }).then((r) => r.data),
    enabled,
  })
}

export function usePermissionCatalogQuery() {
  return useQuery({
    queryKey: roleKeys.permissions,
    queryFn: ({ signal }) => api.get<PermissionGroup[]>('/permissions', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

function useInvalidateRoles() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.all })
    // Editing a role can change the current user's own permissions.
    void queryClient.invalidateQueries({ queryKey: authKeys.me })
  }
}

export function useSaveRoleMutation() {
  const invalidate = useInvalidateRoles()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RoleInput }) =>
      (id ? api.put<Role>(`/roles/${id}`, input) : api.post<Role>('/roles', input)).then((r) => r.data),
    onSuccess: invalidate,
  })
}

export function useDeleteRoleMutation() {
  const invalidate = useInvalidateRoles()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: invalidate,
  })
}
