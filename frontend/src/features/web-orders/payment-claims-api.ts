import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { webOrderKeys, type WebOrder } from '@/features/web-orders/api'

/**
 * BD1c: bKash / Nagad / Rocket "Send Money" payments. The customer sends the money from their phone
 * and types the sender number and the transaction ID (a claim); staff check it in their wallet app
 * and confirm or reject it (web_orders.manage, Idempotency-Key). Both answer with the full order.
 */

export type SendMoneyMethod = 'bkash_manual' | 'nagad_manual' | 'rocket_manual'
export type PaymentClaimStatus = 'submitted' | 'confirmed' | 'rejected'
/** `full` = the order total by a Send Money method; `advance` = the delivery charge asked before a COD order is sent. */
export type PaymentPurpose = 'full' | 'advance'

export type PaymentClaim = {
  id: string
  method: SendMoneyMethod | string
  purpose: PaymentPurpose
  /** The amount due when the claim was sent. */
  amount: string
  sender_phone: string
  transaction_id: string
  status: PaymentClaimStatus
  reject_reason: string | null
  submitted_at: string
  reviewed_by: { id: string; name: string | null } | null
  reviewed_at: string | null
}

export type PaymentDueMethod = { code: SendMoneyMethod | string; display_name: string; account_number: string | null; account_type: string | null; instructions?: string | null }

export type PaymentDue = {
  amount: string
  currency: string
  purpose: PaymentPurpose
  expires_at: string | null
  methods?: PaymentDueMethod[]
  claim?: { method: string; transaction_id: string; sender_phone: string; status: PaymentClaimStatus; reject_reason: string | null; submitted_at: string } | null
}

type ClaimAction = { orderId: string; claimId: string; idempotencyKey: string }

function useClaimMutation<TInput extends ClaimAction>(path: 'confirm' | 'reject', body: (input: TInput) => Record<string, unknown> | undefined) {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['payments'] })
  }
  return useMutation({
    mutationFn: (input: TInput) =>
      api.post<WebOrder | null>(`/web-orders/${input.orderId}/payment-claims/${input.claimId}/${path}`, body(input), { idempotencyKey: input.idempotencyKey }).then((r) => r.data),
    onSuccess: (order) => {
      if (order && typeof order === 'object' && 'allowed_actions' in order) queryClient.setQueryData(webOrderKeys.detail(order.id), order)
      refresh()
    },
    // A refused claim (INVALID_STATUS_TRANSITION) means our copy is stale.
    onError: refresh,
  })
}

/** Confirms the money arrived: the payment is recorded and the order moves to Confirmed (paid, or partly paid for an advance). */
export function useConfirmPaymentClaimMutation() {
  return useClaimMutation<ClaimAction>('confirm', () => undefined)
}

/** The money did not arrive: the claim is rejected with a reason the customer sees; the order keeps waiting. */
export function useRejectPaymentClaimMutation() {
  return useClaimMutation<ClaimAction & { reason: string }>('reject', (input) => ({ reason: input.reason }))
}
