import { Navigate } from 'react-router'
import { homePath } from '@/app/navigation'
import { useAuth } from '@/features/auth/use-auth'

/**
 * "/" lands on the dashboard for roles that have it, the POS terminal for till staff, and
 * otherwise on the first page the user may open.
 */
export function HomeRedirect() {
  const me = useAuth()

  return <Navigate to={homePath(me)} replace />
}
