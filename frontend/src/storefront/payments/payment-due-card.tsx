import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CheckIcon, CopyIcon, SmartphoneIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FormAlert, SubmitButton, TextField } from '../account/form-controls'
import { bdPhoneFrom } from '../account/schemas'
import { formatDateTime } from '../checkout/delivery'
import { readOrderToken } from '../checkout/order-token'
import { PlacementAttempts } from '../checkout/placement-attempt'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { formatPrice } from '../money'
import type { ManualPaymentOption, PaymentClaimInput, PaymentDue } from '../types'
import { usePaymentClaimMutation, useRefreshOrder } from './api'
import { claimErrors, claimProblem, cleanTransactionId, sendToKey, type ClaimField } from './manual-methods'

/**
 * How the shopper may see this order: the order page (a guest's saved token, or the signed-in
 * owner), the account area (the owner), or the track page (the order's mobile number).
 */
export type ClaimAccess = { kind: 'order' } | { kind: 'account' } | { kind: 'track'; phone: string }

/**
 * BD1c: "Pay for your order" — the amount still owed by Send Money (the whole order, or a cash on
 * delivery order's advance), the shop's number to send it to with a copy button, a method picker
 * when several can be used, the deadline, then the sender number + transaction ID form. Once sent
 * it says the shop is checking the payment; a rejected ID shows the reason and the form again.
 */
export function PaymentDueCard({ number, due, access, className }: { number: string; due: PaymentDue | null | undefined; access: ClaimAccess; className?: string }) {
  // The answer of a claim (the order's new `payment_due`) until the page's own data catches up.
  const [answer, setAnswer] = useState<{ for: PaymentDue | null | undefined; due: PaymentDue | null } | null>(null)
  // "Thank you" (and the focus) right after this shopper sent the details.
  const [justSent, setJustSent] = useState(false)
  const shown = answer && answer.for === due ? answer.due : due
  if (!shown) return null
  return (
    <PaymentDueBody
      key={`${shown.purpose}-${shown.claim?.transaction_id ?? ''}-${shown.claim?.status ?? ''}`}
      number={number}
      due={shown}
      access={access}
      className={className}
      justSent={justSent}
      onAnswer={(next) => {
        setJustSent(true)
        setAnswer({ for: due, due: next })
      }}
    />
  )
}

const cardClass = 'mt-6 flex flex-col gap-4 rounded-sf-card border-2 border-sf-primary bg-sf-surface p-5 md:p-6'

function PaymentDueBody({
  number,
  due,
  access,
  className,
  justSent,
  onAnswer,
}: {
  number: string
  due: PaymentDue
  access: ClaimAccess
  className?: string
  justSent: boolean
  onAnswer: (due: PaymentDue | null) => void
}) {
  const { t } = useLocale()
  const headingId = useId()
  const methods = Array.isArray(due.methods) ? due.methods : []
  const claim = due.claim
  const rejected = claim?.status === 'rejected'
  const submitted = claim?.status === 'submitted'
  const [methodCode, setMethodCode] = useState(() => (rejected && methods.some((m) => m.code === claim.method) ? claim.method : (methods[0]?.code ?? '')))
  const method = methods.find((m) => m.code === methodCode) ?? null
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (justSent) statusRef.current?.focus()
  }, [justSent])

  return (
    <section aria-labelledby={headingId} className={cn(cardClass, className)} data-testid="payment-due" data-purpose={due.purpose}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="flex items-center gap-2 font-heading text-xl font-bold text-sf-heading">
          <SmartphoneIcon aria-hidden className="size-5" />
          {due.purpose === 'advance' ? t('payments.due.titleAdvance') : t('payments.due.title')}
        </h2>
        <p className="text-sm">{t('payments.due.amountLabel')}</p>
        <p className="font-heading text-3xl font-extrabold text-sf-heading" data-testid="payment-due-amount">
          {formatPrice(due.amount, due.currency)}
        </p>
        {due.purpose === 'advance' && <p className="text-sm">{t('payments.due.advanceNote')}</p>}
      </div>

      {methods.length > 1 && !submitted && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-sf-heading">{t('payments.due.chooseMethod')}</legend>
          <div className="flex flex-wrap gap-2">
            {methods.map((option) => (
              <label
                key={option.code}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border-2 border-sf-border px-3 py-2 text-sm font-semibold text-sf-heading has-checked:border-sf-accent has-checked:bg-sf-accent/5 has-focus-visible:outline-2 has-focus-visible:outline-sf-accent"
                data-testid="payment-due-method"
              >
                <input type="radio" name={`${headingId}-method`} value={option.code} checked={methodCode === option.code} onChange={() => setMethodCode(option.code)} className="size-4 accent-sf-accent" />
                {option.display_name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {method && !submitted && <MethodDetails method={method} />}

      {due.expires_at && !submitted && (
        <p className="text-sm" data-testid="payment-due-deadline">
          {rich(t('payments.due.deadline'), {
            date: (
              <time dateTime={due.expires_at} className="font-semibold text-sf-heading">
                {formatDateTime(due.expires_at)}
              </time>
            ),
          })}
        </p>
      )}

      {submitted ? (
        <p ref={statusRef} tabIndex={-1} role="status" className="rounded-lg bg-sf-canvas px-4 py-3 font-medium text-sf-heading focus:outline-none" data-testid="payment-claim-submitted">
          {justSent && <span className="block">{t('payments.claim.sent')}</span>}
          {t('payments.claim.checking', { trxid: claim.transaction_id })}
        </p>
      ) : (
        <>
          {rejected && (
            <div className="rounded-lg bg-sf-sale/10 px-4 py-3 text-sm text-sf-sale" data-testid="payment-claim-rejected">
              <p className="font-semibold">{t('payments.claim.rejected', { trxid: claim.transaction_id })}</p>
              {claim.reject_reason && <p>{t('payments.claim.rejectedReason', { reason: claim.reject_reason })}</p>}
              <p>{t('payments.claim.tryAgain')}</p>
            </div>
          )}
          {method && (
            <ClaimForm
              number={number}
              method={method.code}
              access={access}
              initialSender={rejected ? claim.sender_phone : ''}
              onSent={onAnswer}
            />
          )}
        </>
      )}
    </section>
  )
}

function MethodDetails({ method }: { method: ManualPaymentOption }) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-sf-canvas px-4 py-3" data-testid="payment-due-account">
      <p className="text-sm font-semibold text-sf-heading">{method.display_name}</p>
      {method.account_number && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sf-heading">
          <span>
            {rich(t(sendToKey(method.account_type)), {
              number: (
                <strong className="font-heading text-lg tracking-wide" data-testid="payment-due-number">
                  {method.account_number}
                </strong>
              ),
            })}
          </span>
          <CopyNumberButton value={method.account_number} />
        </p>
      )}
      {method.instructions && <p className="text-sm whitespace-pre-line">{method.instructions}</p>}
      <p className="text-sm">{t('payments.due.steps')}</p>
    </div>
  )
}

function CopyNumberButton({ value }: { value: string }) {
  const { t } = useLocale()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-sf-button border border-sf-border bg-sf-surface px-3 py-1.5 text-sm font-semibold text-sf-heading hover:border-sf-accent hover:text-sf-accent"
      onClick={() => {
        try {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => undefined)
        } catch {
          // No clipboard (an old browser or a blocked permission): the number is on screen to copy by hand.
        }
      }}
      data-testid="payment-due-copy"
    >
      {copied ? <CheckIcon aria-hidden className="size-4" /> : <CopyIcon aria-hidden className="size-4" />}
      {copied ? t('payments.due.copied') : t('payments.due.copy')}
      <span className="sr-only" aria-live="polite">
        {copied ? t('payments.due.copied') : ''}
      </span>
    </button>
  )
}

