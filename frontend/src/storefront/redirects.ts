import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { storeApi } from './http'

/*
 * B16 §5: the store's redirects on client-side navigation. On a full page load the storefront
 * shell already answers a redirected address with a real 301 / 302. When the SPA itself ends on
 * "Page not found" (a link inside the store, a product or page whose address changed), it asks
 * GET /store/redirects/resolve?path= once per path (cached here and by HTTP for 60 s) and replaces
 * the location with the new address, so Back does not return to the dead one.
 */

export type RedirectTarget = { to: string; type: 301 | 302 }

export const redirectResolveKey = (path: string) => ['store', 'redirects', 'resolve', path] as const

export function fetchRedirect(path: string, signal?: AbortSignal): Promise<RedirectTarget | null> {
  // `lang: undefined` keeps the language out of the URL: a redirect is the same in every language (one HTTP cache entry).
  return storeApi.get<RedirectTarget | null>('/store/redirects/resolve', { signal, query: { path, lang: undefined } }).then((r) => (r.data && typeof r.data.to === 'string' && r.data.to !== '' ? r.data : null))
}

/** Where to go: a path of this store (`/p/new?x=1#y`) or a full address of another site; null when it leads back here. */
export function redirectDestination(target: string, current: { pathname: string; search: string; hash: string }, origin: string): { internal: string } | { external: string } | null {
  let internal: string
  if (/^https?:\/\//i.test(target)) {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      return null
    }
    if (url.origin !== origin) return { external: url.toString() }
    internal = `${url.pathname}${url.search}${url.hash}`
  } else if (target.startsWith('/') && !target.startsWith('//')) {
    internal = target
  } else {
    return null
  }
  // The shopper's query (tracking tags, filters) and anchor carry over unless the redirect sets its own.
  const [withoutHash = internal, ownHash] = internal.split('#', 2) as [string, string | undefined]
  const [pathname = withoutHash, ownSearch] = withoutHash.split('?', 2) as [string, string | undefined]
  const search = ownSearch !== undefined ? `?${ownSearch}` : current.search
  const hash = ownHash !== undefined ? `#${ownHash}` : current.hash
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  if (trim(pathname) === trim(current.pathname)) return null
  return { internal: `${pathname}${search}${hash}` }
}

/** Paths left by a client redirect in the last moments: a second hop from the same path is not followed (no ping-pong). */
const recentHops = new Map<string, number>()
const HOP_WINDOW_MS = 5000

function recentlyLeft(path: string): boolean {
  const at = recentHops.get(path)
  return at !== undefined && Date.now() - at <= HOP_WINDOW_MS
}

function rememberHop(path: string) {
  const now = Date.now()
  for (const [key, at] of recentHops) if (now - at > HOP_WINDOW_MS) recentHops.delete(key)
  recentHops.set(path, now)
}

/** Test helper: forget the recent hops. */
export function resetRedirectHops() {
  recentHops.clear()
}

/**
 * On the 404 page: `checking` while the redirect is looked up or followed, `none` when the
 * address has no redirect (or the lookup failed) and "Page not found" should show.
 */
export function useNotFoundRedirect(): 'checking' | 'none' {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname
  const query = useQuery({
    queryKey: redirectResolveKey(path),
    // No abort signal: a lookup finishes even if the page goes away, so a remount (or React's
    // development double mount) reuses it instead of asking again.
    queryFn: () => fetchRedirect(path),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const target = query.data?.to ?? null
  const destination = target ? redirectDestination(target, location, window.location.origin) : null
  const follow = destination !== null && !recentlyLeft(path)
  const internal = follow && 'internal' in destination ? destination.internal : null
  const external = follow && 'external' in destination ? destination.external : null

  useEffect(() => {
    if (internal === null && external === null) return
    if (recentlyLeft(path)) return
    rememberHop(path)
    if (external !== null) window.location.replace(external)
    else if (internal !== null) void navigate(internal, { replace: true })
  }, [internal, external, path, navigate])

  return query.isPending || follow ? 'checking' : 'none'
}
