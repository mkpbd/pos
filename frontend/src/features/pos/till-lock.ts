import { useEffect, useEffectEvent } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** POS1a: the till locks itself after this long without a key press, tap or pointer movement. */
export const AUTO_LOCK_MS = 5 * 60_000

type TillLockState = {
  /** The cashier whose screen is locked (kept across reloads, so reloading never unlocks the till). */
  lockedUserId: string | null
  lock: (userId: string) => void
  unlock: () => void
}

export const useTillLockStore = create<TillLockState>()(
  persist(
    (set) => ({
      lockedUserId: null,
      lock: (lockedUserId) => set({ lockedUserId }),
      unlock: () => set({ lockedUserId: null }),
    }),
    { name: 'pos-till-lock' },
  ),
)

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel'] as const

/** Calls `onIdle` once after `ms` without input while `enabled`; any input starts the wait again. */
export function useIdleTimer(onIdle: () => void, ms: number, enabled: boolean) {
  const fire = useEffectEvent(onIdle)

  useEffect(() => {
    if (!enabled) return
    let timer = window.setTimeout(() => fire(), ms)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => fire(), ms)
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset)
    }
  }, [ms, enabled])
}
