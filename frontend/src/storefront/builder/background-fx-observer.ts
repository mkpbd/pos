import { useEffect, useState, type RefObject } from 'react'

/* B20: one IntersectionObserver for every moving background on the page — a layer runs only while on screen. */

const listeners = new WeakMap<Element, (visible: boolean) => void>()
let observer: IntersectionObserver | null = null

function visibilityObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
    },
    { rootMargin: '64px 0px' },
  )
  return observer
}

/** Test hook: forget the shared observer (a new IntersectionObserver stub per test). */
export function resetBackgroundFxObserver() {
  observer?.disconnect()
  observer = null
}

/** Whether the element is on screen, kept up to date while `enabled` (true where IntersectionObserver is missing). */
export function useOnScreen(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const element = ref.current
    const io = enabled ? visibilityObserver() : null
    if (!element || !io) return
    listeners.set(element, setVisible)
    io.observe(element)
    return () => {
      io.unobserve(element)
      listeners.delete(element)
    }
  }, [ref, enabled])
  return visible
}
