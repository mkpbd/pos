import type { PopupTrigger } from '../types'
import { POPUP_EXIT_FALLBACK_SECONDS } from '../validate'

/*
 * B8b popup triggers (contract §1): after a delay, after scrolling part of the page, or when the
 * pointer leaves the page through the top (desktop; touch devices fall back to a delay).
 */

/** A precise pointer that can hover (mouse, trackpad): exit intent works there. */
export function hasFinePointer(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch {
    return false
  }
}

/** How far down the page the visitor has scrolled (0–100); null when the page does not scroll. */
export function scrolledPercent(): number | null {
  const doc = document.documentElement
  const scrollable = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0) - window.innerHeight
  if (scrollable <= 0) return null
  return Math.min(100, (Math.max(0, window.scrollY) / scrollable) * 100)
}

/** A page too short to scroll counts as read once it has been open this long. */
const SHORT_PAGE_MS = 2000

/**
 * Arms one trigger; `fire` runs at most once. Returns the disarm function. Pure DOM (no React),
 * so the host can re-arm per page view.
 */
export function armTrigger(trigger: PopupTrigger, fire: () => void): () => void {
  let done = false
  const cleanups: (() => void)[] = []
  const once = () => {
    if (done) return
    done = true
    cleanups.forEach((cleanup) => cleanup())
    fire()
  }
  const after = (ms: number) => {
    const timer = window.setTimeout(once, ms)
    cleanups.push(() => window.clearTimeout(timer))
  }

  if (trigger.kind === 'on_load') after(Math.max(0, trigger.delay_seconds) * 1000)
  else if (trigger.kind === 'on_scroll') {
    const check = () => {
      const percent = scrolledPercent()
      if (percent !== null && percent >= trigger.scroll_percent) once()
    }
    const onScroll = () => check()
    window.addEventListener('scroll', onScroll, { passive: true })
    cleanups.push(() => window.removeEventListener('scroll', onScroll))
    const short = window.setTimeout(() => {
      if (scrolledPercent() === null) once()
      else check()
    }, SHORT_PAGE_MS)
    cleanups.push(() => window.clearTimeout(short))
  } else if (trigger.kind === 'on_exit') {
    if (hasFinePointer()) {
      const onOut = (event: MouseEvent) => {
        if (!event.relatedTarget && event.clientY <= 0) once()
      }
      document.addEventListener('mouseout', onOut)
      cleanups.push(() => document.removeEventListener('mouseout', onOut))
    } else after((trigger.delay_seconds > 0 ? trigger.delay_seconds : POPUP_EXIT_FALLBACK_SECONDS) * 1000)
  }

  return () => {
    done = true
    cleanups.forEach((cleanup) => cleanup())
  }
}
