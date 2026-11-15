import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, ClipboardCheckIcon, Loader2Icon, MessageSquareIcon, TriangleAlertIcon, Undo2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUserQuery } from '@/features/auth/api'
import { ApiError } from '@/lib/api/client'
import { builderAdminKeys, useCanvasContextQuery, useDocumentsQuery, useElementsQuery } from '../api'
import { kindInfo } from '../document-kind'
import { approveReview, fetchLiveRender, fetchReview, publishingKeys, REVIEW_COMMENT_MAX, REVIEW_NOTE_MAX, sendBackReview, type DocumentReview, type ReviewDetail } from '../publishing-api'
import type { PageCheck } from '../use-page-check'
import { countsText } from '../page-check'
import { checkScheduleInput, defaultScheduleInput, formatStoreTime, scheduleBounds, storeTimeLabel } from './schedule-time'
import { SideBySide, type ChangesState, type Side } from './side-by-side'
import { canvasSurroundings } from './surroundings'

/*
 * B11 approval. People who may edit but not publish send the draft for approval ("Submit for
 * review"); people who may publish open the review: the live page and the page that was sent, side
 * by side with the list of changes, then Approve & publish (now or at a time) or Send back with a
 * comment. The editor stays English like the rest of the page builder.
 */

/* ---------------------------------------------------------------- submit ------------------- */

