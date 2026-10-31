import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type CheckStatus = 'ok' | 'fail'

export type SystemHealth = {
  status: 'ok' | 'degraded'
  checks: Record<string, CheckStatus>
  app: string
  environment: string
  time: string
}

export const systemKeys = {
  health: ['system', 'health'] as const,
}

export function fetchHealth(signal?: AbortSignal): Promise<SystemHealth> {
  return api.get<SystemHealth>('/health', { signal }).then((res) => res.data)
}

export function useHealthQuery() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 30_000,
  })
}
