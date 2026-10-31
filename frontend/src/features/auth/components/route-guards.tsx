import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Loader2Icon, ShieldXIcon } from 'lucide-react'
import { ErrorState } from '@/components/common/state-views'
import { useCurrentUserQuery } from '@/features/auth/api'
import { useCan } from '@/features/auth/use-auth'
import { useSessionStore } from '@/stores/session-store'

function FullScreenLoader() {
  return (
    <div role="status" aria-label="Loading session" className="flex min-h-svh items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}

/**
 * Renders child routes only for an authenticated session; otherwise redirects to /login
 * and comes back afterwards. Also keeps the active branch valid for this user.
 */
export function RequireAuth() {
  const location = useLocation()
  const { data, isPending, error, refetch } = useCurrentUserQuery()
  const activeBranchId = useSessionStore((s) => s.activeBranchId)
  const setActiveBranch = useSessionStore((s) => s.setActiveBranch)

  const usableBranches = data?.branches.filter((b) => b.is_active) ?? []
  const fallbackBranchId = usableBranches[0]?.id ?? null
  const branchIsValid = activeBranchId === null ? fallbackBranchId === null : usableBranches.some((b) => b.id === activeBranchId)

  useEffect(() => {
    if (data && !branchIsValid) setActiveBranch(fallbackBranchId)
  }, [data, branchIsValid, fallbackBranchId, setActiveBranch])

  // Hold rendering until the branch sent in X-Branch-Id is one the server will accept.
  if (isPending || (data && !branchIsValid)) return <FullScreenLoader />
  if (error) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState title="Could not load your session" error={error} onRetry={() => refetch()} />
      </div>
    )
  }
  if (!data) {
    const redirect = location.pathname + location.search
    return <Navigate to={`/login${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} replace />
  }

  return <Outlet />
}

/** Login/register pages: signed-in users are sent to the app. */
export function GuestOnly() {
  const { data, isPending } = useCurrentUserQuery()

  if (isPending) return <FullScreenLoader />
  if (data) return <Navigate to="/" replace />

  return <Outlet />
}

function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <ShieldXIcon className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="font-heading text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">{reason}</p>
    </div>
  )
}

/** Route-level permission gate. The API enforces the same permission. */
export function RequirePermission({ permission }: { permission: string }) {
  const can = useCan()

  return can(permission) ? <Outlet /> : <AccessDenied reason={`Your role does not include the “${permission}” permission.`} />
}

export function RequirePlatformAdmin() {
  const { data } = useCurrentUserQuery()

  return data?.user.is_platform_admin ? <Outlet /> : <AccessDenied reason="Only platform administrators can open this page." />
}
