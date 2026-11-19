import { readAttribution, touchFromUrl } from '../../landing/attribution'
import { zonedNow } from '../elements/store-hours'
import type { AudienceContext, Weekday } from './types'

/*
 * B13 §1: the browser's side of an audience context. Everything stays in this browser:
 * - `sf.visitor` (localStorage): when this store was first seen here (2 years). A visitor stays
 *   "new" for the whole first visit (sessionStorage `sf.visitor.new`), then is "returning";
 * - `sf.audience.district` (localStorage): the district last chosen at checkout or in an order form;
 * - the P2a campaign touch (`sf.attribution`).
 * Blocked storage: the visitor counts as new, no district, no campaign.
 */

export const VISITOR_KEY = 'sf.visitor'
export const VISITOR_SESSION_KEY = 'sf.visitor.new'
export const DISTRICT_KEY = 'sf.audience.district'
export const VISITOR_DAYS = 730
export const DEFAULT_TIMEZONE = 'Asia/Dhaka'

const DAY_MS = 86_400_000

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function read(store: Storage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(store: Storage | null, key: string, value: string): void {
  try {
    store?.setItem(key, value)
  } catch {
    // Blocked or full storage: ignored.
  }
}

/** This page load's answer (the first call decides, later calls agree). */
let decided: 'new' | 'returning' | null = null

/**
 * Whether this browser saw the store before this visit; marks the first visit. Called on every
 * store page view (the layout) and by audiences.
 */
export function visitorKind(now: number = Date.now()): 'new' | 'returning' {
  if (decided) return decided
  const store = local()
  const first = Number(read(store, VISITOR_KEY))
  const valid = Number.isFinite(first) && first > 0 && now - first <= VISITOR_DAYS * DAY_MS && first <= now + DAY_MS
  if (!valid) {
    write(store, VISITOR_KEY, String(now))
    write(session(), VISITOR_SESSION_KEY, '1')
    decided = 'new'
  } else decided = read(session(), VISITOR_SESSION_KEY) === '1' ? 'new' : 'returning'
  return decided
}

/** Test hook: decide again on the next call. */
export function resetVisitorKind(): void {
  decided = null
}

const DISTRICT = /^\d{1,9}$/

/** Keeps the district a shopper chose at checkout or in an order form (ids are integers). */
export function rememberDistrict(id: unknown): void {
  const text = typeof id === 'number' && Number.isInteger(id) ? String(id) : typeof id === 'string' ? id.trim() : ''
  if (DISTRICT.test(text)) write(local(), DISTRICT_KEY, text)
}

/** The district last chosen here, or null. */
export function rememberedDistrict(): string | null {
  const value = read(local(), DISTRICT_KEY)
  return value && DISTRICT.test(value) ? value : null
}

/**
 * The campaign touch of this visit (P2a), values lower-cased; null for a direct visit. The address
 * itself first (the arrival's touch is stored only after the page has drawn), then the stored touch.
 */
export function campaignTouch(now: Date = new Date()): AudienceContext['campaign'] {
  const here = typeof window === 'undefined' ? null : touchFromUrl(window.location, '', now)
  const touch = here ?? readAttribution(now)
  if (!touch) return null
  const lower = (value: string | undefined) => (value ? value.toLowerCase() : null)
  return { id: null, utm_source: lower(touch.utm_source), utm_campaign: lower(touch.utm_campaign), short_link: lower(touch.short_link) }
}

/** Weekday and "HH:MM" of an instant in the store's timezone (an unknown zone: Asia/Dhaka, then the browser's). */
export function storeDayTime(now: Date, timeZone: string | null | undefined): { day: Weekday; time: string } {
  const zoned = zonedNow(now, timeZone || DEFAULT_TIMEZONE) ?? zonedNow(now, DEFAULT_TIMEZONE)
  if (zoned) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return { day: zoned.day, time: `${pad(Math.floor(zoned.minutes / 60))}:${pad(zoned.minutes % 60)}` }
  }
  const days: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return { day: days[now.getDay()]!, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` }
}
