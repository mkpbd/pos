import type { StorefrontBootstrap } from '../types'

/** Set on <html> while the assistant's chat button shows: the footer and share rows keep its corner free (storefront.css). */
export const ASSISTANT_ATTRIBUTE = 'data-sf-assistant'

/**
 * A staff view where the shopper assistant never shows: a draft or section preview (`?preview=…`, or a
 * preview bootstrap), anything under /admin (the builder canvas), or the store framed inside another page
 * (an editor preview). Without a window: hidden.
 */
export function isPreviewContext(location: Pick<Location, 'pathname' | 'search'> | undefined = typeof window === 'undefined' ? undefined : window.location): boolean {
  if (!location) return true
  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) return true
  if (new URLSearchParams(location.search).has('preview')) return true
  try {
    return window.self !== window.top
  } catch {
    // A cross-origin parent: framed.
    return true
  }
}

/** The chat button shows only when the store's assistant is on (the bootstrap's effective switch) and this is no preview. */
export function assistantEnabled(bootstrap: StorefrontBootstrap, location?: Pick<Location, 'pathname' | 'search'>): boolean {
  return bootstrap.assistant?.enabled === true && !bootstrap.preview && !isPreviewContext(location)
}
