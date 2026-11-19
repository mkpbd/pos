import { NODE_ID } from '../builder/registry'
import type { Device } from '../builder/types'
import { MAX_EVENTS_PER_BEACON, type InsightEvent, type InsightsBeacon, type ScrollStep } from './types'
import type { VitalsMeter } from './vitals'

/*
 * B15 §1: what one page view of a published builder page counts, batched into beacons.
 * - Section views: a top-level section counts once per page view when at least half of it (or, for a
 *   section taller than the screen, half the screen) is visible for 1 s while the page is shown.
 * - Clicks: every click inside a section, with its position inside the section (0–1) for the heat
 *   map and the element clicked; at most one per 300 ms and 300 per page view.
 * - Scroll: the deepest step (0/25/50/75/100 %) of the builder page reached.
 * - Clicks toward a product (a product link, or a button of an element that sells) are reported to
 *   `onTowardProduct` (§2 attribution).
 * Batches: every 15 s (when there is something new), as soon as 50 events wait, and when the page
 * is hidden or left; the first batch of the page view has `seq: 0`, and the first one sent on
 * hiding carries the scroll depth and the Web Vitals (once per page view).
 */

export const VIEW_DWELL_MS = 1000
export const FLUSH_INTERVAL_MS = 15_000
export const CLICK_THROTTLE_MS = 300
export const MAX_CLICKS_PER_VIEW = 300
const VIEW_RATIO = 0.5
/** Most batches one flush sends (the rest waits; a page view stays small). */
const MAX_BEACONS_PER_FLUSH = 4

export type CollectorOptions = {
  root: HTMLElement
  documentId: string
  version: number
  path: string
  device: Device
  send: (beacon: InsightsBeacon) => void
  vitals?: VitalsMeter | null
  onTowardProduct?: (sectionId: string) => void
  now?: () => number
}

export type PageCollector = {
  /** Observes the top-level sections now in the root (call again after they change). */
  scan: () => void
  /** Sends what waits; `final` (hidden / left) adds the scroll depth and vitals the first time. */
  flush: (final: boolean) => void
  /** The page is hidden or shown again (dwell timers pause while hidden). */
  setHidden: (hidden: boolean) => void
  /** Sends the last batch and stops everything. */
  destroy: () => void
}

/** 0/25/50/75/100: the share of the element's height above the bottom of the viewport. */
export function scrollStep(rect: { top: number; height: number }, viewportHeight: number): ScrollStep {
  if (rect.height <= 0) return 0
  const seen = Math.min(1, Math.max(0, (viewportHeight - rect.top) / rect.height))
  if (seen >= 0.999) return 100
  return (Math.floor(seen * 4) * 25) as ScrollStep
}

const round3 = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000

/** A click's position inside a rectangle, 0–1 (3 decimals), clamped. */
export function positionIn(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): { x: number; y: number } {
  return { x: rect.width > 0 ? round3((x - rect.left) / rect.width) : 0.5, y: rect.height > 0 ? round3((y - rect.top) / rect.height) : 0.5 }
}

const INTERACTIVE = 'a[href],button,[role="button"],input[type="submit"],input[type="image"]'

/** Whether a link goes to a product page of this store. */
export function isProductLink(href: string, origin: string): boolean {
  try {
    const url = new URL(href, origin)
    return url.origin === origin && /^\/product\/[^/]+/.test(url.pathname)
  } catch {
    return false
  }
}

/** Whether a section seen this much counts: half of it, or half the screen of a tall one. */
export function visibleEnough(entry: Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRatio' | 'intersectionRect' | 'rootBounds'>, viewportHeight: number): boolean {
  if (!entry.isIntersecting) return false
  if (entry.intersectionRatio >= VIEW_RATIO) return true
  const screen = entry.rootBounds?.height || viewportHeight
  return screen > 0 && (entry.intersectionRect?.height ?? 0) >= screen * VIEW_RATIO
}

