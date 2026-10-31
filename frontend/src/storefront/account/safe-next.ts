/**
 * Where to go after signing in: the `?next=` path, accepted only when it is a relative path
 * on this storefront. Absolute and protocol-relative URLs ("https://evil.test", "//evil.test",
 * "/\\evil.test"), other schemes ("javascript:"), control characters and the paths served by
 * Laravel or the back office are refused (open-redirect protection).
 */
const BASE = 'https://storefront.invalid'
const FOREIGN_PREFIXES = ['/api', '/admin', '/sanctum', '/storage']

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  if ([...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  if (FOREIGN_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** The sign-in page for a page that needs an account, remembering where to come back to. */
export function loginPathFor(pathWithSearch: string): string {
  const next = safeNextPath(pathWithSearch)
  return next && next !== '/account' ? `/account/login?next=${encodeURIComponent(next)}` : '/account/login'
}
