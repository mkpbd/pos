import { useEffect, useLayoutEffect, type RefObject } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import type { MotionTarget, PointerEffect } from './compile-styles'

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
  // B18: a loop stops with its runtime (the canvas's "Preview motion" switched off).
  element.removeAttribute(LOOP_ATTRIBUTE)
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

/**
 * B18: calls `run` once when the element enters the viewport (text effects), through the same
 * shared observer. Without IntersectionObserver it runs at once. Returns the cleanup.
 */
export function watchEntry(element: HTMLElement, run: () => void): () => void {
  const observer = sharedObserver()
  if (!observer) {
    run()
    return () => {}
  }
  const watch: Watch = { played: false, run, restore: () => {} }
  watched.set(element, watch)
  observer.observe(element)
  return () => {
    if (watched.get(element) !== watch) return
    watched.delete(element)
    shared?.unobserve(element)
  }
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

/** B18: what a `play-motion` message replays — one node, its whole section, or the whole page top to bottom. */
export type PlayScope = 'node' | 'section' | 'page'

/** B18: the event a text effect listens to for a replay (play-motion in the canvas). */
export const TEXT_EFFECT_PLAY_EVENT = 'b-text-effect-play'
/** B18 "Play page": the gap between one entrance and the next (ms). */
const PAGE_STEP = 160
let playTimers: ReturnType<typeof setTimeout>[] = []

function documentOrder(a: Element, b: Element): number {
  if (a === b) return 0
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

function replayTextEffects(scope: Element | null, root: ParentNode) {
  const own = scope?.matches('[data-b-te]') ? [scope] : []
  const effects = [...own, ...Array.from((scope ?? root).querySelectorAll('[data-b-te]'))]
  effects.forEach((effect) => effect.dispatchEvent(new CustomEvent(TEXT_EFFECT_PLAY_EVENT)))
}

/**
 * B18 `play-motion` with a scope (the editor's ▶ Play): `node` replays one node (as B6/B9 did),
 * `section` every motion in the node's top-level section, `page` every entrance of the page one
 * after another, top to bottom (the id is ignored). Text effects in that scope replay too. Does
 * nothing for visitors who prefer reduced motion.
 */
export function playMotionScope(root: ParentNode, targets: readonly MotionTarget[], id: string, scope: PlayScope = 'node'): void {
  playTimers.forEach(clearTimeout)
  playTimers = []
  if (!motionAllowed()) return
  const node = NODE_ID_PATTERN.test(id) ? root.querySelector<HTMLElement>(selector(id)) : null
  if (scope === 'node') {
    if (!node) return
    playMotion(node, targets.find((target) => target.id === id))
    replayTextEffects(node, root)
    return
  }
  let container: HTMLElement | null = null
  if (scope === 'section') {
    container = node?.closest<HTMLElement>('section[data-b]') ?? node
    if (!container) return
  }
  // Staggered children are played by their parent.
  const driven = new Set(targets.flatMap((target) => target.children))
  const found = targets
    .filter((target) => !driven.has(target.id))
    .flatMap((target) => {
      const own = container?.matches(selector(target.id)) ? [container] : []
      const inside = Array.from((container ?? root).querySelectorAll<HTMLElement>(selector(target.id)))
      return [...own, ...inside].map((element) => ({ element, target }))
    })
    .sort((a, b) => documentOrder(a.element, b.element))
  found.forEach(({ element, target }, index) => {
    if (index === 0 || scope === 'section') playMotion(element, target)
    else playTimers.push(setTimeout(() => playMotion(element, target), index * PAGE_STEP))
  })
  replayTextEffects(container, root)
}

const NODE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/

/** Whether this visitor prefers reduced motion (moving strips, carousels and counters stand still). */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/** Test hook: forget the shared observer (a new IntersectionObserver stub per test). */
export function resetMotionRuntime() {
  playTimers.forEach(clearTimeout)
  playTimers = []
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
export function useMotionRuntime(root: RefObject<HTMLElement | null>, targets: MotionTarget[], enabled: boolean, loopsOnly = false) {
  const key = JSON.stringify(targets.map((target) => [target.id, target.motion.entrance !== 'none', target.motion.loop !== 'none', target.motion.repeat, target.motion.stagger_children, target.children]))
  useLayoutEffect(() => {
    const container = root.current
    if (!enabled || !container || key === '[]' || !motionAllowed() || typeof IntersectionObserver === 'undefined') return
    const parsed = JSON.parse(key) as [string, boolean, boolean, string, number, string[]][]
    // B18 canvas "Preview motion": the loops run, entrances stay off (played on request only).
    const list = loopsOnly ? parsed.filter((entry) => entry[2]).map((entry): (typeof parsed)[number] => [entry[0], false, true, 'once', 0, []]) : parsed
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
      for (const element of attached) {
        unobserveMotion(element)
        // B18: "Preview motion" off — the canvas is calm again.
        if (loopsOnly) element.removeAttribute(LOOP_ATTRIBUTE)
      }
    }
  }, [root, key, enabled, loopsOnly])
}

/* ----------------------------------------------------------------------------------------------
 * B18 pointer effects: the `tilt-3d` and `glare` hover effects (nodes marked `data-b-fx` by
 * usePointerEffects) and the same card hover of product listing elements
 * (`data-b-card-hover="tilt_3d" | "glare"` → their cards). One delegated pointer listener for the
 * whole page, rAF-throttled, desktop fine pointers only and never under reduced motion; a node goes
 * back to rest when the pointer leaves it. Keyboard focus gets a calm static version (CSS).
 * -------------------------------------------------------------------------------------------- */

export const FX_ATTRIBUTE = 'data-b-fx'
/** The cards inside a listing element that card hover moves. */
export const CARD_SELECTOR = '[data-testid="product-card"],[data-b-card]'
const FINE_POINTER = '(hover: hover) and (pointer: fine)'
/** The largest tilt, degrees. */
export const TILT_MAX = 8

type FxTarget = { element: HTMLElement; fx: PointerEffect }

/** The node or card under the pointer that follows it (the innermost one), or null. */
export function pointerTarget(start: Element | null): FxTarget | null {
  if (!start) return null
  const node = start.closest<HTMLElement>(`[${FX_ATTRIBUTE}]`)
  const host = start.closest<HTMLElement>('[data-b-card-hover="tilt_3d"],[data-b-card-hover="glare"]')
  const card = host ? start.closest<HTMLElement>(CARD_SELECTOR) : null
  if (host && card && host.contains(card) && (!node || node.contains(card))) return { element: card, fx: host.dataset.bCardHover === 'tilt_3d' ? 'tilt' : 'glare' }
  if (node) return { element: node, fx: node.getAttribute(FX_ATTRIBUTE) === 'glare' ? 'glare' : 'tilt' }
  return null
}

/** The custom properties for a pointer at (`x`, `y`) over a box: the tilt angles (≤ 8°) or the glare's offset. */
export function pointerVars(fx: PointerEffect, rect: { left: number; top: number; width: number; height: number }, x: number, y: number): Record<string, string> {
  const px = rect.width > 0 ? Math.max(-0.5, Math.min(0.5, (x - rect.left) / rect.width - 0.5)) : 0
  const py = rect.height > 0 ? Math.max(-0.5, Math.min(0.5, (y - rect.top) / rect.height - 0.5)) : 0
  const round = (value: number) => Math.round(value * 100) / 100 + 0
  if (fx === 'tilt') return { '--b-tilt-x': `${round(-py * 2 * TILT_MAX)}deg`, '--b-tilt-y': `${round(px * 2 * TILT_MAX)}deg` }
  return { '--b-glare-x': `${round(px * 50)}%`, '--b-glare-y': `${round(py * 50)}%` }
}

const FX_VARS = ['--b-tilt-x', '--b-tilt-y', '--b-glare-x', '--b-glare-y']
let pointerUsers = 0
let detachPointer: (() => void) | null = null

function attachPointer(): () => void {
  let active: HTMLElement | null = null
  let frame = 0
  let last: PointerEvent | null = null
  const rest = () => {
    const element = active
    if (element) FX_VARS.forEach((name) => element.style.removeProperty(name))
    active = null
  }
  const update = () => {
    frame = 0
    const event = last
    if (!event) return
    const target = pointerTarget(event.target instanceof Element ? event.target : null)
    if (target?.element !== active) rest()
    if (!target) return
    active = target.element
    const vars = pointerVars(target.fx, target.element.getBoundingClientRect(), event.clientX, event.clientY)
    for (const [name, value] of Object.entries(vars)) target.element.style.setProperty(name, value)
  }
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    last = event
    if (!frame) frame = requestAnimationFrame(update)
  }
  const onLeave = () => {
    last = null
    rest()
  }
  document.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  return () => {
    document.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', onLeave)
    if (frame) cancelAnimationFrame(frame)
    rest()
  }
}

/** Runs the shared pointer listener while `active` (desktop fine pointers that allow motion only). */
export function usePointerListener(active: boolean) {
  const fine = useMediaQuery(FINE_POINTER)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const on = active && fine && !reduced
  useEffect(() => {
    if (!on || typeof document === 'undefined') return
    pointerUsers += 1
    detachPointer ??= attachPointer()
    return () => {
      pointerUsers -= 1
      if (pointerUsers === 0) {
        detachPointer?.()
        detachPointer = null
      }
    }
  }, [on])
}

/**
 * Marks a rendered document's pointer-effect nodes (`data-b-fx`, from compile-styles'
 * pointerEffects) and runs the listener while there are any, or while `cards` (a listing element
 * with tilt / glare card hover on the page).
 */
export function usePointerEffects(root: RefObject<HTMLElement | null>, effects: Record<string, PointerEffect>, enabled: boolean, cards = false) {
  const key = JSON.stringify(effects)
  useLayoutEffect(() => {
    const container = root.current
    if (!enabled || !container || key === '{}') return
    const map = JSON.parse(key) as Record<string, PointerEffect>
    const marked = new Set<HTMLElement>()
    const mark = () => {
      for (const [id, fx] of Object.entries(map)) {
        for (const element of Array.from(container.querySelectorAll<HTMLElement>(selector(id)))) {
          if (element.getAttribute(FX_ATTRIBUTE) !== fx) element.setAttribute(FX_ATTRIBUTE, fx)
          marked.add(element)
        }
      }
    }
    mark()
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(mark)
    mutations?.observe(container, { childList: true, subtree: true })
    return () => {
      mutations?.disconnect()
      marked.forEach((element) => element.removeAttribute(FX_ATTRIBUTE))
    }
  }, [root, key, enabled])
  usePointerListener(enabled && (key !== '{}' || cards))
}
