import { useId, useState, type KeyboardEvent } from 'react'
import { CircleCheckIcon, Loader2Icon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { PhoneCodeSent } from '../types'
import { inputClass, secondaryButtonClass } from './form-controls'
import { CODE_PATTERN, cleanCode, clock, otpErrorMessage, retryAfter, useCountdown } from './otp'

/*
 * BD1a: confirming a mobile number with a 6-digit SMS code — the code input and the inline
 * "Send code → code → Verified" step of the profile, the checkout and the landing-page order form.
 */

type CodeInputProps = {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  onEnter?: () => void
  className?: string
  autoFocus?: boolean
}

/** The 6-digit code: numeric keypad, SMS autofill (one-time-code), Bengali digits accepted. */
export function CodeInput({ id, value, onChange, invalid, describedBy, onEnter, className, autoFocus }: CodeInputProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onEnter) {
      // Inside a bigger form (checkout) Enter checks the code instead of submitting the order.
      event.preventDefault()
      onEnter()
    }
  }
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      ref={(node) => {
        // The code is the only thing to type once it was sent.
        if (node && autoFocus && !node.dataset.focused) {
          node.dataset.focused = '1'
          node.focus()
        }
      }}
      maxLength={6}
      pattern="[0-9]*"
      value={value}
      onChange={(event) => onChange(cleanCode(event.target.value))}
      onKeyDown={onKeyDown}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(inputClass, 'max-w-40 text-center font-mono text-lg tracking-[0.4em]', className)}
      placeholder="••••••"
    />
  )
}

type PhoneCodeCheckProps = {
  /** The number to confirm, normalised (01XXXXXXXXX); null while the typed one is not valid. */
  phone: string | null
  send: (phone: string) => Promise<PhoneCodeSent>
  verify: (phone: string, code: string) => Promise<unknown>
  onVerified: (phone: string) => void
  /** Shown before the code is sent. */
  intro?: string
  /** Called when a call fails (e.g. to clear a field error the parent shows). */
  onError?: (error: unknown) => void
  className?: string
  testId?: string
}

/**
 * "Send code" → the code input with Verify and the resend countdown. Plain buttons, no <form>:
 * it sits inside the checkout and order forms. A new number starts over (the parent keys it by
 * the number).
 */
export function PhoneCodeCheck({ phone, send, verify, onVerified, intro, onError, className, testId = 'phone-code-check' }: PhoneCodeCheckProps) {
  const { t } = useLocale()
  const uid = useId()
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'send' | 'verify' | null>(null)
  const countdown = useCountdown()

  const doSend = async () => {
    if (!phone || pending) return
    setError(null)
    setPending('send')
    try {
      const answer = await send(phone)
      setSent(true)
      setCode('')
      countdown.start(Number(answer?.resend_after) || 60)
    } catch (failure) {
      const wait = retryAfter(failure)
      if (wait !== null) {
        // A code was sent a moment ago: the shopper can type it.
        setSent(true)
        countdown.start(wait)
      }
      setError(otpErrorMessage(failure, t))
      onError?.(failure)
    } finally {
      setPending(null)
    }
  }

  const doVerify = async () => {
    if (!phone || pending) return
    if (!CODE_PATTERN.test(code)) {
      setError(t('account.validation.codeRequired'))
      return
    }
    setError(null)
    setPending('verify')
    try {
      await verify(phone, code)
      onVerified(phone)
    } catch (failure) {
      setError(otpErrorMessage(failure, t))
      onError?.(failure)
    } finally {
      setPending(null)
    }
  }

  const codeId = `${uid}-code`
  const messageId = `${uid}-message`
  return (
    <div className={cn('flex flex-col gap-2 text-sm', className)} data-testid={testId}>
      {!sent ? (
        <>
          {intro && <p>{intro}</p>}
          <button type="button" className={cn(secondaryButtonClass, 'self-start')} disabled={!phone || pending !== null} onClick={() => void doSend()}>
            {pending === 'send' && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
            {t('account.otp.send')}
          </button>
        </>
      ) : (
        <>
          <p role="status">{t('account.otp.sentTo', { phone: phone ?? '' })}</p>
          <label htmlFor={codeId} className="font-medium text-sf-heading">
            {t('account.otp.codeLabel')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <CodeInput id={codeId} value={code} onChange={setCode} invalid={Boolean(error)} describedBy={error ? messageId : undefined} onEnter={() => void doVerify()} autoFocus />
            <button type="button" className={secondaryButtonClass} disabled={pending !== null} onClick={() => void doVerify()}>
              {pending === 'verify' && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
              {pending === 'verify' ? t('account.otp.checking') : t('account.otp.verify')}
            </button>
          </div>
          {countdown.remaining > 0 ? (
            <p data-testid="otp-countdown">{t('account.otp.resendIn', { time: clock(countdown.remaining) })}</p>
          ) : (
            <button type="button" className="self-start font-semibold text-sf-link underline-offset-4 hover:underline disabled:opacity-60" disabled={pending !== null} onClick={() => void doSend()}>
              {t('account.otp.resend')}
            </button>
          )}
        </>
      )}
      {error && (
        <p id={messageId} role="alert" className="font-medium text-sf-sale">
          {error}
        </p>
      )}
    </div>
  )
}

/** The "Verified ✓" state of a confirmed number. */
export function VerifiedMark({ label, className }: { label: string; className?: string }) {
  return (
    <p className={cn('inline-flex items-center gap-1.5 text-sm font-semibold text-sf-highlight', className)} data-testid="phone-verified">
      <CircleCheckIcon aria-hidden className="size-4" />
      {label}
    </p>
  )
}
