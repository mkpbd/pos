import type { PopupLayout, StorePopupSettings } from '../types'
import { isPopupBlockedPathname, isUnderPrefix } from '../validate'

/*
 * B8b popup rules evaluated in the browser (contract §1): which pages, devices and visitors a
 * popup is for, and how often it may show. The record of each popup lives in localStorage under
 * `sf.popup.<id>` ({shown, closes, acted}); once-per-session popups also mark sessionStorage.
 * Storage that throws (private mode, blocked site data) falls back to this page's memory, so a
 * popup then shows at most once per page load.
 */

const DAY_MS = 24 * 60 * 60 * 1000
export const POPUP_STORAGE_PREFIX = 'sf.popup.'
const SESSION_PREFIX = 'sf.popup.session.'

/** What this browser remembers of a popup: when it last showed, how often it was closed, when its visitor acted. */
export type PopupRecord = { shown: number | null; closes: number; acted: number | null }

const EMPTY: PopupRecord = { shown: null, closes: 0, acted: null }

const memory = new Map<string, PopupRecord>()
const sessionMemory = new Set<string>()

/** Tests only: forget what this page remembered. */
export function resetPopupRecords() {
  memory.clear()
  sessionMemory.clear()
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function parseRecord(raw: string | null): PopupRecord | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const v = value as Record<string, unknown>
    const time = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null)
    return { shown: time(v.shown), closes: typeof v.closes === 'number' && v.closes >= 0 ? Math.floor(v.closes) : 0, acted: time(v.acted) }
  } catch {
    return null
  }
}

/** The popup's record: storage when readable, else (or in addition) this page's memory. */
export function readPopupRecord(id: string): PopupRecord {
  let stored: PopupRecord | null = null
  try {
    stored = parseRecord(storage('local')?.getItem(POPUP_STORAGE_PREFIX + id) ?? null)
  } catch {
    stored = null
  }
  const mem = memory.get(id)
  if (!stored) return mem ?? EMPTY
  if (!mem) return stored
  return { shown: Math.max(stored.shown ?? 0, mem.shown ?? 0) || null, closes: Math.max(stored.closes, mem.closes), acted: stored.acted ?? mem.acted }
}

function writePopupRecord(id: string, record: PopupRecord) {
  memory.set(id, record)
  try {
    storage('local')?.setItem(POPUP_STORAGE_PREFIX + id, JSON.stringify(record))
  } catch {
    // Full or blocked storage: this page's memory still applies.
  }
}

function seenThisSession(id: string): boolean {
  if (sessionMemory.has(id)) return true
  try {
    return storage('session')?.getItem(SESSION_PREFIX + id) === '1'
  } catch {
    return false
  }
}

export function markPopupShown(id: string, now: number = Date.now()) {
  writePopupRecord(id, { ...readPopupRecord(id), shown: now })
  sessionMemory.add(id)
  try {
    storage('session')?.setItem(SESSION_PREFIX + id, '1')
  } catch {
    // Memory only.
  }
}

export function markPopupClosed(id: string) {
  const record = readPopupRecord(id)
  writePopupRecord(id, { ...record, closes: record.closes + 1 })
}

export function markPopupActed(id: string, now: number = Date.now()) {
  writePopupRecord(id, { ...readPopupRecord(id), acted: now })
}

/** Whether the frequency rule (and `stop_after_action`) lets the popup show again. */
export function isPopupDue(id: string, settings: Pick<StorePopupSettings, 'frequency' | 'stop_after_action'>, now: number = Date.now()): boolean {
  const record = readPopupRecord(id)
  if (settings.stop_after_action && record.acted !== null) return false
  switch (settings.frequency.kind) {
    case 'every_page_view':
      return true
    case 'once_per_session':
      return !seenThisSession(id)
    case 'once_every_days':
      return record.shown === null || now - record.shown >= settings.frequency.days * DAY_MS
    case 'once_forever':
      return record.shown === null
    default:
      return false
  }
}

/** Shop pages: the listings (shop, search, category, brand) and product pages. */
const SHOP_PREFIXES = ['/shop', '/search', '/category/', '/brand/', '/product/']

function isShopPath(pathname: string): boolean {
  return SHOP_PREFIXES.some((prefix) => (prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)))
}

/** Whether the popup is for this page (never on checkout, cart, account or order pages, whatever is set). */
export function matchesPage(settings: Pick<StorePopupSettings, 'pages'>, pathname: string, neverOn: readonly string[] = []): boolean {
  const path = pathname.toLowerCase()
  if (isPopupBlockedPathname(path, neverOn)) return false
  switch (settings.pages.kind) {
    case 'all':
      return true
    case 'home':
      return path === '/' || path === ''
    case 'shop':
      return isShopPath(path)
    case 'paths':
      // `/p/eid-sale` covers `/p/eid-sale` and below, not `/p/eid-sale-2`.
      return settings.pages.paths.some((prefix) => path === prefix || isUnderPrefix(path, [prefix.endsWith('/') ? prefix : `${prefix}/`]))
    default:
      return false
  }
}

/** Phones are narrower than 768 px (the builder's mobile breakpoint); everything wider counts as desktop. */
export const MOBILE_QUERY = '(max-width: 767.98px)'

export function matchesDevice(settings: Pick<StorePopupSettings, 'devices'>, mobile: boolean): boolean {
  return settings.devices === 'all' || (settings.devices === 'mobile') === mobile
}

/** `signedIn` null = not known yet: only `all` popups may show meanwhile. */
export function matchesAudience(settings: Pick<StorePopupSettings, 'audience'>, signedIn: boolean | null): boolean {
  if (settings.audience === 'all') return true
  if (signedIn === null) return false
  return settings.audience === 'signed_in' ? signedIn : !signedIn
}

/** Where a layout sits: one modal-like popup at a time, one bar per edge. */
export type PopupSlot = 'modal' | 'top' | 'bottom'

export function popupSlot(layout: PopupLayout): PopupSlot {
  if (layout === 'bar_top') return 'top'
  if (layout === 'bar_bottom') return 'bottom'
  return 'modal'
}

/** Modal and fullscreen popups take over the page (aria-modal); a slide-in does not. */
export function isModalLayout(layout: PopupLayout): boolean {
  return layout === 'modal' || layout === 'fullscreen'
}

/** A scope for a popup's compiled styles (`[a-z][a-z0-9-]{0,31}`). */
export function popupScope(id: string): string {
  return `popup-${id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`
}
