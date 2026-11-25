import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

/**
 * POS1a: till devices (GET/POST /pos/terminals, DELETE /pos/terminals/{id}, `pos.terminals.manage`).
 * Setting up a till stores an httpOnly `pos_terminal` cookie in this browser; the server marks the
 * till of this browser with `is_this_device`. A device with a till shows the PIN sign-in.
 */

export const TILL_PERMISSION = 'pos.terminals.manage'
export const TILL_NAME_MAX = 60

export type Till = {
  id: string
  name: string
  store: { id: string; name: string } | null
  created_by: { id: string; name: string | null } | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  is_this_device: boolean
}

export type TillInput = { store_id: string; name: string }

export const tillKeys = {
  all: ['pos', 'terminals'] as const,
}

export function useTillsQuery() {
  return useQuery({
    queryKey: tillKeys.all,
    queryFn: ({ signal }) => api.get<Till[]>('/pos/terminals', { signal }).then((r) => r.data),
  })
}

export function useSetUpTillMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: TillInput) => api.post<Till>('/pos/terminals', input).then((r) => r.data),
    // The device's till (if any) changes too: the till sign-in reads it from GET /pos/terminal.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pos'] }),
  })
}

export function useRevokeTillMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/pos/terminals/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pos'] }),
  })
}
