/*
 * P2a campaign attribution. A visitor who arrives with UTM parameters or a short link (`sl=<code>`,
 * added by GET /go/{code}) is remembered for 30 days in localStorage: the last such touch wins
 * (an arrival without them changes nothing), and nothing is stored for a direct visit. The
 * attribution goes with every checkout (cart and order form) as `attribution`; the server
 * validates, trims and keeps it on the order. Storage that is blocked or full is ignored.
 */

export const ATTRIBUTION_KEY = 'sf.attribution'
export const ATTRIBUTION_DAYS = 30

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = (typeof UTM_KEYS)[number]

/** What the order receives (POST /store/checkout and /store/checkout/direct `attribution`). */
export type Attribution = Partial<Record<UtmKey, string>> & {
  /** The short link's code. */
  short_link?: string
  /** The store path the visitor first landed on (no query string). */
  landing_path?: string
  /** The host of the site that sent the visitor (another site only). */
  referrer_host?: string
  /** When this touch happened (ISO 8601). */
  first_seen_at: string
}

/** Longest value kept per field (the server trims again). */
const MAX = { utm: 100, path: 255, host: 255 }

/** A short link code: lower case letters, digits and dashes, 3–32 (contract §4). */
export const SHORT_LINK_CODE = /^[a-z0-9-]{3,32}$/

const DAY_MS = 86_400_000

function clean(value: string | null | undefined, max: number): string | undefined {
  // Control characters are dropped; the rest is plain text (never HTML).
  // eslint-disable-next-line no-control-regex
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return text ? text.slice(0, max) : undefined
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * The touch of an arrival: its UTM parameters, short link code, landing path and the other site
 * that sent the visitor; null when the URL has neither UTM parameters nor a short link.
 */
export function touchFromUrl(location: { pathname: string; search: string; host: string }, referrer: string, now: Date = new Date()): Attribution | null {
  const params = new URLSearchParams(location.search)
  const touch: Attribution = { first_seen_at: now.toISOString() }
  let found = false
  for (const key of UTM_KEYS) {
    const value = clean(params.get(key), MAX.utm)
    if (value) {
      touch[key] = value
      found = true
    }
  }
  const code = (params.get('sl') ?? '').trim().toLowerCase()
  if (SHORT_LINK_CODE.test(code)) {
    touch.short_link = code
    found = true
  }
  if (!found) return null
  const path = clean(location.pathname, MAX.path)
  if (path && path.startsWith('/')) touch.landing_path = path
  const referrerHost = referrer ? hostOf(referrer) : null
  if (referrerHost && referrerHost !== location.host.toLowerCase()) touch.referrer_host = referrerHost.slice(0, MAX.host)
  return touch
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Keeps a touch (it replaces the one before: last non-direct touch wins). */
export function rememberTouch(touch: Attribution): void {
  try {
    storage()?.setItem(ATTRIBUTION_KEY, JSON.stringify(touch))
  } catch {
    // Blocked or full storage: this visit is simply not attributed.
  }
}

/** The stored fields, checked again (the value may have been edited by hand). */
function parseStored(raw: unknown): Attribution | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const captured = typeof value.first_seen_at === 'string' ? Date.parse(value.first_seen_at) : NaN
  if (!Number.isFinite(captured)) return null
  const out: Attribution = { first_seen_at: new Date(captured).toISOString() }
  let found = false
  for (const key of UTM_KEYS) {
    const text = typeof value[key] === 'string' ? clean(value[key] as string, MAX.utm) : undefined
    if (text) {
      out[key] = text
      found = true
    }
  }
  if (typeof value.short_link === 'string' && SHORT_LINK_CODE.test(value.short_link)) {
    out.short_link = value.short_link
    found = true
  }
  if (!found) return null
  if (typeof value.landing_path === 'string' && value.landing_path.startsWith('/')) out.landing_path = clean(value.landing_path, MAX.path)
  if (typeof value.referrer_host === 'string') out.referrer_host = clean(value.referrer_host, MAX.host)
  return out
}

/** The attribution to send with an order: the last touch of the past 30 days, or null. */
export function readAttribution(now: Date = new Date()): Attribution | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(ATTRIBUTION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: Attribution | null = null
  try {
    parsed = parseStored(JSON.parse(raw))
  } catch {
    parsed = null
  }
  if (!parsed || now.getTime() - Date.parse(parsed.first_seen_at) > ATTRIBUTION_DAYS * DAY_MS || Date.parse(parsed.first_seen_at) > now.getTime() + DAY_MS) {
    try {
      store.removeItem(ATTRIBUTION_KEY)
    } catch {
      // ignore
    }
    return null
  }
  return parsed
}

/** Records the touch of this URL, when it is one; returns it. */
export function captureTouch(location: { pathname: string; search: string; host: string }, referrer: string, now: Date = new Date()): Attribution | null {
  const touch = touchFromUrl(location, referrer, now)
  if (touch) rememberTouch(touch)
  return touch
}
