import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, ensureCsrfCookie } from '@/lib/api/client'
import type { CurrentUser } from '@/features/auth/types'

export const authKeys = {
  me: ['auth', 'me'] as const,
  tokens: ['auth', 'tokens'] as const,
  loginActivity: (page: number) => ['auth', 'login-activity', page] as const,
  options: ['auth', 'options'] as const,
  twoFactor: ['auth', 'two-factor'] as const,
}

export type AuthOptions = { registration_enabled: boolean }

/** GET /auth/options (no sign-in needed): whether public sign-up is switched on (Q1 §5, off by default). */
export function useAuthOptionsQuery() {
  return useQuery({
    queryKey: authKeys.options,
    queryFn: ({ signal }) => api.get<AuthOptions>('/auth/options', { signal }).then((r) => r.data),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

/**
 * The signed-in user, or null when there is no session. Source of truth for auth state.
 */
export function useCurrentUserQuery() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return (await api.get<CurrentUser>('/auth/me', { signal })).data
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export type LoginInput = { email: string; password: string; remember: boolean }

/** G1a: the password was right but the account has two-factor sign-in on — a code is needed next. */
export type TwoFactorChallenge = { two_factor_required: true }

export function isTwoFactorChallenge(value: CurrentUser | TwoFactorChallenge): value is TwoFactorChallenge {
  return 'two_factor_required' in value && value.two_factor_required === true
}

export function useLoginMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      await ensureCsrfCookie()
      return (await api.post<CurrentUser | TwoFactorChallenge>('/auth/login', input)).data
    },
    onSuccess: (result) => {
      // A pending two-factor challenge is not a session yet.
      if (isTwoFactorChallenge(result)) return
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, result)
    },
  })
}

/** Exactly one of the two: a 6-digit authenticator code or an unused recovery code. */
export type TwoFactorChallengeInput = { code: string } | { recovery_code: string }

/** POST /auth/two-factor-challenge: second sign-in step after `two_factor_required`. */
export function useTwoFactorChallengeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: TwoFactorChallengeInput) => {
      await ensureCsrfCookie()
      return (await api.post<CurrentUser>('/auth/two-factor-challenge', input)).data
    },
    onSuccess: (me) => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, me)
    },
  })
}

export type RegisterInput = {
  organization_name: string
  branch_name?: string
  name: string
  email: string
  password: string
  password_confirmation: string
}

export function useRegisterMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      await ensureCsrfCookie()
      return (await api.post<CurrentUser>('/auth/register', input)).data
    },
    onSuccess: (me) => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, me)
    },
  })
}

export function useLogoutMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, null)
    },
  })
}

export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: async (input: { email: string }) => {
      await ensureCsrfCookie()
      return (await api.post<{ message: string }>('/auth/forgot-password', input)).data
    },
  })
}

export type ResetPasswordInput = { token: string; email: string; password: string; password_confirmation: string }

export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) => {
      await ensureCsrfCookie()
      return (await api.post<{ message: string }>('/auth/reset-password', input)).data
    },
  })
}
