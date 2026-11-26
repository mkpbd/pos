import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api/client'
import { salesKeys, type ReceiptChannel, type ReceiptDeliveryStatus } from '@/features/sales/api'

/**
 * POS1d: the sale's public receipt link (GET /sales/{id}/receipt-link, made on first need and
 * reused; `url` is null when the organization has no shop web address) and sending the receipt
 * by SMS or e-mail (POST /sales/{id}/receipt/send).
 */

export type ReceiptLink = { url: string | null; token: string }

export type SendReceiptInput = { channel: ReceiptChannel; to?: string }

export type SendReceiptResult = { channel: ReceiptChannel; recipient_masked: string; status: ReceiptDeliveryStatus }

export const receiptLinkKey = (saleId: string) => [...salesKeys.detail(saleId), 'receipt-link'] as const

export function useReceiptLinkQuery(saleId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: receiptLinkKey(saleId ?? ''),
    queryFn: ({ signal }) => api.get<ReceiptLink>(`/sales/${saleId}/receipt-link`, { signal }).then((r) => r.data),
    enabled: enabled && !!saleId,
    // The link never changes once made.
    staleTime: Infinity,
    retry: false,
  })
}

export function useSendReceiptMutation(saleId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SendReceiptInput) => api.post<SendReceiptResult>(`/sales/${saleId}/receipt/send`, input).then((r) => r.data),
    // The sale document lists the sends ("Receipt sent").
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: salesKeys.detail(saleId), exact: true }),
  })
}

/** What the person sending the receipt is told when the server refuses; `field` errors go under the recipient. */
export function sendReceiptError(error: unknown): { field?: string; form?: string } {
  if (!(error instanceof ApiError)) return { form: error instanceof Error ? error.message : 'Something went wrong.' }
  switch (error.code) {
    case 'SMS_NOT_READY':
      return { form: 'SMS is not set up — Settings → SMS.' }
    case 'SMS_TEMPLATE_OFF':
      return { form: 'The “Sale receipt” SMS is switched off — Settings → SMS.' }
    case 'RECEIPT_SEND_LIMIT':
      return { form: 'This receipt has already been sent as many times as allowed.' }
    case 'VALIDATION_FAILED': {
      const errors = error.fieldErrors
      const to = errors.to?.[0]
      const other = Object.entries(errors).find(([key]) => key !== 'to')?.[1]?.[0]
      return { field: to, form: other ?? (to ? undefined : error.message) }
    }
  }
  if (error.status === 429) return { form: 'Too many receipts sent just now. Wait a minute and try again.' }
  return { form: error.message }
}
