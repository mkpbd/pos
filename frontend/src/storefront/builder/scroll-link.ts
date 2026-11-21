import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import { ambientMotionOn, useLongMotion, useMotionMode, usePausedMotion } from './motion-pause'
import { SCROLL_SUPPORTS } from './scroll-css'
import { normalizeKenBurns } from './validate'
import type { ScrollRangeKind } from './scroll-model'

/*
 * B19: the small, always-loaded side of scroll-linked motion. Browsers with CSS scroll-driven
 * animations need no JavaScript at all; the others load the fallback engine (./scroll.ts) on
 * first use, and only while something scroll-linked is shown.
 */

/** Whether this browser runs scroll-driven animations natively (then the engine never loads). */
export function nativeScrollTimelines(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(SCROLL_SUPPORTS.slice(1, -1))
}

type Engine = typeof import('./scroll')
let engine: Promise<Engine> | null = null

function loadEngine(): Promise<Engine> {
  engine ??= import('./scroll')
  return engine
}

/** Runs `attach` with the engine when the fallback is needed and `active`; its cleanup runs on change / unmount. */
function useEngine(active: boolean, attach: (engine: Engine) => (() => void) | void, key: string) {
  // `attach` is rebuilt every render; `key` says when it really changes.
  const latest = useRef(attach)
  useLayoutEffect(() => {
    latest.current = attach
  })
  useEffect(() => {
    if (!active || nativeScrollTimelines() || typeof IntersectionObserver === 'undefined') return
    let cleanup: (() => void) | void
    let cancelled = false
    void loadEngine().then((loaded) => {
      if (!cancelled) cleanup = latest.current(loaded)
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [active, key])
}

/** Drives `target` (default: `measure`) through `kind` with the fallback engine (`--b-p` / `--b-q`). */
export function useScrollLink(measure: RefObject<HTMLElement | null>, kind: ScrollRangeKind, active: boolean, target?: RefObject<HTMLElement | null>) {
  useEngine(
    active,
    (loaded) => {
      const node = measure.current
      if (!node) return
      return loaded.registerScroll(node, kind, target?.current ?? node)
    },
    kind,
  )
}

/** The reading progress bar's `--b-p` (fallback engine). */
export function usePageProgressLink(bar: RefObject<HTMLElement | null>, active: boolean) {
  useEngine(
    active,
    (loaded) => {
      const node = bar.current
      return node ? loaded.registerPageProgress(node) : undefined
    },
    'page',
  )
}

/**
 * The nodes of a rendered document with a scroll effect (`ranges` by id): the fallback engine drives
 * each one drawn (also ones drawn later — data loaded, a tab switched). `active` false = the canvas
 * without "Preview motion", reduced motion, paused.
 */
export function useScrollEffects(root: RefObject<HTMLElement | null>, ranges: Record<string, ScrollRangeKind>, active: boolean) {
  const key = JSON.stringify(ranges)
  const on = active && key !== '{}'
  useEngine(
    on,
    (loaded) => {
      const container = root.current
      if (!container) return
      const map = JSON.parse(key) as Record<string, ScrollRangeKind>
      const cleanups = new Map<HTMLElement, () => void>()
      const attach = () => {
        for (const [id, kind] of Object.entries(map)) {
          for (const node of Array.from(container.querySelectorAll<HTMLElement>(`[data-b="${id}"]`))) {
            if (!cleanups.has(node)) cleanups.set(node, loaded.registerScroll(node, kind))
          }
        }
      }
      attach()
      const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(attach)
      mutations?.observe(container, { childList: true, subtree: true })
      return () => {
        mutations?.disconnect()
        cleanups.forEach((cleanup) => cleanup())
      }
    },
    key,
  )
}

/** Whether scroll-linked motion runs on this page: the store, or the canvas while motion is previewed. */
export function useScrollMotionOn(): boolean {
  const mode = useMotionMode()
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const paused = usePausedMotion()
  return ambientMotionOn(mode) && !reduced && !paused
}

/** B19 Ken Burns attributes of an element (`data-b-kb`, `data-b-kb-dir`); long motion → the "Pause animations" toggle. */
export function useKenBurns(type: string, props: unknown): { 'data-b-kb'?: string; 'data-b-kb-dir'?: string } {
  const mode = useMotionMode()
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const kb = normalizeKenBurns(type, props)
  useLongMotion(kb !== undefined && mode === 'live' && !reduced)
  return kb ? { 'data-b-kb': kb.mode, 'data-b-kb-dir': kb.direction } : {}
}
