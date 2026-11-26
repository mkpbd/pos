import { useMutation, useQueryClient } from '@tanstack/react-query'
import { registersKeys } from '@/features/registers/api'
import { api } from '@/lib/api/client'

/** POS1d: a no-sale drawer opening (`POST /pos/drawer-openings`, 201). */
export type DrawerOpening = { id: string; opened_at: string; approved_by: { id: string; name: string } | null }

export type DrawerOpeningInput = { store_id: string; reason: string; approval_id?: string }

/** The longest reason the server keeps. */
export const DRAWER_REASON_MAX = 200

/**
 * Records opening the cash drawer without a sale, on the cashier's open register session. Needs
 * `pos.no_sale` or a manager's `no_sale` approval (used once). Idempotent per key.
 */
export function useOpenDrawerMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: DrawerOpeningInput; idempotencyKey: string }) =>
      api.post<DrawerOpening>('/pos/drawer-openings', input, { idempotencyKey }).then((r) => r.data),
    // The register session document counts the no-sale openings.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: registersKeys.all }),
  })
}
