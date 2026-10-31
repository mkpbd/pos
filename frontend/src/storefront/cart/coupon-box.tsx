import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, TicketPercentIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputClass, primaryButtonClass } from '../account/form-controls'
import type { Cart } from '../types'
import { useApplyCouponMutation, useRemoveCouponMutation } from './api'
import { useCartCurrency } from './cart-helpers'
import { COUPON_CODE, couponErrorMessage, couponNote, normalizeCouponCode } from './coupon-messages'
import { cartErrorMessage } from './quantity'

type FocusTarget = 'input' | 'coupon' | 'toggle'

/**
 * The cart's coupon: a code field (apply) or the coupon on the cart (remove). The server
 * validates the code and answers with the repriced cart, which replaces the cached one; a
 * refusal is shown with the field (an alert), per reason. A coupon that is on the cart but
 * not used in the totals (a better automatic offer, or it stopped qualifying) says why.
 * `compact` (mini-cart): the field opens from a "Have a coupon code?" button.
 */
export function CouponBox({ cart, compact = false }: { cart: Cart; compact?: boolean }) {
  const currency = useCartCurrency(cart)
  const apply = useApplyCouponMutation()
  const remove = useRemoveCouponMutation()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [open, setOpen] = useState(!compact)
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const couponRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Where the focus goes once the next render has drawn it (the element it was on is replaced).
  const focusNext = useRef<FocusTarget | null>(null)
  const coupon = cart.coupon ?? null

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    const element = target === 'input' ? inputRef.current : target === 'coupon' ? couponRef.current : toggleRef.current
    if (element) {
      element.focus()
      focusNext.current = null
    }
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeCouponCode(code)
    setAnnouncement('')
    if (normalized === '') {
      setError('Enter a coupon code.')
      inputRef.current?.focus()
      return
    }
    if (!COUPON_CODE.test(normalized)) {
      setError('This coupon code is not valid.')
      inputRef.current?.focus()
      return
    }
    setError(null)
    apply.mutate(normalized, {
      onSuccess: (next) => {
        setCode('')
        setRemoveError(null)
        const note = next.coupon ? couponNote(next.coupon) : null
        setAnnouncement(note ? `Coupon ${normalized} added. ${note}` : `Coupon ${normalized} applied.`)
        focusNext.current = 'coupon'
      },
      onError: (e) => {
        setError(couponErrorMessage(e, currency))
        inputRef.current?.focus()
      },
    })
  }

  const removeCoupon = () => {
    if (!coupon) return
    setRemoveError(null)
    setAnnouncement('')
    remove.mutate(undefined, {
      onSuccess: () => {
        setAnnouncement(`Coupon ${coupon.code} removed.`)
        focusNext.current = compact ? 'toggle' : 'input'
        if (compact) setOpen(false)
      },
      onError: (e) => setRemoveError(cartErrorMessage(e)),
    })
  }

  const errorId = `${id}-error`
  const note = coupon ? couponNote(coupon) : null

  return (
    <div className={cn('flex flex-col gap-2 text-sm', !compact && 'border-b pb-4')} data-testid="coupon-box">
      {coupon ? (
        <div ref={couponRef} tabIndex={-1} role="group" aria-labelledby={`${id}-coupon`} className="flex flex-col gap-1.5 rounded-lg border border-dashed border-sf-border px-3 py-2.5 outline-none focus-visible:outline-2 focus-visible:outline-sf-accent" data-testid="cart-coupon">
          <div className="flex items-center justify-between gap-3">
            <p id={`${id}-coupon`} className="inline-flex min-w-0 items-center gap-2">
              <TicketPercentIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />
              <span className="min-w-0">
                <span className="sr-only">Coupon </span>
                <strong className="font-bold tracking-wide text-sf-heading" data-testid="coupon-code">{coupon.code}</strong>
                {coupon.promotion_name && <span className="block text-xs">{coupon.promotion_name}</span>}
              </span>
            </p>
            <button
              type="button"
              onClick={removeCoupon}
              disabled={remove.isPending}
              aria-label={`Remove coupon ${coupon.code}`}
              className="shrink-0 font-semibold text-sf-accent underline underline-offset-4 hover:no-underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
          {note ? (
            <p className="flex items-start gap-1.5 text-xs font-semibold text-sf-sale" data-testid="coupon-note">
              <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              {note}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sf-highlight" data-testid="coupon-applied">
              <CircleCheckIcon aria-hidden className="size-3.5 shrink-0" />
              Coupon applied
            </p>
          )}
          {removeError && (
            <p role="alert" className="text-xs text-sf-sale">
              {removeError}
            </p>
          )}
        </div>
      ) : compact && !open ? (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={false}
          onClick={() => {
            setOpen(true)
            focusNext.current = 'input'
          }}
          className="inline-flex items-center gap-2 self-start font-semibold text-sf-accent underline-offset-4 hover:underline"
        >
          <TicketPercentIcon aria-hidden className="size-4" />
          Have a coupon code?
        </button>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-1.5" aria-label="Coupon">
          <label htmlFor={`${id}-code`} className="font-medium text-sf-heading">
            Coupon code
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id={`${id}-code`}
              name="coupon"
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                if (error) setError(null)
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(inputClass, 'min-w-0 flex-1 py-2 uppercase placeholder:normal-case')}
              placeholder="Enter your code"
            />
            <button type="submit" disabled={apply.isPending} className={cn(primaryButtonClass, 'shrink-0 px-5 py-2')}>
              {apply.isPending && <Loader2Icon aria-hidden className="size-4 animate-spin" />}
              {apply.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
          {error && (
            <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sf-sale" data-testid="coupon-error">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
        </form>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  )
}
