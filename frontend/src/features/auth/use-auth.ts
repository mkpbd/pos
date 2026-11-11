import { useCallback, useState } from 'react'
import { useCurrentUserQuery } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'

/**
 * Current user for components rendered inside RequireAuth (session guaranteed).
 *
 * Signing out clears the session synchronously while the navigation to /login still renders as a
 * transition, so for one render the signed-in screens (e.g. the account menu) can see no user
 * before RequireAuth unmounts them. They keep the last user for that render instead of throwing
 * (which React reported as "an error during concurrent rendering"). Permission checks (`useCan`)
 * always read the live session.
 */
export function useAuth(): CurrentUser {
  const { data } = useCurrentUserQuery()
  // "Storing information from previous renders" (react.dev): remember the last signed-in user.
  const [last, setLast] = useState<CurrentUser | null>(data ?? null)
  if (data && data !== last) setLast(data)
  const user = data ?? last
  if (!user) throw new Error('useAuth() used outside an authenticated route')
  return user
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
