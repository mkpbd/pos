import { useQuery } from '@tanstack/react-query'
import { api, toPaginated } from '@/lib/api/client'

export type AuditEntry = {
  id: string
  action: string
  user_id: string | null
  branch_id: string | null
  subject_type: string | null
  subject_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  context: Record<string, unknown> | null
  ip_address: string | null
  request_id: string | null
  created_at: string
}

export type AuditListParams = { page: number; action?: string; user_id?: string; from?: string; to?: string }

export function useAuditLogQuery(params: AuditListParams) {
  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: ({ signal }) => api.get<AuditEntry[]>('/audit-logs', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

/** GET /login-activities (audit.view): every sign-in attempt in the organization. */
export type OrganizationLoginActivity = {
  id: string
  user_id: string | null
  email: string | null
  channel: 'session' | 'token'
  succeeded: boolean
  failure_reason: string | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export type LoginActivityParams = { page: number; succeeded?: boolean; search?: string }

export function useLoginActivitiesQuery(params: LoginActivityParams) {
  return useQuery({
    queryKey: ['login-activities', params],
    queryFn: ({ signal }) =>
      api
        .get<OrganizationLoginActivity[]>('/login-activities', {
          signal,
          query: { page: params.page, search: params.search, succeeded: params.succeeded === undefined ? undefined : params.succeeded ? 1 : 0 },
        })
        .then(toPaginated),
    placeholderData: (previous) => previous,
  })
}
