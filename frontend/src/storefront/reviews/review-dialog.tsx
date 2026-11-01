import { useId, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { FormAlert, SubmitButton, TextField, inputClass, secondaryButtonClass } from '../account/form-controls'
import { storeFormError } from '../form-errors'
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

function validate(rating: number | null, title: string, body: string): Errors {
  const errors: Errors = {}
  if (!rating) errors.rating = 'Please choose a rating from 1 to 5 stars.'
  if (title.trim().length > TITLE_MAX) errors.title = `The title can be at most ${TITLE_MAX} characters.`
  const length = body.trim().length
  if (length < BODY_MIN) errors.body = `Please write at least ${BODY_MIN} characters.`
  else if (length > BODY_MAX) errors.body = `The review can be at most ${BODY_MAX} characters.`
  return errors
}

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
    setFormError(reviewErrorMessage(error) ?? storeFormError(error))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const found = validate(rating, title, body)
    setErrors(found)
    if (Object.keys(found).length > 0 || !rating) return
    const input = { rating, title: title.trim() || null, body: body.trim() }
    const onSuccess = () => {
      notify(existing ? 'Your review was updated. We will publish it once it has been checked.' : 'Thank you for your review! We will publish it once it has been checked.')
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
        notify('Your review was deleted.')
        onDone()
      },
      onError: (error) => {
        setConfirmDelete(false)
        setFormError(reviewErrorMessage(error) ?? storeFormError(error))
      },
    })
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label={existing ? 'Edit your review' : 'Write a review'}>
      <DialogTitle className="pr-8 font-heading text-2xl font-extrabold text-sf-heading">{existing ? 'Edit your review' : 'Write a review'}</DialogTitle>
      <DialogDescription>
        {target.productName}
        {existing ? ' — an edited review is checked again before it is published.' : ' — your review is published once the store has checked it.'}
      </DialogDescription>
      {existing && (
        <p className="text-sm" data-testid="review-status">
          Status: <strong className="text-sf-heading">{reviewStatusLabel(existing.status)}</strong>
          {existing.status === 'rejected' && existing.rejection_reason ? ` — ${existing.rejection_reason}` : ''}
        </p>
      )}
      <FormAlert message={formError} />
      <StarRatingInput value={rating} onChange={setRating} error={errors.rating} disabled={pending} />
      <TextField label="Title (optional)" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} disabled={pending} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bodyId} className="text-sm font-medium text-sf-heading">
          Your review
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
          {errors.body ?? `What did you like or dislike? At least ${BODY_MIN} characters.`}
        </p>
      </div>
      {confirmDelete ? (
        <div className="flex flex-col gap-3 rounded-lg bg-sf-sale/10 p-4" role="group" aria-label="Delete review">
          <p className="text-sm font-semibold text-sf-heading">Delete this review? This cannot be undone.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={cn(secondaryButtonClass, 'border-sf-sale text-sf-sale')} disabled={remove.isPending} onClick={deleteReview}>
              {remove.isPending ? 'Deleting…' : 'Yes, delete review'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <SubmitButton pending={pending} pendingLabel="Saving…">
            {existing ? 'Save review' : 'Submit review'}
          </SubmitButton>
          <button type="button" className={secondaryButtonClass} onClick={onDone}>
            Cancel
          </button>
          {existing && (
            <button type="button" className={cn(secondaryButtonClass, 'ml-auto hover:border-sf-sale hover:text-sf-sale')} disabled={pending} onClick={() => setConfirmDelete(true)}>
              Delete review
            </button>
          )}
        </div>
      )}
    </form>
  )
}
