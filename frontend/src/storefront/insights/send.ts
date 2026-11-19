import { API_BASE } from '@/lib/api/client'
import { INSIGHTS_PATH, type InsightsBeacon } from './types'

/*
 * Sends one insights batch so that it survives the page closing: navigator.sendBeacon, else fetch
 * with keepalive. The fallback sends no cookies (`credentials: 'omit'`); the endpoint needs neither a
 * session nor a CSRF token. Failures are ignored — counting must never get in the shopper's way.
 */

export const INSIGHTS_URL = `${API_BASE}${INSIGHTS_PATH}`

export function sendBeaconPayload(beacon: InsightsBeacon): void {
  const body = JSON.stringify(beacon)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(INSIGHTS_URL, new Blob([body], { type: 'application/json' }))) return
  } catch {
    // Some browsers refuse a JSON beacon: fall through to fetch.
  }
  if (typeof fetch !== 'function') return
  try {
    void fetch(INSIGHTS_URL, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }).catch(() => {})
  } catch {
    // ignore
  }
}
