import { useId, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { FormAlert, SubmitButton, TextField, inputClass, secondaryButtonClass } from '../account/form-controls'
import { storeFormError } from '../form-errors'
import { useLocale } from '../i18n/locale'
import type { MessageKey } from '../i18n/en'
import { useNotice } from '../notices'
import type { MyReview } from '../types'
import { reviewErrorMessage, reviewStatusLabel, useCreateReviewMutation, useDeleteReviewMutation, useUpdateReviewMutation } from './api'
import { StarRatingInput } from './stars'

export const TITLE_MAX = 120
export const BODY_MIN = 10
export const BODY_MAX = 2000

/** What the dialog works on: a new review of a product, or the customer's existing review. */
export type ReviewTarget = { mode: 'create'; productId: string; productName: string } | { mode: 'edit'; review: MyReview; productName: string }

type Errors = Partial<Record<'rating' | 'title' | 'body', string>>

/** Client-side checks; the messages are dictionary keys (shown through translateMessage, like the server's field messages). */
function validate(rating: number | null, title: string, body: string): Errors {
  const errors: Partial<Record<keyof Errors, MessageKey>> = {}
  if (!rating) errors.rating = 'reviews.form.ratingRequired'
  if (title.trim().length > TITLE_MAX) errors.title = 'reviews.form.titleTooLong'
  const length = body.trim().length
  if (length < BODY_MIN) errors.body = 'reviews.form.bodyTooShort'
  else if (length > BODY_MAX) errors.body = 'reviews.form.bodyTooLong'
  return errors
}

const LIMITS = { min: BODY_MIN, max: BODY_MAX }
const VARS: Record<keyof Errors, Record<string, number>> = { rating: { min: 1, max: 5 }, title: { max: TITLE_MAX }, body: LIMITS }

/** Writing, editing or deleting a review in a dialog. Every saved review is checked by the store before it is published. */
export function ReviewDialog({ target, onClose }: { target: ReviewTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto bg-sf-surface p-5 sm:max-w-lg md:p-6">
        {target && <ReviewForm key={target.mode === 'edit' ? target.review.id : target.productId} target={target} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ReviewForm({ target, onDone }: { target: ReviewTarget; onDone: () => void }) {
  const existing = target.mode === 'edit' ? target.review : null
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const create = useCreateReviewMutation()
  const update = useUpdateReviewMutation()
  const remove = useDeleteReviewMutation()
  const notify = useNotice()
  const { t, translateMessage } = useLocale()
  const shown = (field: keyof Errors) => (errors[field] ? translateMessage(errors[field], VARS[field]) : undefined)
  const bodyId = useId()
  const pending = create.isPending || update.isPending

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      const fields = error.fieldErrors
      const mapped: Errors = { rating: fields.rating?.[0], title: fields.title?.[0], body: fields.body?.[0] }
      if (mapped.rating || mapped.title || mapped.body) {
        setErrors(mapped)
        return
      }
    }
    setFormError(reviewErrorMessage(error, t) ?? storeFormError(error, t))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const found = validate(rating, title, body)
    setErrors(found)
    if (Object.keys(found).length > 0 || !rating) return
    const input = { rating, title: title.trim() || null, body: body.trim() }
    const onSuccess = () => {
      notify(existing ? t('reviews.form.updated') : t('reviews.form.thanks'))
      onDone()
    }
    if (target.mode === 'edit') update.mutate({ id: target.review.id, input }, { onSuccess, onError })
    else create.mutate({ product_id: target.productId, ...input }, { onSuccess, onError })
  }

  const deleteReview = () => {
    if (!existing) return
    setFormError(null)
    remove.mutate(existing.id, {
      onSuccess: () => {
        notify(t('reviews.form.deleted'))
        onDone()
      },
      onError: (error) => {
        setConfirmDelete(false)
        setFormError(reviewErrorMessage(error, t) ?? storeFormError(error, t))
      },
    })
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={existing ? t('reviews.form.edit') : t('reviews.form.write')}>
      <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">{existing ? t('reviews.form.edit') : t('reviews.form.write')}</DialogTitle>
      <DialogDescription>
        {t(existing ? 'reviews.form.editDescription' : 'reviews.form.newDescription', { product: target.productName })}
      </DialogDescription>
      {existing && (
        <p className="text-sm" data-testid="review-status">
          {t('reviews.form.status')} <strong className="text-sf-heading">{reviewStatusLabel(existing.status, t)}</strong>
          {existing.status === 'rejected' && existing.rejection_reason ? ` — ${existing.rejection_reason}` : ''}
        </p>
      )}
      <FormAlert message={formError} />
      <StarRatingInput value={rating} onChange={setRating} error={shown('rating')} disabled={pending} />
      <TextField label={t('reviews.form.title')} maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} error={shown('title')} disabled={pending} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bodyId} className="text-sm font-medium text-sf-heading">
          {t('reviews.form.body')}
        </label>
        <textarea
          id={bodyId}
          rows={5}
          maxLength={BODY_MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={`${bodyId}-message`}
          className={cn(inputClass, 'resize-y')}
        />
        <p id={`${bodyId}-message`} className={cn('text-sm', errors.body && 'text-sf-sale')}>
          {shown('body') ?? t('reviews.form.bodyHint', { min: BODY_MIN })}
        </p>
      </div>
      {confirmDelete ? (
        <div className="flex flex-col gap-3 rounded-lg bg-sf-sale/10 p-4" role="group" aria-label={t('reviews.form.delete')}>
          <p className="text-sm font-semibold text-sf-heading">{t('reviews.form.deleteConfirm')}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={cn(secondaryButtonClass, 'border-sf-sale text-sf-sale')} disabled={remove.isPending} onClick={deleteReview}>
              {remove.isPending ? t('reviews.form.deleting') : t('reviews.form.confirmDelete')}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setConfirmDelete(false)}>
              {t('reviews.form.keep')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <SubmitButton pending={pending} pendingLabel={t('reviews.form.saving')}>
            {existing ? t('reviews.form.save') : t('reviews.form.submit')}
          </SubmitButton>
          <button type="button" className={secondaryButtonClass} onClick={onDone}>
            {t('common.cancel')}
          </button>
          {existing && (
            <button type="button" className={cn(secondaryButtonClass, 'ml-auto hover:border-sf-sale hover:text-sf-sale')} disabled={pending} onClick={() => setConfirmDelete(true)}>
              {t('reviews.form.delete')}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
