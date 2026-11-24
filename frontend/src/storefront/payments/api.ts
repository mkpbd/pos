import { useMutation, useQueryClient } from '@tanstack/react-query'
import { storeApi } from '../http'
import { useLocale } from '../i18n/locale'
import { accountKeys, checkoutKeys, setLocalizedData } from '../store-keys'
import type { OrderView, PaymentClaimInput } from '../types'

/**
 * BD1c: POST /store/orders/{number}/payment-claims (with an Idempotency-Key) — the shopper's
 * transaction ID. The answer is the order view (GET /store/orders/{number}) with its new
 * `payment_due`; the cached order pages are refreshed with it.
 */
export function submitPaymentClaim(number: string, input: PaymentClaimInput, idempotencyKey: string): Promise<OrderView> {
  return storeApi.post<OrderView>(`/store/orders/${encodeURIComponent(number)}/payment-claims`, input, { idempotencyKey }).then((r) => r.data)
}

/** `cache: false` (track page) leaves the order pages' cache alone: that shopper opened the order by its number and phone only. */
export function usePaymentClaimMutation(number: string, cache = true) {
  const queryClient = useQueryClient()
  const { locale } = useLocale()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PaymentClaimInput; idempotencyKey: string }) => submitPaymentClaim(number, input, idempotencyKey),
    onSuccess: (order) => {
      if (cache && order && typeof order === 'object' && 'number' in order) setLocalizedData(queryClient, checkoutKeys.order(number), locale, order)
      void queryClient.invalidateQueries({ queryKey: accountKeys.order(number) })
    },
  })
}

/** After "already checking" / "nothing to pay": fetch the order pages afresh. */
export function useRefreshOrder(number: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: checkoutKeys.order(number) })
    void queryClient.invalidateQueries({ queryKey: accountKeys.order(number) })
  }
}
