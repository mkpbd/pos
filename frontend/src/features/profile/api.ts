import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

export type DeviceToken = {
  id: number
  name: string
  last_used_at: string | null
  expires_at: string | null
  created_at: string | null
  is_current: boolean
}

export type LoginActivity = {
  id: string
  channel: 'session' | 'token'
  succeeded: boolean
  failure_reason: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export function useDeviceTokensQuery() {
  return useQuery({
    queryKey: authKeys.tokens,
    queryFn: ({ signal }) => api.get<DeviceToken[]>('/auth/tokens', { signal }).then((r) => r.data),
  })
}

export function useRevokeTokenMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => api.delete(`/auth/tokens/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.tokens }),
  })
}

export function useMyLoginActivityQuery(page: number) {
  return useQuery({
    queryKey: authKeys.loginActivity(page),
    queryFn: ({ signal }) => api.get<LoginActivity[]>('/auth/login-activity', { signal, query: { page, per_page: 10 } }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export type ChangePasswordInput = { current_password: string; password: string; password_confirmation: string }

export function useChangePasswordMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.put<void>('/auth/password', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.tokens }),
  })
}
