import type { PopupFrequency, StorePopup } from '../types'

const PREFIX = 'sf-popup:'
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MS: Record<Exclude<PopupFrequency, 'once_per_session'>, number> = { once_per_day: DAY_MS, once_per_week: 7 * DAY_MS }

/**
 * When each popup was last shown in this page's lifetime. Used when the browser refuses
 * storage (private mode, blocked site data), so a visitor still sees a popup at most once
 * per visit instead of on every page.
 */
const memory = new Map<string, number>()

/** Tests only: forget what this page has shown. */
export function resetPopupMemory() {
  memory.clear()
}

/** Keyed by banner id and its last edit, so an edited popup counts as new. */
export function popupStorageKey(popup: Pick<StorePopup, 'id' | 'updated_at'>): string {
  return `${PREFIX}${popup.id}:${popup.updated_at ?? ''}`
}

/** Once per session uses sessionStorage; the timed frequencies use localStorage. Null when the browser refuses access. */
function storageFor(frequency: PopupFrequency): Storage | null {
  try {
    return frequency === 'once_per_session' ? window.sessionStorage : window.localStorage
  } catch {
    return null
  }
}

function lastShown(popup: StorePopup): number | null {
  const key = popupStorageKey(popup)
  let last = memory.get(key) ?? null
  try {
    const raw = storageFor(popup.frequency)?.getItem(key)
    const stored = raw ? Number(raw) : NaN
    if (Number.isFinite(stored)) last = Math.max(last ?? 0, stored)
  } catch {
    // Unreadable storage: rely on this page's memory.
  }
  return last
}

/** Whether the popup is due under its frequency rule. */
export function isPopupDue(popup: StorePopup, now: number = Date.now()): boolean {
  const last = lastShown(popup)
  if (last === null) return true
  if (popup.frequency === 'once_per_session') return false
  const period = PERIOD_MS[popup.frequency] ?? DAY_MS
  return now - last >= period
}

/** Remember that the popup was shown now (and drop records of its earlier versions). */
export function markPopupShown(popup: StorePopup, now: number = Date.now()) {
  const key = popupStorageKey(popup)
  memory.set(key, now)
  const storage = storageFor(popup.frequency)
  if (!storage) return
  try {
    const stale: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i)
      if (k && k !== key && k.startsWith(`${PREFIX}${popup.id}:`)) stale.push(k)
    }
    stale.forEach((k) => storage.removeItem(k))
    storage.setItem(key, String(now))
  } catch {
    // Full or blocked storage: the in-memory record still applies to this visit.
  }
}

/** Pages where a popup would get in the way of buying or account tasks. */
export function isPopupBlockedPath(pathname: string): boolean {
  return /^\/(checkout|cart|account)(\/|$)/.test(pathname)
}

/** The configured delay in milliseconds, kept within 0–60 s. */
export function popupDelayMs(popup: Pick<StorePopup, 'delay_seconds'>): number {
  const seconds = Number(popup.delay_seconds)
  return Number.isFinite(seconds) ? Math.min(60, Math.max(0, seconds)) * 1000 : 5000
}
