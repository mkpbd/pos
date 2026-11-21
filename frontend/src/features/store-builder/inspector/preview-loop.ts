/*
 * The tile previews' player (B18, shared with the B19 scroll tiles): replays one Web Animations
 * run while a tile is pointed at or focused; nothing moves under "reduce motion".
 */

import { useEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from './b18-motion'

export const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function'

/**
 * Replays `play` (one run) every `gap` ms while `on`; cancels everything when it stops. A new
 * `key` (what is played) starts over; a re-render alone doesn't.
 */
export function useLoop(ref: RefObject<HTMLElement | null>, on: boolean, play: (el: HTMLElement) => Animation | null, gap: number, key: string) {
  const playRef = useRef(play)
  useEffect(() => {
    playRef.current = play
  })
  useEffect(() => {
    const el = ref.current
    if (!on || !canAnimate(el) || prefersReducedMotion()) return
    let stopped = false
    let current: Animation | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      if (stopped) return
      try {
        current = playRef.current(el)
      } catch {
        current = null
      }
      if (!current) return
      current.onfinish = () => {
        timer = setTimeout(run, gap)
      }
    }
    run()
    return () => {
      stopped = true
      clearTimeout(timer)
      current?.cancel()
    }
  }, [ref, on, gap, key])
}
