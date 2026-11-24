/*
 * P2a campaign attribution. A visitor who arrives with UTM parameters or a short link (`sl=<code>`,
 * added by GET /go/{code}) is remembered for 30 days in localStorage: the last such touch wins
 * (an arrival without them changes nothing), and nothing is stored for a direct visit. The
 * attribution goes with every checkout (cart and order form) as `attribution`; the server
 * validates, trims and keeps it on the order. Storage that is blocked or full is ignored.
 */

import type { WithBuilderAttribution } from '../insights/types'

export const ATTRIBUTION_KEY = 'sf.attribution'
export const ATTRIBUTION_DAYS = 30

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = (typeof UTM_KEYS)[number]

/** BD1c: ad click ids, kept so the server can pass them on to the ad platforms (Conversions API). */
export const CLICK_KEYS = ['fbclid', 'gclid', 'ttclid'] as const
export type ClickKey = (typeof CLICK_KEYS)[number]
const CLICK_ID = /^[A-Za-z0-9._-]{1,200}$/

/** What the order receives (POST /store/checkout and /store/checkout/direct `attribution`). */
export type Attribution = Partial<Record<UtmKey, string>> & Partial<Record<ClickKey, string>> & {
  /** The short link's code. */
  short_link?: string
  /** The store path the visitor first landed on (no query string). */
  landing_path?: string
  /** The host of the site that sent the visitor (another site only). */
  referrer_host?: string
  /** When this touch happened (ISO 8601). */
  first_seen_at: string
}

/** What an order's `attribution` holds: P2a's touch fields (absent without a campaign) plus B15's `builder`. */
export type OrderAttribution = Partial<Attribution> & WithBuilderAttribution

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

/** BD1c: the ad click ids of a URL's query (`fbclid`, `gclid`, `ttclid`). */
export function clickIdsFrom(params: URLSearchParams): Partial<Record<ClickKey, string>> {
  const ids: Partial<Record<ClickKey, string>> = {}
  for (const key of CLICK_KEYS) {
    const value = (params.get(key) ?? '').trim()
    if (CLICK_ID.test(value)) ids[key] = value
  }
  return ids
}

/**
 * The touch of an arrival: its UTM parameters, short link code, landing path and the other site
 * that sent the visitor (plus its ad click ids, BD1c); null when the URL has neither UTM parameters
 * nor a short link.
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
  Object.assign(touch, clickIdsFrom(params))
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
  for (const key of CLICK_KEYS) {
    const id = value[key]
    if (typeof id === 'string' && CLICK_ID.test(id)) out[key] = id
  }
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

/** Records the touch of this URL, when it is one; returns it. BD1c: ad click ids are kept apart. */
export function captureTouch(location: { pathname: string; search: string; host: string }, referrer: string, now: Date = new Date()): Attribution | null {
  const touch = touchFromUrl(location, referrer, now)
  if (touch) rememberTouch(touch)
  rememberClickIds(clickIdsFrom(new URLSearchParams(location.search)), now)
  return touch
}

/** BD1c: where an ad click's ids are kept (apart from the campaign touch: a click alone is no campaign). */
export const CLICK_IDS_KEY = 'sf.click-ids'

function rememberClickIds(ids: Partial<Record<ClickKey, string>>, now: Date): void {
  if (Object.keys(ids).length === 0) return
  try {
    storage()?.setItem(CLICK_IDS_KEY, JSON.stringify({ ...ids, at: now.toISOString() }))
  } catch {
    // Blocked or full storage: the ids are simply not passed on.
  }
}

/** The ad click ids of the past 30 days (the last click wins). */
export function readClickIds(now: Date = new Date()): Partial<Record<ClickKey, string>> {
  try {
    const raw = JSON.parse(storage()?.getItem(CLICK_IDS_KEY) ?? 'null') as Record<string, unknown> | null
    const at = typeof raw?.at === 'string' ? Date.parse(raw.at) : NaN
    if (!raw || !Number.isFinite(at) || now.getTime() - at > ATTRIBUTION_DAYS * DAY_MS) return {}
    const ids: Partial<Record<ClickKey, string>> = {}
    for (const key of CLICK_KEYS) if (typeof raw[key] === 'string' && CLICK_ID.test(raw[key] as string)) ids[key] = raw[key] as string
    return ids
  } catch {
    return {}
  }
}

/**
 * What an order sends as `attribution`: the campaign touch (readAttribution) with the ad click ids of
 * the past 30 days added (BD1c — the server passes them to the Conversions API); click ids alone are
 * sent without a campaign (the server keeps no campaign for them).
 */
export function orderAttribution(now: Date = new Date()): Attribution | null {
  const touch = readAttribution(now)
  const ids = readClickIds(now)
  if (touch) return { ...ids, ...touch }
  return Object.keys(ids).length > 0 ? { ...ids, first_seen_at: now.toISOString() } : null
}
