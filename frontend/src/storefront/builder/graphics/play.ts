import { useEffect, type RefObject } from 'react'
import { useReducedMotion, watchEntry } from '../motion'
import { ambientMotionOn, useLongMotion, useMotionMode } from '../motion-pause'

/*
 * B20: when an animated icon or illustration plays (lazy chunk; shared by both). It only sets
 * `data-play` on the drawing's root — the CSS does the rest, and without it (no JS yet, reduced
 * motion, the calm editor canvas) the drawing stands still in its final frame:
 * - `view`: `start` (draw / pop drawings wait hidden) until the shared B18 IntersectionObserver sees
 *   it, then `run` (plays once — illustrations twice, under 5 s);
 * - `hover`: `run` on every pointer enter or keyboard focus (`:focus-visible`) of the nearest link
 *   or button around it (else the drawing itself);
 * - `loop`: `loop` (forever: long motion, so the B18 Pause toggle shows and stops it); paused while
 *   off-screen (`data-offscreen`).
 * `playing` (the editor's picker tiles) forces it on / off instead.
 */

export const PLAY_ATTRIBUTE = 'data-play'
export const OFFSCREEN_ATTRIBUTE = 'data-offscreen'

export type PlayTrigger = 'view' | 'hover' | 'loop'

/** Restarts the CSS animation: off, a style flush, on. */
function replay(element: HTMLElement, value: string) {
  element.setAttribute(PLAY_ATTRIBUTE, 'idle')
  void element.getBoundingClientRect()
  element.setAttribute(PLAY_ATTRIBUTE, value)
}

let visibility: IntersectionObserver | null = null
const onVisibility = new Map<Element, (visible: boolean) => void>()

/** Tells `callback` when the element leaves or comes back on screen (one observer for all loops). */
function watchVisibility(element: Element, callback: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  visibility ??= new IntersectionObserver((entries) => {
    for (const entry of entries) onVisibility.get(entry.target)?.(entry.isIntersecting)
  })
  onVisibility.set(element, callback)
  visibility.observe(element)
  return () => {
    onVisibility.delete(element)
    visibility?.unobserve(element)
  }
}

/** Test hook: forget the visibility observer. */
export function resetGraphicPlay() {
  visibility?.disconnect()
  visibility = null
  onVisibility.clear()
}

const HOVER_HOST = 'a[href], button, [role="button"], summary'

function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

/** Whether motion may run here: the visitor allows it and this isn't the calm editor canvas. */
export function useGraphicMotionOn(): boolean {
  const reduced = useReducedMotion()
  const mode = useMotionMode()
  return !reduced && ambientMotionOn(mode)
}

export function useGraphicPlay(ref: RefObject<HTMLElement | null>, options: { trigger: PlayTrigger; animated: boolean; playing?: boolean }) {
  const { trigger, animated, playing } = options
  const on = useGraphicMotionOn() && animated
  const forced = playing !== undefined
  useLongMotion(on && !forced && trigger === 'loop')

  useEffect(() => {
    const element = ref.current
    if (!element || !on) return
    const clear = () => {
      element.removeAttribute(PLAY_ATTRIBUTE)
      element.removeAttribute(OFFSCREEN_ATTRIBUTE)
    }
    if (forced) {
      if (playing) replay(element, trigger === 'loop' ? 'loop' : 'run')
      else clear()
      return clear
    }
    if (trigger === 'view') {
      element.setAttribute(PLAY_ATTRIBUTE, 'start')
      const stop = watchEntry(element, () => element.setAttribute(PLAY_ATTRIBUTE, 'run'))
      return () => {
        stop()
        clear()
      }
    }
    if (trigger === 'loop') {
      element.setAttribute(PLAY_ATTRIBUTE, 'loop')
      const stop = watchVisibility(element, (visible) => {
        if (visible) element.removeAttribute(OFFSCREEN_ATTRIBUTE)
        else element.setAttribute(OFFSCREEN_ATTRIBUTE, '')
      })
      return () => {
        stop()
        clear()
      }
    }
    // hover: the nearest link / button carries the pointer and the keyboard focus.
    const host = element.closest<HTMLElement>(HOVER_HOST) ?? element
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') replay(element, 'run')
    }
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && focusVisible(event.target)) replay(element, 'run')
    }
    host.addEventListener('pointerenter', onPointer)
    host.addEventListener('focusin', onFocus)
    return () => {
      host.removeEventListener('pointerenter', onPointer)
      host.removeEventListener('focusin', onFocus)
      clear()
    }
  }, [ref, on, forced, playing, trigger])
}
