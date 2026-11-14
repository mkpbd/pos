import { useLayoutEffect, type RefObject } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import type { MotionTarget } from './compile-styles'

/*
 * B6 motion runtime (contract §1 "Style group motion"), B9 additions (contract §5). Progressive:
 * every node is visible without JS. Only when IntersectionObserver exists and the visitor has no
 * reduced-motion preference does the runtime put a node with an entrance into its start state
 * (`data-b-motion="start"`, hidden by the compiled CSS), then switch it to `run` (the entrance
 * animation) when it scrolls into view. One IntersectionObserver serves every node of every builder
 * document on the page. The compiled rules themselves only exist under
 * `prefers-reduced-motion: no-preference`.
 *
 * B9:
 * - `repeat: every_time`: the node goes back to its start state when it leaves the viewport and
 *   plays again when it comes back.
 * - `stagger_children`: when a section / inner row enters, its elements that have an entrance play
 *   one after another (`--b-stagger` = index × stagger; the compiled delay adds it). They are driven
 *   by their parent, not observed on their own.
 * - `loop`: `data-b-loop="run"` once the node is in view (the compiled CSS plays 3 cycles, or
 *   forever, after the entrance; paused on hover / focus).
 */

export const MOTION_ATTRIBUTE = 'data-b-motion'
export const LOOP_ATTRIBUTE = 'data-b-loop'
const NO_PREFERENCE = '(prefers-reduced-motion: no-preference)'
/** Share of a node that must be on screen before it plays (or this many pixels of a tall one). */
const ENTER_RATIO = 0.12
const ENTER_PIXELS = 160

type Watch = {
  /** Plays the node (and its staggered children). */
  run: () => void
  /** `every_time`: back to the start state once the node has left the viewport. */
  reset?: () => void
  /** Restores the node and its children as they were (shown). */
  restore: () => void
  played: boolean
}

let shared: IntersectionObserver | null = null
const watched = new Map<Element, Watch>()

function entered(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false
  // Test doubles may leave the ratio out: intersecting is then enough.
  if (typeof entry.intersectionRatio !== 'number') return true
  return entry.intersectionRatio >= ENTER_RATIO || (entry.intersectionRect?.height ?? 0) >= ENTER_PIXELS
}

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const watch = watched.get(entry.target)
        if (!watch) continue
        if (entered(entry)) {
          if (watch.played) continue
          watch.played = true
          watch.run()
          if (!watch.reset) {
            watched.delete(entry.target)
            shared?.unobserve(entry.target)
          }
        } else if (!entry.isIntersecting && watch.reset && watch.played) {
          watch.played = false
          watch.reset()
        }
      }
    },
    // A node starts once a little of it is on screen.
    { threshold: [0, ENTER_RATIO], rootMargin: '0px 0px -5% 0px' },
  )
  return shared
}

/** Whether entrances may play here: the visitor allows motion (and the browser can tell us). */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NO_PREFERENCE).matches
}

/** What the runtime does with one node (B9). Absent fields = a plain B6 entrance played once. */
export type MotionPlan = {
  entrance?: boolean
  loop?: boolean
  repeat?: boolean
  /** Elements this node staggers, in order, and the step in ms. */
  children?: HTMLElement[]
  stagger?: number
}

function setStart(element: HTMLElement, plan: MotionPlan) {
  if (plan.entrance !== false) element.setAttribute(MOTION_ATTRIBUTE, 'start')
  element.removeAttribute(LOOP_ATTRIBUTE)
  plan.children?.forEach((child, index) => {
    child.style.setProperty('--b-stagger', `${index * (plan.stagger ?? 0)}ms`)
    child.setAttribute(MOTION_ATTRIBUTE, 'start')
    child.removeAttribute(LOOP_ATTRIBUTE)
  })
}

function setRun(element: HTMLElement, plan: MotionPlan, childLoops?: ReadonlySet<HTMLElement>) {
  if (plan.entrance !== false) element.setAttribute(MOTION_ATTRIBUTE, 'run')
  if (plan.loop) element.setAttribute(LOOP_ATTRIBUTE, 'run')
  plan.children?.forEach((child) => {
    child.setAttribute(MOTION_ATTRIBUTE, 'run')
    if (childLoops?.has(child)) child.setAttribute(LOOP_ATTRIBUTE, 'run')
  })
}

function restoreNode(element: HTMLElement) {
  if (element.getAttribute(MOTION_ATTRIBUTE) === 'start') element.removeAttribute(MOTION_ATTRIBUTE)
}

/**
 * Puts a node into its start state and plays it when it enters the viewport. False when it cannot
 * (no observer). `childLoops`: staggered children that also have a loop.
 */
