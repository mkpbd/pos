import { useEffect, useState } from 'react'
import type { PinProblem } from '@/features/pos/till-api'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, MONEY_PATTERN } from '@/lib/money'

/** POS1a till PINs are 4–6 digits. */
export const PIN_MIN = 4
export const PIN_MAX = 6

export const MAX_UNIT_PRICE = '99999999.99'

/** Why a typed unit price is not acceptable, or null (> 0, ≤ 99,999,999.99, up to 2 decimals). */
export function priceProblem(value: string): string | null {
  const v = value.trim()
  if (v === '') return 'Enter the price.'
  if (!MONEY_PATTERN.test(v)) return 'An amount with up to 2 decimals.'
  if (compareDecimal(v, '0') <= 0) return 'The price must be more than zero.'
  if (compareDecimal(v, MAX_UNIT_PRICE) > 0) return 'The price is too high.'
  return null
}

/** Coupon codes are compared without case; spaces never belong to one. */
export const normalizeCoupon = (code: string): string => code.replace(/\s+/g, '').toUpperCase()

/** Codes of POS1a refusals the till resolves in the cart (from the preview or checkout). */
export const TILL_PROBLEM_CODES = ['APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'PRICE_REQUIRED', 'COUPON_INVALID'] as const

export function isTillProblem(error: unknown): error is ApiError {
  return error instanceof ApiError && (TILL_PROBLEM_CODES as readonly string[]).includes(error.code)
}

/** The PIN problem on screen, with the lockout countdown (seconds left, ticking each second). */
export function usePinProblem() {
  const [problem, setProblem] = useState<PinProblem | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (lockedUntil === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockedUntil])

  const secondsLeft = lockedUntil === null ? 0 : Math.max(0, Math.ceil((lockedUntil - now) / 1000))

  return {
    problem,
    lockedOut: secondsLeft > 0,
    secondsLeft,
    show: (next: PinProblem | null) => {
      const at = Date.now()
      setNow(at)
      setProblem(next)
      setLockedUntil(next?.retryAfter ? at + next.retryAfter * 1000 : null)
    },
  }
}
