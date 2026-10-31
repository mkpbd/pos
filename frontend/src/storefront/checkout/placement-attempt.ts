import { ApiError } from '@/lib/api/client'

/**
 * The Idempotency-Key of "Place order" (ADR-014): one key per placement attempt.
 *
 * - Pressing the button again after an answer that leaves the outcome open (lost connection,
 *   time-out, 5xx, "still processing") retries the same attempt with the same key, so an order
 *   the server did place is replayed instead of placed twice.
 * - Any change of the order body (address, delivery, payment, contact, notes, the confirmed
 *   total) starts a new attempt with a new key.
 * - A definite answer (an order, or a 4xx such as TOTAL_CHANGED or a field error) ends the
 *   attempt; the next press is a new attempt even when nothing was changed.
 */
export class PlacementAttempts {
  private current: { fingerprint: string; key: string } | null = null
  private readonly newKey: () => string

  constructor(newKey: () => string = () => crypto.randomUUID()) {
    this.newKey = newKey
  }

  /** The key for placing this body: the open attempt's key when the body is unchanged. */
  keyFor(body: unknown): string {
    const fingerprint = stableStringify(body)
    if (this.current?.fingerprint !== fingerprint) this.current = { fingerprint, key: this.newKey() }
    return this.current.key
  }

  /** Records how the attempt ended: only an open outcome keeps its key for a retry. */
  settle(error?: unknown): void {
    if (error === undefined || !isOpenOutcome(error)) this.current = null
  }

  /** Starts over (the visitor left the page or the order was placed). */
  reset(): void {
    this.current = null
  }

  get pendingKey(): string | null {
    return this.current?.key ?? null
  }
}

/** True when the server may or may not have placed the order: retry with the same key. */
export function isOpenOutcome(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  if (error.status === 0 || error.status >= 500) return true
  return error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS' || error.code === 'INVALID_RESPONSE'
}

/** JSON with object keys sorted, so equal bodies give equal fingerprints. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return v
  })
}
