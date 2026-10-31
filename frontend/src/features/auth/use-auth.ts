import { useCallback } from 'react'
import { useCurrentUserQuery } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'

/**
 * Current user for components rendered inside RequireAuth (session guaranteed).
 */
export function useAuth(): CurrentUser {
  const { data } = useCurrentUserQuery()
  if (!data) throw new Error('useAuth() used outside an authenticated route')
  return data
}

/**
 * Permission check mirroring the backend Gate: platform admins pass everything.
 * UI hiding only — the API enforces every permission independently.
 */
export function useCan(): (permission: string) => boolean {
  const { data } = useCurrentUserQuery()

  return useCallback(
    (permission: string) => !!data && (data.user.is_platform_admin || data.permissions.includes(permission)),
    [data],
  )
}
