import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'
import { api, ApiError, ensureCsrfCookie } from '@/lib/api/client'

/** POS1a: the till this device is set up as (the `pos_terminal` cookie), with the cashiers who can sign in on it. */
export type TillTerminal = {
  id: string
  name: string
  store: { id: string; name: string; branch_id: string }
  users: { id: string; name: string }[]
}

/** POS1c: `return` = taking back items in an exchange (bound to `details.sale_id`). */
export type ApprovalAction = 'price_override' | 'discount' | 'return'

export type Approver = { id: string; name: string }

export type Approval = { id: string; action: ApprovalAction; approver: Approver; expires_at: string }

export const tillKeys = {
  terminal: ['till-terminal'] as const,
  approvers: (action: ApprovalAction, storeId: string | null) => ['pos', 'approvers', action, storeId] as const,
}

function isTerminal(value: unknown): value is TillTerminal {
  return typeof value === 'object' && value !== null && 'id' in value && 'store' in value && Array.isArray((value as TillTerminal).users)
}

/**
 * GET /pos/terminal (no sign-in needed): the till of this device, or null when the device is
 * not a till (404 TERMINAL_NOT_FOUND) or the answer is not a till at all.
 */
export function useTillTerminalQuery(enabled = true) {
  return useQuery({
    queryKey: tillKeys.terminal,
    queryFn: async ({ signal }) => {
      try {
        const data = (await api.get<unknown>('/pos/terminal', { signal })).data
        return isTerminal(data) ? data : null
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return null
        throw error
      }
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

/** Signs a cashier in on this till by PIN (replacing whoever is signed in: quick switch). */
export function usePinSignInMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { user_id: string; pin: string }) => {
      await ensureCsrfCookie()
      return (await api.post<CurrentUser>('/auth/pin', input)).data
    },
    onSuccess: (me) => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, me)
    },
  })
}

/** Unlocks the till screen with the signed-in cashier's own PIN (204). */
export function useVerifyPinMutation() {
  return useMutation({
    mutationFn: (pin: string) => api.post<void>('/auth/pin/verify', { pin }).then(() => undefined),
  })
}

/** People who can approve `action` at the store with their PIN (never the requester). */
export function useApproversQuery(action: ApprovalAction, storeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: tillKeys.approvers(action, storeId),
    queryFn: ({ signal }) => api.get<Approver[]>('/pos/approvers', { signal, query: { action, store_id: storeId } }).then((r) => r.data),
    enabled: enabled && !!storeId,
    staleTime: 60_000,
  })
}

export type ApprovalInput = { action: ApprovalAction; approver_id: string; pin: string; store_id: string; details?: Record<string, unknown> }

/** A manager's approval by PIN, valid for 10 minutes and used once at checkout. */
export function useCreateApprovalMutation() {
  return useMutation({
    mutationFn: (input: ApprovalInput) => api.post<Approval>('/pos/approvals', input).then((r) => r.data),
  })
}

/** Whether the signed-in user has a till PIN (the server may send `pin_set` at the top level or on `user`). */
export function hasTillPin(me: CurrentUser): boolean {
  return (me.pin_set ?? me.user.pin_set) === true
}

/** A PIN refusal as the till shows it; `retryAfter` (seconds) while the PIN is locked. */
export type PinProblem = { message: string; retryAfter: number | null; passwordOnly: boolean }

export function pinProblem(error: unknown): PinProblem {
  if (!(error instanceof ApiError)) return { message: error instanceof Error ? error.message : 'Something went wrong.', retryAfter: null, passwordOnly: false }
  switch (error.code) {
    case 'PIN_INVALID': {
      const left = Number(error.details.attempts_left)
      return {
        message: Number.isFinite(left) ? `Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` : 'Wrong PIN.',
        retryAfter: null,
        passwordOnly: false,
      }
    }
    case 'PIN_LOCKED': {
      const seconds = Number(error.details.retry_after)
      return { message: 'Too many wrong PINs.', retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 900, passwordOnly: false }
    }
    case 'PIN_NOT_ALLOWED':
      return { message: 'This account uses two-factor sign-in. Sign in with your password and code.', retryAfter: null, passwordOnly: true }
    case 'PIN_NOT_SET':
      return { message: 'No till PIN is set for this account. Set one under Profile & security.', retryAfter: null, passwordOnly: false }
    default:
      return { message: error.message, retryAfter: null, passwordOnly: false }
  }
}

/** m:ss for a countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
