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
