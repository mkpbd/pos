import { Navigate } from 'react-router'
import { visibleNavItems } from '@/app/navigation'
import { useAuth } from '@/features/auth/use-auth'

/**
 * "/" lands on the first page the user may open. Replaced by the dashboard in Phase 7.
 */
export function HomeRedirect() {
  const me = useAuth()
  const first = visibleNavItems(me)[0]

  return <Navigate to={first?.to ?? '/profile'} replace />
}