export function createPageCollector(options: CollectorOptions): PageCollector {
  const { root, send } = options
  const now = options.now ?? (() => Date.now())
  const view = typeof window === 'undefined' ? null : window
  const sections = new Map<Element, string>()
  const viewed = new Set<string>()
  const enough = new Set<Element>()
  const timers = new Map<Element, ReturnType<typeof setTimeout>>()
  let queue: InsightEvent[] = []
  let seq = 0
  let finalSent = false
  let destroyed = false
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  let deepest: ScrollStep = 0
  let clicks = 0
  let lastClick = -Infinity
  const startedAt = now()

  const viewportHeight = () => view?.innerHeight ?? 0

  function push(event: InsightEvent) {
    if (destroyed) return
    queue.push(event)
    if (queue.length >= MAX_EVENTS_PER_BEACON) flush(false)
  }

  function startDwell(section: Element) {
    const id = sections.get(section)
    if (!id || viewed.has(id) || timers.has(section) || hidden) return
    timers.set(
      section,
      setTimeout(() => {
        timers.delete(section)
        if (viewed.has(id) || hidden || !enough.has(section)) return
        viewed.add(id)
        push({ t: 'view', node: id })
      }, VIEW_DWELL_MS),
    )
  }

  function stopDwell(section: Element) {
    const timer = timers.get(section)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(section)
  }

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (visibleEnough(entry, viewportHeight())) {
                enough.add(entry.target)
                startDwell(entry.target)
              } else {
                enough.delete(entry.target)
                stopDwell(entry.target)
              }
            }
          },
          { threshold: [0, 0.25, 0.5, 0.75, 1] },
        )

  function scan() {
    if (destroyed) return
    const current = new Set<Element>()
    for (const child of Array.from(root.children)) {
      const id = child.getAttribute('data-b')
      if (child.tagName !== 'SECTION' || !child.classList.contains('b-section') || !id || !NODE_ID.test(id)) continue
      current.add(child)
      if (!sections.has(child)) {
        sections.set(child, id)
        observer?.observe(child)
      }
    }
    for (const section of Array.from(sections.keys())) {
      if (current.has(section)) continue
      observer?.unobserve(section)
      stopDwell(section)
      enough.delete(section)
      sections.delete(section)
    }
    measureScroll()
  }

  function measureScroll() {
    if (!view) return
    const step = scrollStep(root.getBoundingClientRect(), viewportHeight())
    if (step > deepest) deepest = step
  }

  let scrollFrame = 0
  const onScroll = () => {
    if (scrollFrame || !view) return
    scrollFrame = view.requestAnimationFrame(() => {
      scrollFrame = 0
      measureScroll()
    })
  }

  function sectionOf(target: Element | null): [Element, string] | null {
    for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
      const id = sections.get(node)
      if (id) return [node, id]
    }
    return null
  }

  function elementIdOf(target: Element, section: Element): string | undefined {
    for (let node: Element | null = target; node && node !== section; node = node.parentElement) {
      const id = node.getAttribute('data-b')
      if (id && !node.classList.contains('b-col') && NODE_ID.test(id)) return id
    }
    return undefined
  }

  function towardProduct(target: Element, section: Element): boolean {
    const control = target.closest(INTERACTIVE)
    if (!control || !section.contains(control)) return false
    if (control instanceof HTMLAnchorElement) return isProductLink(control.href, view?.location.origin ?? '')
    // A button of an element that sells: in a form (add to cart, order form) or next to product links.
    if (control.closest('form') && section.contains(control.closest('form'))) return true
    for (let node: Element | null = control; node && node !== section; node = node.parentElement) {
      if (node.hasAttribute('data-b') && !node.classList.contains('b-col')) {
        const origin = view?.location.origin ?? ''
        return Array.from(node.querySelectorAll('a[href]')).some((link) => isProductLink((link as HTMLAnchorElement).href, origin))
      }
    }
    return false
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const found = sectionOf(target)
    if (!target || !found) return
    const [section, id] = found
    if (options.onTowardProduct && towardProduct(target, section)) options.onTowardProduct(id)
    const time = now()
    if (time - lastClick < CLICK_THROTTLE_MS || clicks >= MAX_CLICKS_PER_VIEW) return
    lastClick = time
    clicks += 1
    const rect = section.getBoundingClientRect()
    let x = event.clientX
    let y = event.clientY
    // A keyboard "click" has no pointer position: the middle of what was pressed.
    if (event.detail === 0 && x === 0 && y === 0) {
      const box = (target.closest(INTERACTIVE) ?? target).getBoundingClientRect()
      x = box.left + box.width / 2
      y = box.top + box.height / 2
    }
    const el = elementIdOf(target, section)
    push({ t: 'click', node: id, ...(el ? { el } : {}), ...positionIn(rect, x, y) })
  }

  function flush(final: boolean) {
    if (destroyed && !final) return
    const withFinal = final && !finalSent
    if (withFinal) measureScroll()
    for (let i = 0; i < MAX_BEACONS_PER_FLUSH; i += 1) {
      const events = queue.slice(0, MAX_EVENTS_PER_BEACON)
      queue = queue.slice(events.length)
      const last = queue.length === 0
      const carry = withFinal && last
      if (events.length === 0 && !carry) break
      const beacon: InsightsBeacon = { document_id: options.documentId, version: options.version, path: options.path, device: options.device, seq, events }
      if (carry) {
        finalSent = true
        beacon.scroll = deepest
        const vitals = options.vitals?.read()
        if (vitals) beacon.vitals = vitals
      }
      seq += 1
      send(beacon)
      if (last) break
    }
  }

  function setHidden(next: boolean) {
    hidden = next
    if (hidden) {
      for (const section of Array.from(timers.keys())) stopDwell(section)
      flush(true)
    } else {
      for (const section of enough) startDwell(section)
    }
  }

  const interval = setInterval(() => flush(false), FLUSH_INTERVAL_MS)
  root.addEventListener('click', onClick, true)
  view?.addEventListener('scroll', onScroll, { passive: true })
  scan()

  return {
    scan,
    flush,
    setHidden,
    destroy() {
      if (destroyed) return
      // Left within a second with nothing seen or clicked: not a page view (this also keeps React's
      // development double mount from counting one twice). Closing the tab still counts (pagehide).
      if (seq > 0 || queue.length > 0 || now() - startedAt >= VIEW_DWELL_MS) flush(true)
      destroyed = true
      clearInterval(interval)
      for (const section of Array.from(timers.keys())) stopDwell(section)
      observer?.disconnect()
      root.removeEventListener('click', onClick, true)
      view?.removeEventListener('scroll', onScroll)
      if (scrollFrame && view) view.cancelAnimationFrame(scrollFrame)
      options.vitals?.stop()
    },
  }
}
