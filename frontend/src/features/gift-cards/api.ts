import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'

/**
 * POS1b gift cards, vouchers and credit notes. The full code is never stored in clear: it comes
 * back exactly once (issue / sell / credit note response); lists and details only know the last 4.
 */

export type GiftCardKind = 'gift_card' | 'voucher' | 'credit_note'
export type GiftCardStatus = 'active' | 'void'

export const GIFT_CARD_KINDS: Record<GiftCardKind, string> = {
  gift_card: 'Gift card',
  voucher: 'Voucher',
  credit_note: 'Credit note',
}

export type GiftCardEntryType = 'issue' | 'redeem' | 'sale_reversal' | 'void'

export const GIFT_CARD_ENTRY_LABELS: Record<GiftCardEntryType, string> = {
  issue: 'Issued',
  redeem: 'Spent on a sale',
  sale_reversal: 'Sale cancelled',
  void: 'Voided',
}

type Person = { id: string; name: string | null }

export type GiftCard = {
  id: string
  code_last4: string
  kind: GiftCardKind
  initial_value: string
  balance: string
  currency: string
  status: GiftCardStatus
  expires_at: string | null
  expired: boolean
  customer: { id: string; name: string } | null
  /** A user reference or a name, depending on the presenter. */
  issued_by: Person | string | null
  issued_at: string
}

export type GiftCardEntry = {
  id?: string
  type: GiftCardEntryType
  /** Signed: + raises the balance, − lowers it. */
  amount: string
  balance_after: string
  reference_type?: string | null
  reference_id?: string | null
  reference_number: string | null
  created_by?: Person | string | null
  created_at: string
}

export type GiftCardDetail = GiftCard & {
  entries: GiftCardEntry[]
  note?: string | null
  sale_receipt_number?: string | null
  void_reason?: string | null
  voided_at?: string | null
  voided_by?: Person | string | null
}

/** The issue / sell response: `code` is the full code, shown once. */
export type IssuedGiftCard = {
  gift_card: {
    id: string
    code: string
    code_last4: string
    kind: GiftCardKind
    balance: string
    currency: string
    expires_at: string | null
    customer: { id: string; name: string } | null
  }
  receipt_number: string | null
}

export type VoucherInput = {
  amount: string
  reason: string
  customer_id?: string
  expires_at?: string | null
  never_expires?: boolean
}

export type GiftCardListParams = { page: number; search?: string; status?: GiftCardStatus; kind?: GiftCardKind }

export const giftCardKeys = {
  all: ['gift-cards'] as const,
  list: (params: GiftCardListParams) => ['gift-cards', 'list', params] as const,
  detail: (id: string) => ['gift-cards', 'detail', id] as const,
}

export const personName = (p: Person | string | null | undefined): string | null => (p == null ? null : typeof p === 'string' ? p : p.name)

/** "ABCD2345EFGH6789" or "abcd-2345 efgh6789" → "ABCD-2345-EFGH-6789". */
export function formatGiftCode(code: string): string {
  const clean = code.replace(/[^0-9a-z]/gi, '').toUpperCase()
  return clean.match(/.{1,4}/g)?.join('-') ?? clean
}

export const maskedCode = (last4: string) => `••••${last4}`

export function useGiftCardsQuery(params: GiftCardListParams) {
  return useQuery<Paginated<GiftCard>>({
    queryKey: giftCardKeys.list(params),
    queryFn: ({ signal }) => api.get<GiftCard[]>('/gift-cards', { signal, query: params }).then(toPaginated),
    placeholderData: keepPreviousData,
  })
}

export function useGiftCardQuery(id: string | null) {
  return useQuery({
    queryKey: giftCardKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<GiftCardDetail>(`/gift-cards/${id}`, { signal }).then((r) => r.data),
    enabled: !!id,
  })
}

/** Idempotent: pass the same key when retrying the same voucher. */
export function useIssueVoucherMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: VoucherInput; idempotencyKey: string }) =>
      api.post<IssuedGiftCard>('/gift-cards/vouchers', input, { idempotencyKey }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: giftCardKeys.all }),
  })
}

export function useVoidGiftCardMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<unknown>(`/gift-cards/${id}/void`, { reason }).then((r) => r.data),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: giftCardKeys.all }),
  })
}