function ClaimForm({ number, method, access, initialSender, onSent }: { number: string; method: string; access: ClaimAccess; initialSender: string; onSent: (due: PaymentDue | null) => void }) {
  const { t } = useLocale()
  const claim = usePaymentClaimMutation(number, access.kind !== 'track')
  const refresh = useRefreshOrder(number)
  const [attempts] = useState(() => new PlacementAttempts())
  const [sender, setSender] = useState(initialSender)
  const [trxid, setTrxid] = useState('')
  const [errors, setErrors] = useState<Partial<Record<ClaimField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (claim.isPending) return
    const values = { method, sender_phone: sender, transaction_id: trxid }
    const local = claimErrors(values)
    setErrors(local)
    setProblem(local.method ? t(local.method) : null)
    if (Object.keys(local).length > 0) return
    const input: PaymentClaimInput = { method, sender_phone: bdPhoneFrom(sender), transaction_id: cleanTransactionId(trxid) }
    if (access.kind === 'track') input.phone = access.phone
    else if (access.kind === 'order') {
      const token = readOrderToken(number)
      if (token) input.token = token
    }
    claim.mutate(
      { input, idempotencyKey: attempts.keyFor(input) },
      {
        onSuccess: (order) => {
          attempts.reset()
          onSent(order?.payment_due ?? null)
        },
        onError: (error) => {
          attempts.settle(error)
          const result = claimProblem(error, t)
          const next: Partial<Record<ClaimField, string>> = { ...(result.fields ?? {}) }
          if (result.field && result.field !== 'method' && !next[result.field]) next[result.field] = result.message
          setErrors(next)
          setProblem(result.field && result.field !== 'method' ? null : result.message)
          if (result.refresh) refresh()
        },
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2" aria-label={t('payments.claim.formLabel')} data-testid="payment-claim-form">
      <div className="sm:col-span-2">
        <FormAlert message={problem} />
      </div>
      <TextField
        label={t('payments.claim.sender')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        placeholder="01XXXXXXXXX"
        value={sender}
        onChange={(e) => setSender(e.target.value)}
        error={errors.sender_phone}
      />
      <TextField
        label={t('payments.claim.trxid')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        value={trxid}
        onChange={(e) => setTrxid(e.target.value)}
        error={errors.transaction_id}
        hint={t('payments.claim.trxidHint')}
      />
      <SubmitButton pending={claim.isPending} pendingLabel={t('payments.claim.pending')} className="sm:col-span-2">
        {t('payments.claim.submit')}
      </SubmitButton>
    </form>
  )
}