export function observeMotion(element: HTMLElement, plan: MotionPlan = {}, childLoops?: ReadonlySet<HTMLElement>): boolean {
  const observer = sharedObserver()
  if (!observer) return false
  if (watched.has(element)) return true
  setStart(element, plan)
  watched.set(element, {
    played: false,
    run: () => setRun(element, plan, childLoops),
    reset: plan.repeat ? () => setStart(element, plan) : undefined,
    restore: () => {
      restoreNode(element)
      plan.children?.forEach(restoreNode)
    },
  })
  observer.observe(element)
  return true
}

/** Stops waiting for a node; one still in its start state is shown again. */
export function unobserveMotion(element: HTMLElement) {
  const watch = watched.get(element)
  if (!watch) return
  watched.delete(element)
  shared?.unobserve(element)
  watch.restore()
}

/** Restarts an animation attribute: off, a style flush, on. */
function restart(element: HTMLElement, attribute: string) {
  element.setAttribute(attribute, attribute === MOTION_ATTRIBUTE ? 'start' : 'off')
  void element.offsetWidth
  element.setAttribute(attribute, 'run')
}

/**
 * Replays a node's motion once (the editor's "Preview animation", also in the canvas, where it
 * otherwise never runs): its entrance, B9 its staggered children (found inside it by id) and its
 * loop. Without `target` only the entrance. Does nothing for visitors who prefer reduced motion.
 */
export function playMotion(element: HTMLElement, target?: MotionTarget): void {
  if (!motionAllowed()) return
  unobserveMotion(element)
  const motion = target?.motion
  if (!motion || motion.entrance !== 'none') restart(element, MOTION_ATTRIBUTE)
  if (motion && motion.loop !== 'none') restart(element, LOOP_ATTRIBUTE)
  if (target && target.children.length > 0) {
    target.children.forEach((id, index) => {
      const child = element.querySelector<HTMLElement>(selector(id))
      if (!child) return
      unobserveMotion(child)
      child.style.setProperty('--b-stagger', `${index * target.motion.stagger_children}ms`)
      restart(child, MOTION_ATTRIBUTE)
    })
  }
}

/** Whether this visitor prefers reduced motion (moving strips, carousels and counters stand still). */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/** Test hook: forget the shared observer (a new IntersectionObserver stub per test). */
export function resetMotionRuntime() {
  shared?.disconnect()
  shared = null
  watched.clear()
}

function selector(id: string): string {
  return `[data-b="${id}"]`
}

/**
 * Attaches the motion of a rendered document to its nodes (`root` = the page wrapper). Nodes that
 * appear later (data loaded, a tab switched) are picked up too; a node drawn twice (a global
 * section used twice on a page) is handled each time. `enabled` false (the editor canvas) leaves
 * every node as it is.
 */
export function useMotionRuntime(root: RefObject<HTMLElement | null>, targets: MotionTarget[], enabled: boolean) {
  const key = JSON.stringify(targets.map((target) => [target.id, target.motion.entrance !== 'none', target.motion.loop !== 'none', target.motion.repeat, target.motion.stagger_children, target.children]))
  useLayoutEffect(() => {
    const container = root.current
    if (!enabled || !container || key === '[]' || !motionAllowed() || typeof IntersectionObserver === 'undefined') return
    const list = JSON.parse(key) as [string, boolean, boolean, string, number, string[]][]
    const byId = new Map(list.map((entry) => [entry[0], entry]))
    // Staggered children are driven by their parent.
    const driven = new Set(list.flatMap((entry) => entry[5]))
    const attached = new Set<HTMLElement>()
    const attach = () => {
      for (const [id, ownEntrance, ownLoop, repeat, stagger, childIds] of list) {
        // A staggered child is played by its parent; when it staggers children of its own (an
        // inner row inside a staggered section) it still drives them, but not itself.
        const isDriven = driven.has(id)
        if (isDriven && childIds.length === 0) continue
        const entrance = ownEntrance && !isDriven
        const loop = ownLoop && !isDriven
        for (const element of Array.from(container.querySelectorAll<HTMLElement>(selector(id)))) {
          if (attached.has(element)) continue
          const children = childIds.map((childId) => element.querySelector<HTMLElement>(selector(childId))).filter((child): child is HTMLElement => child !== null)
          const childLoops = new Set(children.filter((child) => byId.get(child.dataset.b ?? '')?.[2] === true))
          if (!entrance && !loop && children.length === 0) continue
          if (observeMotion(element, { entrance, loop, repeat: repeat === 'every_time', children, stagger }, childLoops)) attached.add(element)
        }
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
