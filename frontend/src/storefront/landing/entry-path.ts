import type { StorefrontBootstrap } from '../types'

/*
 * P2a campaign address: a storefront domain may open on an entry page (`entry_path`, e.g.
 * `/p/eid-sale`). Visiting that host's `/` shows that page; the rest of the store works as usual.
 */

const LANDING = /^\/p\/([a-z0-9-]{2,60})\/?$/
const STORE_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~/%]*$/

/** The host's entry page path from the bootstrap, when it is a safe store path other than `/`. */
export function entryPathOf(bootstrap: Pick<StorefrontBootstrap, 'entry_path'>): string | null {
  const value: unknown = bootstrap.entry_path
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (path === '' || path === '/' || path.length > 255 || !STORE_PATH.test(path) || path.includes('..')) return null
  return path
}

/** The landing page slug of an entry path (`/p/eid-sale` → `eid-sale`), else null. */
export function landingSlugOf(path: string): string | null {
  const match = LANDING.exec(path)
  return match && match[1] !== 'home' ? match[1]! : null
}
