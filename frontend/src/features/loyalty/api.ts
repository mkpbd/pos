import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type LoyaltySettings = {
  is_enabled: boolean
  /** Spend this much (incl. tax, after points redeemed)… */
  spend_amount: string
  /** …to earn this many points. */
  points_per_spend: number
  /** Money value of one point when redeemed. */
  point_value: string
  min_redeem_points: number
}

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'earn_reversal' | 'redeem_reversal' | 'refund' | 'adjustment'

export type LoyaltyTransaction = {
  id: string
  type: LoyaltyTransactionType
  points: number
  balance_after: number
  value: string | null
  source_type: string | null
  source_id: string | null
  source_number: string | null
  notes: string | null
  created_at: string
}

export type LoyaltyAccount = {
  customer: { id: string; code: string; name: string }
  balance: number
  lifetime_earned: number
  lifetime_redeemed: number
  transactions: LoyaltyTransaction[]
}

export const LOYALTY_TRANSACTION_LABELS: Record<LoyaltyTransactionType, string> = {
  earn: 'Earned',
  redeem: 'Redeemed',
  earn_reversal: 'Earning reversed',
  redeem_reversal: 'Redemption reversed',
  refund: 'Refunded as points',
  adjustment: 'Manual adjustment',
}

export const loyaltyKeys = {
  all: ['loyalty'] as const,
  settings: ['loyalty', 'settings'] as const,
  balances: (ids: string[]) => ['loyalty', 'balances', ids] as const,
  account: (id: string) => ['loyalty', 'account', id] as const,
}

export function useLoyaltySettingsQuery(enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.settings,
    queryFn: ({ signal }) => api.get<LoyaltySettings>('/loyalty/settings', { signal }).then((r) => r.data),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** `{customer_id: points}` for up to 100 customers. */
export function useLoyaltyBalancesQuery(customerIds: string[], enabled = true) {
  const ids = [...new Set(customerIds)].sort()
  return useQuery({
    queryKey: loyaltyKeys.balances(ids),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams()
      ids.forEach((id) => query.append('customer_ids[]', id))
      return api.get<Record<string, number>>(`/loyalty/balances?${query.toString()}`, { signal }).then((r) => r.data)
    },
    enabled: enabled && ids.length > 0,
  })
}

export function useLoyaltyAccountQuery(customerId: string | null) {
  return useQuery({
    queryKey: loyaltyKeys.account(customerId ?? ''),
    queryFn: ({ signal }) => api.get<LoyaltyAccount>(`/loyalty/customers/${customerId}`, { signal }).then((r) => r.data),
    enabled: !!customerId,
  })
}

export function useSaveLoyaltySettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<LoyaltySettings>) => api.put<LoyaltySettings>('/loyalty/settings', input).then((r) => r.data),
    onSuccess: (settings) => queryClient.setQueryData(loyaltyKeys.settings, settings),
  })
}

export function useAdjustPointsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, points, notes }: { customerId: string; points: number; notes: string }) =>
      api.post<{ points: number; balance: number }>(`/loyalty/customers/${customerId}/adjust`, { points, notes }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: loyaltyKeys.all }),
  })
}

/**
 * Money value of whole points: points × point_value, exact (integer cents arithmetic).
 * "2.50" per point × 7 → "17.50".
 */
export function pointsValue(points: number, pointValue: string): string {
  const [integer = '0', fraction = ''] = pointValue.split('.')
  const cents = BigInt(integer + (fraction + '00').slice(0, 2)) * BigInt(points)
  const negative = cents < 0n
  const digits = (negative ? -cents : cents).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** Whole points an amount buys back, or null when the amount is not a whole number of points. */
export function pointsFor(amount: string, pointValue: string): number | null {
  const toCents = (v: string) => {
    const [i = '0', f = ''] = v.trim().split('.')
    return BigInt(i + (f + '00').slice(0, 2))
  }
  const value = toCents(pointValue)
  if (value === 0n) return null
  const cents = toCents(amount)
  return cents % value === 0n ? Number(cents / value) : null
}
