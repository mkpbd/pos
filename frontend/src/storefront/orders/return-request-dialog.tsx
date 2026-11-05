import { useId, useRef, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { compareDecimal, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { FormAlert, inputClass, primaryButtonClass, secondaryButtonClass } from '../account/form-controls'
import { QuantityStepper } from '../cart/quantity-stepper'
import { displayQuantity } from '../cart/quantity'
import { PlacementAttempts } from '../checkout/placement-attempt'
import { formatDateTime } from '../checkout/delivery'
import { useLocale } from '../i18n/locale'
import { rich } from '../i18n/rich'
import { useNotice } from '../notices'
import type { AccountOrder, AccountOrderLine, ReturnReasonCode, ReturnRequestInput } from '../types'
import { RETURN_NOTE_MAX, RETURN_REASONS, lineIdOf, returnErrorMessage, returnableLines, returnableQuantity, useCreateReturnMutation } from './returns-api'

type LineChoice = { selected: boolean; quantity: string }

const nameOf = (line: AccountOrderLine) => (line.variant_name ? `${line.product_name} (${line.variant_name})` : line.product_name)

/** Fractions are allowed when the line was sold in fractions (e.g. by weight). */
const allowsDecimal = (line: AccountOrderLine) => trimDecimal(line.quantity).includes('.') || returnableQuantity(line).includes('.')

/** The chosen quantity, never above what can still be returned (the order may have been refreshed). */
function clamp(quantity: string, max: string): string {
  return compareDecimal(quantity, max) > 0 ? max : quantity
}

/**
 * "Return items": per line a checkbox and a quantity stepper up to the returnable quantity,
 * a reason and an optional note. Each attempt has its own Idempotency-Key; pressing the button
 * again after an open outcome (lost connection, 5xx) resends the same key, so the return is
 * not requested twice.
 */
export function ReturnRequestDialog({ order, open, onClose }: { order: AccountOrder; open: boolean; onClose: () => void }) {
  const create = useCreateReturnMutation(order.number)
  const attempts = useRef(new PlacementAttempts())
  const notify = useNotice()
  const { t, formatNumber } = useLocale()
  const id = useId()
  const [picks, setPicks] = useState<Record<string, LineChoice>>({})
  const [reason, setReason] = useState<ReturnReasonCode | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ lines?: string; reason?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const lines = returnableLines(order)

  const pickOf = (line: AccountOrderLine): LineChoice => {
    const max = returnableQuantity(line)
    const pick = picks[lineIdOf(line) ?? '']
    return pick ? { ...pick, quantity: clamp(pick.quantity, max) } : { selected: false, quantity: max }
  }

  const update = (line: AccountOrderLine, change: Partial<LineChoice>) => {
    const key = lineIdOf(line)
    if (!key) return
    setPicks((current) => ({ ...current, [key]: { ...pickOf(line), ...change } }))
    if (change.selected) setErrors((e) => ({ ...e, lines: undefined }))
  }

  const reset = () => {
    setPicks({})
    setReason('')
    setNote('')
    setErrors({})
    setFormError(null)
    attempts.current.reset()
  }

  const close = () => {
    if (create.isPending) return
    setErrors({})
    setFormError(null)
    onClose()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const chosen = lines.flatMap((line) => {
      const pick = pickOf(line)
      const lineId = lineIdOf(line)
      return pick.selected && lineId ? [{ order_line_id: lineId, quantity: pick.quantity }] : []
    })
    const nextErrors = {
      lines: chosen.length === 0 ? t('orders.returnForm.chooseItemError') : undefined,
      reason: reason === '' ? t('orders.returnForm.chooseReasonError') : undefined,
    }
    setErrors(nextErrors)
    if (nextErrors.lines || nextErrors.reason || reason === '') return

    const trimmed = note.trim()
    const input: ReturnRequestInput = { reason_code: reason, ...(trimmed ? { note: trimmed } : {}), lines: chosen }
    const idempotencyKey = attempts.current.keyFor({ number: order.number, ...input })
    create.mutate(
      { input, idempotencyKey },
      {
        onSuccess: (created) => {
          attempts.current.settle()
          notify(created?.number ? t('orders.returnForm.requested', { number: created.number }) : t('orders.returnForm.requestedGeneric'))
          reset()
          onClose()
        },
        onError: (failure) => {
          attempts.current.settle(failure)
          setFormError(returnErrorMessage(failure, t))
        },
      },
    )
  }

  const linesErrorId = `${id}-lines-error`
  const reasonErrorId = `${id}-reason-error`
  const noteHintId = `${id}-note-hint`

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-sf-surface p-5 sm:max-w-lg md:p-6">
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={t('orders.returnForm.title')}>
          <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">{t('orders.returnForm.title')}</DialogTitle>
          <DialogDescription>
            {t('orders.returnForm.intro', { number: order.number })}
            {order.return_deadline && (
              <>
                {' '}
                {rich(t('orders.returnForm.until'), {
                  date: (
                    <time dateTime={order.return_deadline} className="font-semibold text-sf-heading">
                      {formatDateTime(order.return_deadline)}
                    </time>
                  ),
                })}
              </>
            )}{' '}
            {t('orders.returnForm.fees')}
          </DialogDescription>
          <FormAlert message={formError} />

          <fieldset className="flex flex-col gap-3" aria-describedby={errors.lines ? linesErrorId : undefined} disabled={create.isPending}>
            <legend className="mb-1.5 text-sm font-medium text-sf-heading">{t('orders.returnForm.itemsLegend')}</legend>
            {lines.length === 0 ? (
              <p className="text-sm">{t('orders.returnForm.nothingLeft')}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border border-sf-border">
                {lines.map((line) => {
                  const pick = pickOf(line)
                  const max = returnableQuantity(line)
                  const name = nameOf(line)
                  const checkboxId = `${id}-line-${lineIdOf(line)}`
                  return (
                    <li key={lineIdOf(line)} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="return-line">
                      <div className="flex min-w-0 items-start gap-2">
                        <input id={checkboxId} type="checkbox" className="mt-1 size-4 accent-sf-accent" checked={pick.selected} onChange={(e) => update(line, { selected: e.target.checked })} />
                        <label htmlFor={checkboxId} className="text-sm">
                          <span className="block font-semibold text-sf-heading">{t('orders.returnForm.returnLine', { name })}</span>
                          <span className="text-xs">{t('orders.returnForm.upTo', { max: formatNumber(displayQuantity(max)) })}</span>
                        </label>
                      </div>
                      {pick.selected && (
                        <QuantityStepper
                          size="sm"
                          value={pick.quantity}
                          max={max}
                          allowDecimal={allowsDecimal(line)}
                          label={t('orders.returnForm.quantityLabel', { name })}
                          onChange={(quantity) => update(line, { quantity: clamp(quantity, max) })}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {errors.lines && (
              <p id={linesErrorId} className="text-sm text-sf-sale">
                {errors.lines}
              </p>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium text-sf-heading">
              {t('orders.returnForm.reason')}
            </label>
            <select
              id={`${id}-reason`}
              className={inputClass}
              value={reason}
              required
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? reasonErrorId : undefined}
              disabled={create.isPending}
              onChange={(e) => {
                setReason(e.target.value as ReturnReasonCode | '')
                setErrors((current) => ({ ...current, reason: undefined }))
              }}
            >
              <option value="">{t('orders.returnForm.chooseReason')}</option>
              {RETURN_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.label)}
                </option>
              ))}
            </select>
            {errors.reason && (
              <p id={reasonErrorId} className="text-sm text-sf-sale">
                {errors.reason}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-note`} className="text-sm font-medium text-sf-heading">
              {t('orders.returnForm.comments')}
            </label>
            <textarea
              id={`${id}-note`}
              rows={3}
              maxLength={RETURN_NOTE_MAX}
              value={note}
              aria-describedby={noteHintId}
              onChange={(e) => setNote(e.target.value)}
              className={cn(inputClass, 'resize-y')}
              disabled={create.isPending}
            />
            <p id={noteHintId} className="text-xs">
              {t('orders.returnForm.characters', { count: note.length, max: RETURN_NOTE_MAX })}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primaryButtonClass} disabled={create.isPending || lines.length === 0}>
              {create.isPending ? t('orders.returnForm.sending') : t('orders.returnForm.submit')}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={create.isPending} onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
