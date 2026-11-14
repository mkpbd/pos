import { storeApi } from '../http'
import { UTM_KEYS, type Attribution, type UtmKey } from './attribution'

/*
 * P2a campaign visits: POST /store/visits counts a visit to a campaign (an arrival with UTM
 * parameters or a short link) or to a landing page, once per browser session and touch. Nothing
 * personal is sent; the server counts unique visitors with a salted daily hash and ignores bots.
 * A failed ping is ignored (counting must never get in the shopper's way).
 */

export type VisitPing = Partial<Record<UtmKey, string>> & { path: string; code?: string; referrer_host?: string }

const SESSION_PREFIX = 'sf.visit:'

/** Landing pages (`/p/<slug>`) count their visits even without a campaign. */
export function isLandingPath(path: string): boolean {
  return /^\/p\/[a-z0-9-]{2,60}\/?$/.test(path)
}

/** The ping of a page view: for a fresh touch, or a landing page; null otherwise. */
export function visitFor(path: string, touch: Attribution | null): VisitPing | null {
  if (!touch && !isLandingPath(path)) return null
  const ping: VisitPing = { path }
  if (touch) {
    for (const key of UTM_KEYS) if (touch[key]) ping[key] = touch[key]
    if (touch.short_link) ping.code = touch.short_link
    if (touch.referrer_host) ping.referrer_host = touch.referrer_host
  }
  return ping
}

function sessionKey(ping: VisitPing): string {
  return SESSION_PREFIX + [ping.path, ping.utm_source ?? '', ping.utm_medium ?? '', ping.utm_campaign ?? '', ping.code ?? ''].join('|')
}

/** In-memory fallback when sessionStorage is blocked (once per page load). */
const sentThisLoad = new Set<string>()

/** Whether this ping was already sent in this session; marks it sent. */
export function markVisitSent(ping: VisitPing): boolean {
  const key = sessionKey(ping)
  if (sentThisLoad.has(key)) return true
  sentThisLoad.add(key)
  try {
    if (window.sessionStorage.getItem(key)) return true
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Blocked storage: the in-memory record above keeps it to once per load.
  }
  return false
}

/** Test helper: forget the pings sent in this page load. */
export function resetVisitMemory(): void {
  sentThisLoad.clear()
}

/** Sends the ping once per session (fire and forget). */
export function sendVisit(ping: VisitPing): void {
  if (markVisitSent(ping)) return
  storeApi.post('/store/visits', ping).catch(() => {
    // Not counted: never shown to the shopper.
  })
}
