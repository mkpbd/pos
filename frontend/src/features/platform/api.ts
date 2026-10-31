import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import type { Organization } from '@/features/organization/api'

export type ProvisionInput = {
  organization_name: string
  name: string
  email: string
  password: string
  password_confirmation: string
  currency?: string
}

const platformKeys = { all: ['platform', 'organizations'] as const }

export function usePlatformOrganizationsQuery(params: { page: number; search?: string }) {
  return useQuery({
    queryKey: [...platformKeys.all, params],
    queryFn: ({ signal }) => api.get<Organization[]>('/platform/organizations', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export function useProvisionOrganizationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ProvisionInput) => api.post<Organization>('/platform/organizations', input).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.all }),
  })
}

export function useSetOrganizationStatusMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Organization['status'] }) =>
      api.patch<Organization>(`/platform/organizations/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.all }),
  })
}
