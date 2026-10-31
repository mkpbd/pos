import { useState } from 'react'
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { ApiError } from '@/lib/api/client'
import { useMeQuery } from './api'
import { Spinner, primaryButtonClass } from './form-controls'
import { loginPathFor, safeNextPath } from './safe-next'

/** Account pages: guests go to the sign-in page, which brings them back here afterwards. */
export function RequireCustomer() {
  const me = useMeQuery()
  const location = useLocation()
  // Signing out (or a session ending) on an account page leads home, not to the sign-in page.
  const [seenCustomer, setSeenCustomer] = useState(false)
  if (me.data && !seenCustomer) setSeenCustomer(true)

  if (me.isPending) return <Spinner label="Loading your account" />
  if (me.error && !(me.error instanceof ApiError && me.error.status < 500)) {
    return (
      <section className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Your account could not be loaded</h1>
        <p className="mt-2">Check your connection and try again.</p>
        <button type="button" className={`${primaryButtonClass} mt-4`} disabled={me.isFetching} onClick={() => void me.refetch()}>
          Try again
        </button>
      </section>
    )
  }
  if (!me.data) return <Navigate to={seenCustomer ? '/' : loginPathFor(`${location.pathname}${location.search}`)} replace />
  return <Outlet />
}

/** Sign-in, registration and password pages: a signed-in customer goes on to `?next=` or the account. */
export function GuestOnly() {
  const me = useMeQuery()
  const [params] = useSearchParams()

  if (me.isPending) return <Spinner label="Loading" />
  if (me.data) return <Navigate to={safeNextPath(params.get('next')) ?? '/account'} replace />
  return <Outlet />
}
