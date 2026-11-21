import { documentProgress, rangeProgress, type ScrollRangeKind } from './scroll-model'
import { SCROLL_DRIVEN_ATTRIBUTE } from './scroll-css'

/*
 * B19 fallback scroll engine — loaded (lazily) only by browsers without CSS scroll-driven
 * animations, and only while a page has something scroll-linked. One passive scroll listener and
 * one requestAnimationFrame loop for the whole page; an IntersectionObserver keeps the list of nodes
 * near the viewport, and only those are measured (one getBoundingClientRect each) and written
 * (`--b-p`, `--b-q`: 0–1 through their range). The reading progress bars get the document's
 * progress. Nothing is read or written while nothing is near the viewport.
 */

type Entry = { measure: HTMLElement; write: HTMLElement; kind: ScrollRangeKind }

const entries = new Map<HTMLElement, Entry>()
const near = new Set<Entry>()
const bars = new Set<HTMLElement>()
let observer: IntersectionObserver | null = null
let frame = 0
let listening = false

function write(entry: Entry) {
  const rect = entry.measure.getBoundingClientRect()
  const { p, q } = rangeProgress(entry.kind, rect.top, rect.height, window.innerHeight)
  const round = (value: number) => String(Math.round(value * 1000) / 1000)
  // An exit alone follows `--b-q` (see scroll-css): -0.01 until the node starts to leave.
  if (entry.kind === 'exit') entry.write.style.setProperty('--b-q', round(p > 0 ? p : -0.01))
  else {
    entry.write.style.setProperty('--b-p', round(p))
    if (entry.kind === 'enter_exit') entry.write.style.setProperty('--b-q', round(q))
  }
}

function update() {
  frame = 0
  near.forEach(write)
  if (bars.size > 0) {
    const root = document.documentElement
    const progress = String(Math.round(documentProgress(window.scrollY, root.scrollHeight, window.innerHeight) * 1000) / 1000)
    bars.forEach((bar) => bar.style.setProperty('--b-p', progress))
  }
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(update)
}

function listen(on: boolean) {
  if (on === listening) return
  listening = on
  if (on) {
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
  } else {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
}

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  observer ??= new IntersectionObserver(
    (changes) => {
      for (const change of changes) {
        const entry = entries.get(change.target as HTMLElement)
        if (!entry) continue
        if (change.isIntersecting) near.add(entry)
        else {
          // Leaving: one last write so it settles at its range's end.
          write(entry)
          near.delete(entry)
        }
      }
      schedule()
    },
    // A node starts moving a little before it shows.
    { rootMargin: '25% 0px 25% 0px' },
  )
  return observer
}

function idle() {
  listen(near.size > 0 || entries.size > 0 || bars.size > 0)
}

/**
 * Drives `write` (default: `measure` itself) through `kind` while `measure` is near the viewport.
 * Marks it `data-b-sp` (the fallback CSS applies from then on). Returns the cleanup.
 */
export function registerScroll(measure: HTMLElement, kind: ScrollRangeKind, target: HTMLElement = measure): () => void {
  const io = sharedObserver()
  if (!io) return () => {}
  const entry: Entry = { measure, write: target, kind }
  entries.set(measure, entry)
  write(entry)
  target.setAttribute(SCROLL_DRIVEN_ATTRIBUTE, '')
  io.observe(measure)
  idle()
  return () => {
    if (entries.get(measure) !== entry) return
    entries.delete(measure)
    near.delete(entry)
    io.unobserve(measure)
    target.removeAttribute(SCROLL_DRIVEN_ATTRIBUTE)
    target.style.removeProperty('--b-p')
    target.style.removeProperty('--b-q')
    idle()
  }
}

/** A reading progress bar: `--b-p` = the document's scroll progress. */
export function registerPageProgress(bar: HTMLElement): () => void {
  bars.add(bar)
  bar.setAttribute(SCROLL_DRIVEN_ATTRIBUTE, '')
  idle()
  update()
  return () => {
    bars.delete(bar)
    bar.removeAttribute(SCROLL_DRIVEN_ATTRIBUTE)
    bar.style.removeProperty('--b-p')
    idle()
  }
}

/** Test hook: forget everything. */
export function resetScrollEngine() {
  observer?.disconnect()
  observer = null
  entries.clear()
  near.clear()
  bars.clear()
  listen(false)
}
