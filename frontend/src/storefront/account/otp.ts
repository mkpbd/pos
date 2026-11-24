import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { storeFormError } from '../form-errors'
import type { MessageKey } from '../i18n/en'
import type { Translate } from '../i18n/translate'

/*
 * BD1a: the logic shared by every SMS-code step (phone sign-in, profile "Verify", checkout and the
 * landing-page order form): the typed code, the error messages of the code endpoints and the
 * resend countdown. The components are in ./phone-code.tsx.
 */

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** The typed code as Latin digits only ("১২৩ ৪৫৬" → "123456"): Bangla keyboards type Bengali digits. */
export function cleanCode(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit))).replace(/\D/g, '').slice(0, 6)
}

export const CODE_PATTERN = /^\d{6}$/

const OTP_MESSAGES: Record<string, MessageKey> = {
  SMS_UNAVAILABLE: 'account.otp.error.smsUnavailable',
  OTP_LIMIT: 'account.otp.error.limit',
  OTP_INVALID: 'account.otp.error.invalid',
  OTP_EXPIRED: 'account.otp.error.expired',
  OTP_TOO_MANY_ATTEMPTS: 'account.otp.error.tooManyAttempts',
  OTP_SESSION_EXPIRED: 'account.otp.error.sessionExpired',
  PHONE_IN_USE: 'account.otp.error.phoneInUse',
  ALREADY_SIGNED_IN: 'account.otp.error.alreadySignedIn',
}

/** Seconds to wait from an `OTP_TOO_SOON` answer (`details.retry_after`), else null. */
export function retryAfter(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'OTP_TOO_SOON') return null
  const seconds = Number(error.details.retry_after)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
}

/** The shopper-facing message of a failed send / verify call. */
export function otpErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const wait = retryAfter(error)
    if (wait !== null) return t('account.otp.error.tooSoon', { count: wait })
    const key = OTP_MESSAGES[error.code]
    if (key) return t(key)
    // A 422 on the phone or code field (VALIDATION_FAILED) shows the server's message.
    const field = error.fieldErrors.phone?.[0] ?? error.fieldErrors.code?.[0]
    if (field) return field
  }
  return storeFormError(error, t)
}

/** A seconds countdown ("You can ask for a new code in 0:45"). */
export function useCountdown(): { remaining: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= until) setUntil(null)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [until])
  const start = useCallback((seconds: number) => {
    const current = Date.now()
    setNow(current)
    setUntil(seconds > 0 ? current + seconds * 1000 : null)
  }, [])
  return { remaining: until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000)), start }
}

/** "0:45", "1:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
