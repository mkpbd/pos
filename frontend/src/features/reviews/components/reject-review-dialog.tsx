import { useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { Review } from '@/features/reviews/api'

type Props = {
  review: Review
  pending: boolean
  error?: string
  onReject: (reason: string | null) => void
  onClose: () => void
}

/** Rejecting hides the review from the store; the optional reason is shown to its author. */
export function RejectReviewDialog({ review, pending, error, onReject, onClose }: Props) {
  const [reason, setReason] = useState(review.rejection_reason ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pending) return
    onReject(reason.trim() || null)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this review?</DialogTitle>
          <DialogDescription>
            {review.customer.name}'s review of {review.product.name} will not be shown in the store. The customer sees the reason in their account and can edit the review.
          </DialogDescription>
        </DialogHeader>
        <form id="reject-review-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Reason (optional)" error={error} hint="Shown to the customer (max. 200 characters).">
            <Textarea autoFocus rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. contains personal contact details" />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Back</Button>
          <Button type="submit" form="reject-review-form" variant="destructive" disabled={pending}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Reject review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
