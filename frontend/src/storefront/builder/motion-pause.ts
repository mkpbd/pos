import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'

/*
 * B18 "Pause animations" (WCAG 2.2.2 Pause, Stop, Hide). Anything that moves on its own for more
 * than 5 s (forever loops, rotating words without a stop, animated dividers, moving strips) can be
 * paused by the shopper with one toggle (./pause-toggle.tsx). The choice persists in localStorage
 * and shows as `data-b-paused` on <html>: the CSS pauses those animations
 * (`animation-play-state: paused`) and the JS-driven effects (typewriter, rotating words) stop
 * through `usePausedMotion`. The toggle is offered only while a page shows such motion: components
 * announce it with `useLongMotion`.
 *
 * Also the motion mode of a builder document: `live` (the store), `canvas` (the editor canvas,
 * calm: no loops, dividers or text effects) or `canvas-preview` (the toolbar's "Preview motion").
 */

export const PAUSED_ATTRIBUTE = 'data-b-paused'
const STORAGE_KEY = 'sf-motion-paused'

export type MotionMode = 'live' | 'canvas' | 'canvas-preview'

/** How a builder document's motion runs here (default: the live store). */
export const MotionModeCtx = createContext<MotionMode>('live')

export function useMotionMode(): MotionMode {
  return useContext(MotionModeCtx)
}

/** Whether ambient motion (loops, dividers, text effects) runs in this mode. */
export function ambientMotionOn(mode: MotionMode): boolean {
  return mode !== 'canvas'
}

const listeners = new Set<() => void>()
let paused: boolean | null = null
let longMotion = 0

function emit() {
  listeners.forEach((listener) => listener())
}

function readStored(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function applyAttribute(value: boolean) {
  if (typeof document === 'undefined') return
  if (value) document.documentElement.setAttribute(PAUSED_ATTRIBUTE, '')
  else document.documentElement.removeAttribute(PAUSED_ATTRIBUTE)
}

/** Whether the shopper paused animations (remembered across visits). */
export function motionPaused(): boolean {
  if (paused === null) {
    paused = readStored()
    applyAttribute(paused)
  }
  return paused
}

/** Pauses or plays every long-running animation and remembers the choice. */
export function setMotionPaused(value: boolean) {
  paused = value
  applyAttribute(value)
  try {
    if (value) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode, blocked storage: the choice lasts for this page only.
  }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The paused state, live. */
export function usePausedMotion(): boolean {
  return useSyncExternalStore(subscribe, motionPaused, () => false)
}

/** How many shown things move for longer than 5 s (the toggle shows while > 0). */
export function useLongMotionCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => longMotion,
    () => 0,
  )
}

/** Announces long-running motion while `active` (and mounted). */
export function useLongMotion(active: boolean) {
  useEffect(() => {
    if (!active) return
    longMotion += 1
    // Applies a stored choice as soon as something can move.
    motionPaused()
    emit()
    return () => {
      longMotion -= 1
      emit()
    }
  }, [active])
}

/** Test hook: forget the state. */
export function resetMotionPause() {
  paused = null
  longMotion = 0
  applyAttribute(false)
  emit()
}
