import { useEffect, useState } from 'react'

/** setTimeout cannot wait longer than this (about 24.8 days); longer waits are chained. */
const MAX_TIMEOUT = 2_147_483_647

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Milliseconds since the epoch of an ISO instant, null when absent or not a date. */
export function parseInstant(iso: string | null | undefined): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : time
}

export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number }

/**
 * The time left split into days, hours, minutes and seconds. Rounded up to whole seconds (or
 * minutes when `precision` is 'minutes'), so the display reaches 00:00:00 exactly at the end.
 */
export function countdownParts(remainingMs: number, precision: 'seconds' | 'minutes' = 'seconds'): CountdownParts {
  const unit = precision === 'minutes' ? MINUTE : SECOND
  const total = Math.ceil(Math.max(0, remainingMs) / unit) * unit
  return {
    days: Math.floor(total / DAY),
    hours: Math.floor((total % DAY) / HOUR),
    minutes: Math.floor((total % HOUR) / MINUTE),
    seconds: Math.floor((total % MINUTE) / SECOND),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * "05:04:03" under a day, "2d 05:04:03" from 24 hours on; with minute precision (reduced
 * motion) "05:04" / "2d 05:04".
 */
export function formatCountdown(remainingMs: number, precision: 'seconds' | 'minutes' = 'seconds'): string {
  const { days, hours, minutes, seconds } = countdownParts(remainingMs, precision)
  const clock = precision === 'minutes' ? `${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

/**
 * The current time, refreshed when the display of a deadline changes: every `tick` ms
 * (aligned to the deadline, so all countdowns to it change together), or — with `tick` null —
 * only once, when the deadline passes. No timer once it has passed; timers are cleared on
 * unmount and when the deadline changes.
 */
export function useDeadline(endsAt: string | null | undefined, tick: number | null = null) {
  const end = parseInstant(endsAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (end === null) return
    let timer: number | undefined
    const schedule = (current: number) => {
      const remaining = end - current
      if (remaining <= 0) return
      // The next moment the shown value changes (remaining crosses a whole tick), or the end.
      const wait = tick === null ? remaining : remaining % tick || tick
      timer = window.setTimeout(() => {
        const next = Date.now()
        setNow(next)
        schedule(next)
      }, Math.min(wait, MAX_TIMEOUT))
    }
    schedule(Date.now())
    return () => window.clearTimeout(timer)
  }, [end, tick])

  return {
    end,
    remaining: end === null ? null : Math.max(0, end - now),
    expired: end !== null && now >= end,
  }
}

/** Whether a promotion with this end is still on (true without an end). */
export function usePromotionLive(endsAt: string | null | undefined): boolean {
  return !useDeadline(endsAt).expired
}

function readReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The visitor asked for reduced motion (read once per component). */
export function useReducedMotion(): boolean {
  const [reduced] = useState(readReducedMotion)
  return reduced
}

export const COUNTDOWN_TICK = { seconds: SECOND, minutes: MINUTE } as const