export function SubmitReviewDialog({ open, onOpenChange, pending, error, onSubmit, noun, current, check }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error: string | null
  onSubmit: (note: string | null) => void
  noun: string
  /** The document's latest review (a pending one is replaced; a sent-back one shows its comment). */
  current: DocumentReview | null
  check?: PageCheck
}) {
  const [note, setNote] = useState('')
  const id = useId()
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('')
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit this {noun} for review?</DialogTitle>
          <DialogDescription>
            Someone who is allowed to publish checks it and puts it live, or sends it back with a comment. The {noun} is sent as it is now; you can keep editing your draft.
          </DialogDescription>
        </DialogHeader>
        <form
          id="review-form"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(note.trim() || null)
          }}
        >
          {current?.status === 'sent_back' && current.comment && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="sent-back-comment">
              <p className="font-medium">Last time it was sent back{current.decided_by?.name ? ` by ${current.decided_by.name}` : ''}:</p>
              <p className="mt-1 whitespace-pre-line">{current.comment}</p>
            </div>
          )}
          {current?.status === 'pending' && <p className="text-sm text-muted-foreground">It is already waiting for approval (sent {formatStoreTime(current.submitted_at, timeZone)}). Sending it again replaces that request with the {noun} as it is now.</p>}
          {check && (
            <p className="flex items-center gap-2 text-sm" role="status">
              {check.counts.errors > 0 ? <CircleAlertIcon className="size-4 text-destructive" aria-hidden /> : <ClipboardCheckIcon className="size-4 text-muted-foreground" aria-hidden />}
              Page check: {countsText(check.counts)}
            </p>
          )}
          <Label htmlFor={id}>Message for the person who approves (optional)</Label>
          <Textarea id={id} value={note} maxLength={REVIEW_NOTE_MAX} rows={3} placeholder="e.g. New Eid banners — please publish before Friday" onChange={(e) => setNote(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="review-form" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden />} Submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- review screen ------------ */

type Decision = { kind: 'approved'; scheduled: string | null } | { kind: 'sent_back' }

/** 409 REVIEW_NOT_PENDING: someone else decided (or it was withdrawn) — the screen shows where it stands. */
const isNotPending = (error: unknown) => error instanceof ApiError && (error.code === 'REVIEW_NOT_PENDING' || error.status === 409)

function DecisionPanel({ review, onDecided, onStale }: { review: ReviewDetail; onDecided: (decision: Decision) => void; onStale: () => void }) {
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => defaultScheduleInput(timeZone))
  const [atError, setAtError] = useState<string | null>(null)
  const [sendingBack, setSendingBack] = useState(false)
  const [comment, setComment] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'back' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = useId()
  const bounds = scheduleBounds(timeZone)
  const checked = when === 'later' ? checkScheduleInput(at, timeZone) : null
  // A publish planned for the page already: approving now cancels it unless unticked.
  const documents = useDocumentsQuery()
  const schedule = review.document.schedule ?? documents.data?.find((d) => d.id === review.document.id)?.schedule ?? null
  const planned = schedule?.status === 'pending' ? schedule : null
  const [cancelPlanned, setCancelPlanned] = useState(true)
  const fail = (e: unknown) => {
    if (isNotPending(e)) {
      toast.info('Someone already decided on this request, or it was withdrawn. Here is where it stands now.')
      onStale()
      return
    }
    setError(e instanceof ApiError && e.code === 'DOCUMENT_INVALID' ? `It can’t be published as it is: ${e.message} Send it back so it can be fixed.` : e instanceof Error ? e.message : 'Something went wrong. Try again.')
  }

  const approve = async () => {
    let publishAt: string | null = null
    if (when === 'later') {
      if (!checked || !checked.ok) {
        setAtError(checked && !checked.ok ? checked.error : 'Choose the date and time it should go live.')
        return
      }
      publishAt = checked.iso
    }
    setBusy('approve')
    setError(null)
    try {
      await approveReview(review.id, { publish_at: publishAt, note: null, ...(planned && !publishAt ? { cancel_schedule: cancelPlanned } : {}) })
      onDecided({ kind: 'approved', scheduled: publishAt })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const sendBack = async () => {
    const text = comment.trim()
    if (!text) {
      setCommentError('Write what should change, so they know what to fix.')
      return
    }
    setBusy('back')
    setError(null)
    try {
      await sendBackReview(review.id, text)
      onDecided({ kind: 'sent_back' })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  if (review.status !== 'pending') {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        {review.status === 'approved' ? 'This request was approved' : review.status === 'withdrawn' ? 'This request was withdrawn' : 'This request was sent back'}
        {review.decided_by?.name ? ` by ${review.decided_by.name}` : ''}
        {review.decided_at ? ` on ${formatStoreTime(review.decided_at, timeZone)}` : ''}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t p-3" data-testid="review-decision">
      {!sendingBack ? (
        <>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Approve and publish</legend>
            {(
              [
                { value: 'now', label: 'Now' },
                { value: 'later', label: 'Later, at a time I choose' },
              ] as const
            ).map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${ids}-when`} value={option.value} checked={when === option.value} onChange={() => setWhen(option.value)} className="accent-primary" />
                {option.label}
              </label>
            ))}
          </fieldset>
          {when === 'now' && planned && (
            <label className="flex items-start gap-2 rounded-md border border-info/40 bg-info/5 p-2 text-sm">
              <input type="checkbox" checked={cancelPlanned} onChange={(e) => setCancelPlanned(e.target.checked)} className="mt-0.5 accent-primary" />
              <span>A publish is planned for {formatStoreTime(planned.publish_at, timeZone)}. Cancel it (this goes live now)</span>
            </label>
          )}
          {when === 'later' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-at`}>Date and time</Label>
              <Input
                id={`${ids}-at`}
                type="datetime-local"
                value={at}
                min={bounds.min}
                max={bounds.max}
                aria-invalid={atError ? true : undefined}
                aria-describedby={`${ids}-at-hint${atError ? ` ${ids}-at-error` : ''}`}
                onChange={(e) => {
                  setAt(e.target.value)
                  setAtError(null)
                }}
              />
              <p id={`${ids}-at-hint`} className="text-xs text-muted-foreground">
                In {storeTimeLabel(timeZone)}.{checked?.ok && ` Goes live on ${formatStoreTime(checked.iso, timeZone)}.`}
              </p>
              {atError && (
                <p id={`${ids}-at-error`} role="alert" className="text-sm text-destructive">
                  {atError}
                </p>
              )}
            </div>
          )}
          <Button type="button" disabled={busy !== null} onClick={() => void approve()}>
            {busy === 'approve' ? <Loader2Icon className="animate-spin" aria-hidden /> : <ClipboardCheckIcon aria-hidden />}
            {when === 'later' ? 'Approve and schedule' : 'Approve and publish now'}
          </Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setSendingBack(true)}>
            <Undo2Icon aria-hidden /> Send back…
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void sendBack()
          }}
        >
          <Label htmlFor={`${ids}-comment`}>What should change? (required)</Label>
          <Textarea
            id={`${ids}-comment`}
            value={comment}
            rows={4}
            autoFocus
            required
            maxLength={REVIEW_COMMENT_MAX}
            placeholder="e.g. The price on the banner is wrong — it should be 450 Tk."
            aria-invalid={commentError ? true : undefined}
            aria-describedby={commentError ? `${ids}-comment-error` : undefined}
            onChange={(e) => {
              setComment(e.target.value)
              setCommentError(null)
            }}
          />
          {commentError && (
            <p id={`${ids}-comment-error`} role="alert" className="text-sm text-destructive">
              {commentError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy !== null}>
              {busy === 'back' ? <Loader2Icon className="animate-spin" aria-hidden /> : <MessageSquareIcon aria-hidden />} Send back
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSendingBack(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The review of one request (full screen): the live version and the version that was sent side by
 * side, what changed, and the decision. `onDecided` runs after an approve or send back.
 */
export function ReviewScreen({ reviewId, onClose, onDecided }: { reviewId: string | null; onClose: () => void; onDecided?: (decision: Decision, review: ReviewDetail) => void }) {
  const queryClient = useQueryClient()
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  const review = useQuery({ queryKey: publishingKeys.review(reviewId ?? '-'), queryFn: ({ signal }) => fetchReview(reviewId as string, signal), enabled: reviewId !== null, staleTime: 0 })
  const context = useCanvasContextQuery()
  const elements = useElementsQuery()
  const labels = new Map<string, string>((elements.data?.types ?? []).map((t) => [t.type as string, t.label]))
  const typeLabel = (type: string) => labels.get(type) ?? (type === 'section' ? 'Section' : type === 'column' ? 'Column' : type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))

  const data = review.data
  const doc = data?.document
  const live = useQuery({ queryKey: publishingKeys.render(doc?.id ?? '-', 'live'), queryFn: ({ signal }) => fetchLiveRender(doc!.id, signal), enabled: doc !== undefined, staleTime: 60_000 })
  const info = doc ? kindInfo({ kind: doc.kind, key: doc.key }) : null
  const right: Side = review.isPending ? { status: 'loading' } : review.error ? { status: 'error', error: review.error, retry: () => void review.refetch() } : { status: 'ready', payload: data!.render }
  const left: Side = review.error
    ? { status: 'error', error: review.error, retry: () => void review.refetch() }
    : review.isPending || live.isPending
      ? { status: 'loading' }
      : live.error
        ? { status: 'error', error: live.error, retry: () => void live.refetch() }
        : live.data
          ? { status: 'ready', payload: live.data }
          : { status: 'empty', text: `Not live yet: shoppers don’t see this ${info?.noun ?? 'page'}.` }
  const changes: ChangesState = review.isPending ? { status: 'loading' } : review.error ? { status: 'error', error: review.error, retry: () => void review.refetch() } : { status: 'ready', result: data!.changes }

  const decided = (decision: Decision) => {
    if (!data) return
    void queryClient.invalidateQueries({ queryKey: ['store-builder', 'reviews'] })
    void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    const name = `“${data.document.title}”`
    if (decision.kind === 'sent_back') toast.success(`${name} was sent back${data.submitted_by?.name ? ` to ${data.submitted_by.name}` : ''} with your comment.`)
    else if (decision.scheduled) toast.success(`Approved. ${name} goes live on ${formatStoreTime(decision.scheduled, timeZone)}.`)
    else toast.success(`Approved. ${name} is live now.`)
    onDecided?.(decision, data)
    onClose()
  }

  return (
    <Dialog open={reviewId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none" data-testid="review-screen">
        <DialogHeader className="flex flex-row flex-wrap items-start gap-3 border-b px-4 py-2">
          <div className="mr-auto flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardCheckIcon className="size-5" aria-hidden /> Review: {doc?.title ?? '…'}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {data ? `Sent by ${data.submitted_by?.name ?? 'a team member'} on ${formatStoreTime(data.submitted_at, timeZone)} (store time). Left: what shoppers see now. Right: what was sent for approval.` : 'Loading the request…'}
            </DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close review" onClick={onClose}>
            <XIcon />
          </Button>
        </DialogHeader>
        {data?.draft_changed && data.status === 'pending' && (
          <p role="note" className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm" data-testid="draft-changed">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            The draft was edited after it was sent. Approving publishes the version that was sent (shown on the right), not the newer edits.
          </p>
        )}
        {context.error ? (
          <div className="p-6">
            <ErrorState title="Could not load the preview" error={context.error} onRetry={() => void context.refetch()} />
          </div>
        ) : !context.data ? (
          <p role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <SideBySide
              bootstrap={context.data.bootstrap}
              surroundings={doc ? canvasSurroundings(doc) : 'page'}
              emptyText={`Nothing on this ${info?.noun ?? 'page'} yet.`}
              typeLabel={typeLabel}
              left={{ title: 'Live now', label: 'Live now', side: left }}
              right={{ title: 'Sent for approval', label: 'Sent for approval', side: right }}
              changes={changes}
            />
            {data && (
              <aside aria-label="Your decision" className="flex w-full shrink-0 flex-col overflow-y-auto border-t bg-background lg:w-72 lg:border-t-0 lg:border-l">
                {data.note && (
                  <div className="border-b p-3 text-sm">
                    <p className="font-medium">Their message</p>
                    <p className="mt-1 whitespace-pre-line break-words">{data.note}</p>
                  </div>
                )}
                <DecisionPanel
                  key={`${data.id}:${data.status}`}
                  review={data}
                  onDecided={decided}
                  onStale={() => {
                    void review.refetch()
                    void queryClient.invalidateQueries({ queryKey: ['store-builder', 'reviews'] })
                    void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
                  }}
                />
              </aside>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export type { Decision as ReviewDecision }
