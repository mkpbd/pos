import { useLayoutEffect, type RefObject } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import type { MotionTarget } from './compile-styles'

/*
 * B6 motion runtime (contract §1 "Style group motion"). Progressive: every node is visible without
 * JS. Only when IntersectionObserver exists and the visitor has no reduced-motion preference does
 * the runtime put a node with an entrance into its start state (`data-b-motion="start"`, hidden by
 * the compiled CSS), then switch it to `run` (the entrance animation, once) when it scrolls into
 * view. One IntersectionObserver serves every node of every builder document on the page. The
 * compiled rules themselves only exist under `prefers-reduced-motion: no-preference`.
 */

export const MOTION_ATTRIBUTE = 'data-b-motion'
const NO_PREFERENCE = '(prefers-reduced-motion: no-preference)'

let shared: IntersectionObserver | null = null
const pending = new Map<Element, () => void>()

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const run = pending.get(entry.target)
        pending.delete(entry.target)
        shared?.unobserve(entry.target)
        run?.()
      }
    },
    // A node starts once a little of it is on screen.
    { threshold: 0.12, rootMargin: '0px 0px -5% 0px' },
  )
  return shared
}

/** Whether entrances may play here: the visitor allows motion (and the browser can tell us). */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NO_PREFERENCE).matches
}

/** Puts a node into its start state and plays its entrance when it enters the viewport. False when it cannot (no observer). */
export function observeMotion(element: HTMLElement): boolean {
  const observer = sharedObserver()
  if (!observer) return false
  if (element.hasAttribute(MOTION_ATTRIBUTE)) return true
  element.setAttribute(MOTION_ATTRIBUTE, 'start')
  pending.set(element, () => element.setAttribute(MOTION_ATTRIBUTE, 'run'))
  observer.observe(element)
  return true
}

/** Stops waiting for a node; one still in its start state is shown again. */
export function unobserveMotion(element: HTMLElement) {
  if (!pending.has(element)) return
  pending.delete(element)
  shared?.unobserve(element)
  if (element.getAttribute(MOTION_ATTRIBUTE) === 'start') element.removeAttribute(MOTION_ATTRIBUTE)
}

/**
 * Replays a node's entrance once (the editor's "Preview animation", also in the canvas, where
 * entrances otherwise never run). Does nothing for visitors who prefer reduced motion.
 */
export function playMotion(element: HTMLElement): void {
  if (!motionAllowed()) return
  unobserveMotion(element)
  element.setAttribute(MOTION_ATTRIBUTE, 'start')
  // A style flush between the two states restarts the animation.
  void element.offsetWidth
  element.setAttribute(MOTION_ATTRIBUTE, 'run')
}

/** Whether this visitor prefers reduced motion (moving strips, carousels and counters stand still). */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/** Test hook: forget the shared observer (a new IntersectionObserver stub per test). */
export function resetMotionRuntime() {
  shared?.disconnect()
  shared = null
  pending.clear()
}

function selector(id: string): string {
  return `[data-b="${id}"]`
}

/**
 * Attaches the entrances of a rendered document to its nodes (`root` = the page wrapper). Nodes
 * that appear later (data loaded, a tab switched) are picked up too. `enabled` false (the editor
 * canvas) leaves every node as it is.
 */
export function useMotionRuntime(root: RefObject<HTMLElement | null>, targets: MotionTarget[], enabled: boolean) {
  const key = targets.map((target) => target.id).join(',')
  useLayoutEffect(() => {
    const container = root.current
    if (!enabled || !container || key === '' || !motionAllowed() || typeof IntersectionObserver === 'undefined') return
    const ids = key.split(',')
    const attached = new Set<HTMLElement>()
    const attach = () => {
      for (const id of ids) {
        const element = container.querySelector<HTMLElement>(selector(id))
        if (element && !attached.has(element) && observeMotion(element)) attached.add(element)
      }
    }
    attach()
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(attach)
    mutations?.observe(container, { childList: true, subtree: true })
    return () => {
      mutations?.disconnect()
      for (const element of attached) unobserveMotion(element)
    }
  }, [root, key, enabled])
}
