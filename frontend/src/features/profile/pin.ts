import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authKeys } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'
import { api } from '@/lib/api/client'

/**
 * POS1a: the signed-in user's till PIN (PUT / DELETE /profile/pin, current password required).
 * The PIN is write-only: the server only says whether one is set (`pin_set` on /auth/me).
 */

export const PIN_MIN = 4
export const PIN_MAX = 6

/** Same rules as the server: 4–6 digits, not one repeated digit, not a straight run (1234, 4321, 012345). */
export function pinError(pin: string): string | null {
  if (!pin) return 'Enter a PIN.'
  if (!/^\d+$/.test(pin)) return 'Digits only.'
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `${PIN_MIN} to ${PIN_MAX} digits.`
  const digits = [...pin].map(Number)
  if (digits.every((d) => d === digits[0])) return 'Too easy to guess: not the same digit repeated.'
  const steps = digits.slice(1).map((d, i) => d - (digits[i] as number))
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Too easy to guess: not a run like 1234 or 4321.'
  return null
}

/** Whether the signed-in user has a till PIN (read from the user object or the top level of /auth/me). */
export function hasPin(me: CurrentUser | null | undefined): boolean {
  return me?.pin_set ?? me?.user.pin_set ?? false
}

function useSetPinFlag() {
  const queryClient = useQueryClient()
  return (pinSet: boolean) => {
    queryClient.setQueryData<CurrentUser | null>(authKeys.me, (me) => (me ? { ...me, pin_set: pinSet, user: { ...me.user, pin_set: pinSet } } : me))
    void queryClient.invalidateQueries({ queryKey: authKeys.me })
  }
}

export type SetPinInput = { current_password: string; pin: string }

export function useSetPinMutation() {
  const setFlag = useSetPinFlag()
  return useMutation({
    mutationFn: (input: SetPinInput) => api.put<void>('/profile/pin', input),
    onSuccess: () => setFlag(true),
  })
}

export function useRemovePinMutation() {
  const setFlag = useSetPinFlag()
  return useMutation({
    mutationFn: (input: { current_password: string }) => api.delete('/profile/pin', { body: input }),
    onSuccess: () => setFlag(false),
  })
}
