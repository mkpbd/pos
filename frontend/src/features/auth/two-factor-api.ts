import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

/** GET /auth/two-factor — the signed-in user's own two-factor sign-in (G1a). */
export type TwoFactorStatus = {
  enabled: boolean
  confirmed_at: string | null
  /** The organization's policy covers this user: it cannot be turned off. */
  required: boolean
  recovery_codes_left: number | null
  /** A secret was issued but never confirmed with a code. */
  pending_setup: boolean
}

export type TwoFactorSecret = { secret: string; otpauth_uri: string }
export type RecoveryCodes = { recovery_codes: string[] }

export function useTwoFactorStatusQuery() {
  return useQuery({
    queryKey: authKeys.twoFactor,
    queryFn: ({ signal }) => api.get<TwoFactorStatus>('/auth/two-factor', { signal }).then((r) => r.data),
  })
}

/** Both the status card and the session's `two_factor` summary change together. */
export function useRefreshTwoFactor() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: authKeys.twoFactor })
    void queryClient.invalidateQueries({ queryKey: authKeys.me })
  }
}

/** POST /auth/two-factor/setup {password} → a fresh, unconfirmed secret and its otpauth:// URI. */
export function useStartTwoFactorSetupMutation() {
  return useMutation({
    mutationFn: (input: { password: string }) => api.post<TwoFactorSecret>('/auth/two-factor/setup', input).then((r) => r.data),
  })
}

/**
 * POST /auth/two-factor/confirm {code} → turns two-factor on and returns the recovery codes (shown once).
 * Only the status is refreshed here: the session summary is refreshed by the caller once the codes are
 * saved, so the setup screen is not left before the user has seen them.
 */
export function useConfirmTwoFactorMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { code: string }) => api.post<RecoveryCodes>('/auth/two-factor/confirm', input).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactor }),
  })
}

/** POST /auth/two-factor/recovery-codes {password} → 10 new codes; the old ones stop working. */
export function useRegenerateRecoveryCodesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { password: string }) => api.post<RecoveryCodes>('/auth/two-factor/recovery-codes', input).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.twoFactor }),
  })
}

/** DELETE /auth/two-factor {password, code} — code is an authenticator code or a recovery code. */
export function useDisableTwoFactorMutation() {
  const refresh = useRefreshTwoFactor()
  return useMutation({
    mutationFn: (input: { password: string; code: string }) => api.delete<void>('/auth/two-factor', { body: input }),
    onSuccess: refresh,
  })
}
