import type { WebVitals } from './types'

/*
 * B15 real-user Web Vitals with the browser's own PerformanceObserver (no library): Largest
 * Contentful Paint, Cumulative Layout Shift (the worst 5 s session window) and Interaction to Next
 * Paint (the worst interaction; one outlier is skipped per 50 interactions). They describe the
 * page load, so only a page view at the address the page was loaded at reports them, once (a page
 * view after an in-app navigation sends none). The observers run for the rest of the load.
 * Browsers without an entry type simply report nothing for that metric.
 */

type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean }
type EventEntry = PerformanceEntry & { interactionId?: number; duration: number }
type LcpEntry = PerformanceEntry & { renderTime?: number; loadTime?: number }

function observe(type: string, callback: (entries: PerformanceEntry[]) => void, options: Record<string, unknown> = {}): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined') return null
  const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes
  if (supported && !supported.includes(type)) return null
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()))
    observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit)
    return observer
  } catch {
    return null
  }
}

/** The CLS of a list of layout shifts: the largest session window (gaps < 1 s, at most 5 s long). */
export function clsOf(shifts: readonly { startTime: number; value: number }[]): number {
  let worst = 0
  let current = 0
  let first = -Infinity
  let last = -Infinity
  for (const shift of shifts) {
    if (shift.startTime - last < 1000 && shift.startTime - first < 5000) {
      current += shift.value
    } else {
      current = shift.value
      first = shift.startTime
    }
    last = shift.startTime
    worst = Math.max(worst, current)
  }
  return worst
}

/** INP of the interactions' longest durations: the worst, skipping one outlier per 50 interactions. */
export function inpOf(durations: readonly number[]): number | null {
  if (durations.length === 0) return null
  const sorted = [...durations].sort((a, b) => b - a)
  return sorted[Math.min(sorted.length - 1, Math.floor(durations.length / 50))]!
}

export type VitalsMeter = { read: () => WebVitals | null; stop: () => void }

/** The address the document was loaded at: vitals belong to a page view of that address only. */
const loadPath = typeof window === 'undefined' ? null : window.location.pathname
let meter: { read: () => WebVitals | null } | null = null
let taken = false

/** Test helper: forget this load's meter (the next page view measures again). */
export function resetVitalsMemory(): void {
  meter = null
  taken = false
}

/**
 * The vitals of this page load for a page view at `path`: started once per load (buffered entries
 * cover what happened before), read once — the first final batch takes them, later ones get null.
 * A page view after an in-app navigation (another address) gets null.
 */
export function vitalsFor(path: string): VitalsMeter | null {
  if (taken || path !== loadPath) return null
  meter ??= startMeter()
  const current = meter
  return {
    read() {
      if (taken) return null
      taken = true
      return current.read()
    },
    stop() {},
  }
}

function startMeter(): { read: () => WebVitals | null } {
  let lcp: number | null = null
  let lcpFinal = false
  const shifts: { startTime: number; value: number }[] = []
  const interactions = new Map<number, number>()
  const shiftSupported = observe('layout-shift', (entries) => {
    for (const entry of entries as ShiftEntry[]) if (!entry.hadRecentInput) shifts.push({ startTime: entry.startTime, value: entry.value })
  })

  observe('largest-contentful-paint', (entries) => {
    if (lcpFinal) return
    const last = entries.at(-1) as LcpEntry | undefined
    if (last) lcp = last.renderTime || last.loadTime || last.startTime
  })
  observe(
    'event',
    (entries) => {
      for (const entry of entries as EventEntry[]) {
        if (!entry.interactionId) continue
        // LCP is final once the visitor interacts.
        lcpFinal = true
        interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration))
      }
    },
    { durationThreshold: 40 },
  )
  observe('first-input', (entries) => {
    for (const entry of entries as EventEntry[]) {
      lcpFinal = true
      if (entry.interactionId && !interactions.has(entry.interactionId)) interactions.set(entry.interactionId, entry.duration)
    }
  })

  return {
    read() {
      const out: WebVitals = {}
      if (lcp !== null && lcp > 0) out.lcp_ms = Math.round(lcp)
      if (shiftSupported) out.cls = Math.round(clsOf(shifts) * 10_000) / 10_000
      const inp = inpOf([...interactions.values()])
      if (inp !== null) out.inp_ms = Math.round(inp)
      return Object.keys(out).length > 0 ? out : null
    },
  }
}
