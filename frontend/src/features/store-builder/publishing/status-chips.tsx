import { useState } from 'react'
import { CalendarClockIcon, CalendarX2Icon, ClockIcon, Loader2Icon, MessageSquareWarningIcon } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useCurrentUserQuery } from '@/features/auth/api'
import { failureText, type DocumentReview, type DocumentSchedule } from '../publishing-api'
import { formatStoreTime, storeTimeLabel } from './schedule-time'

/*
 * B11 status chips of the editor toolbar: a planned publish ("Goes live 20 Nov, 09:00", cancel)
 * or one that failed, and the approval state ("Waiting for approval", "Sent back"). Each chip is a
 * button opening the details. Their names avoid the word "publish", which the toolbar's Publish
 * button owns.
 */

const chip = 'inline-flex h-7 max-w-56 items-center gap-1.5 truncate rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0'

export function ScheduleChip({ schedule, timeZone, canChange, onCancel, onReschedule, noun = 'page' }: {
  schedule: DocumentSchedule | null
  /** What goes live ("page", "theme"). */
  noun?: string
  timeZone: string | undefined
  /** Cancel / pick a new time (the publish permission). */
  canChange: boolean
  onCancel: () => Promise<void>
  onReschedule: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!schedule || (schedule.status !== 'pending' && schedule.status !== 'failed')) return null
  const failed = schedule.status === 'failed'
  const when = formatStoreTime(schedule.publish_at, timeZone)
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="schedule-chip"
            className={cn(chip, failed ? 'border-destructive/40 bg-destructive/10 text-destructive-soft-foreground' : 'border-info/40 bg-info/10 text-info-soft-foreground')}
            aria-label={failed ? 'Did not go live as planned. Show why' : `Scheduled: goes live ${when}. Show details`}
          >
            {failed ? <CalendarX2Icon aria-hidden /> : <CalendarClockIcon aria-hidden />}
            <span className="truncate">{failed ? 'Didn’t go live' : `Goes live ${formatStoreTime(schedule.publish_at, timeZone, { short: true })}`}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-80 flex-col gap-2 text-sm" data-testid="schedule-details">
          {failed ? (
            <>
              <p className="font-medium">It didn’t go live on {when}</p>
              <p>{failureText(schedule) ?? 'Something on the page was missing when it was time.'} Your shop still shows the earlier version.</p>
              {canChange && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    onReschedule()
                  }}
                >
                  Fix it and choose a new time
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="font-medium">Goes live on {when}</p>
              <p className="text-xs text-muted-foreground">
                In {storeTimeLabel(timeZone)}. The {noun} goes live as it was when this was planned
                {schedule.created_by?.name ? ` by ${schedule.created_by.name}` : ''}. Later changes stay in your draft.
              </p>
              {schedule.note && <p className="rounded bg-muted px-2 py-1">{schedule.note}</p>}
              {canChange && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpen(false)
                      onReschedule()
                    }}
                  >
                    <ClockIcon aria-hidden /> Change the time
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      setOpen(false)
                      setConfirm(true)
                    }}
                  >
                    {busy && <Loader2Icon className="animate-spin" aria-hidden />} Cancel it
                  </Button>
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel the planned publish?"
        description={`The ${noun} won’t go live on ${when}. Your draft stays as it is, and you can publish it whenever you like.`}
        confirmLabel="Cancel it"
        pending={busy}
        onConfirm={() => {
          setBusy(true)
          void onCancel().finally(() => {
            setBusy(false)
            setConfirm(false)
          })
        }}
      />
    </>
  )
}

export function ReviewChip({ review, canPublish, onOpenReview, onResubmit, onWithdraw }: {
  review: DocumentReview | null
  canPublish: boolean
  /** Publishers: open the review screen. */
  onOpenReview: () => void
  /** Submitters: send it again after fixing. */
  onResubmit: () => void
  /** Submitters: take a pending request back. */
  onWithdraw: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  if (!review || (review.status !== 'pending' && review.status !== 'sent_back')) return null
  const pending = review.status === 'pending'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="review-chip"
          className={cn(chip, pending ? 'border-warning/50 bg-warning/15 text-warning-soft-foreground' : 'border-destructive/40 bg-destructive/10 text-destructive-soft-foreground')}
          aria-label={pending ? 'Waiting for approval. Show details' : 'Sent back with a comment. Show it'}
        >
          {pending ? <ClockIcon aria-hidden /> : <MessageSquareWarningIcon aria-hidden />}
          <span className="truncate">{pending ? 'Waiting for approval' : review.comment ? `Sent back: ${review.comment}` : 'Sent back'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2 text-sm" data-testid="review-details">
        {pending ? (
          <>
            <p className="font-medium">Waiting for approval</p>
            <p className="text-xs text-muted-foreground">
              Sent {formatStoreTime(review.submitted_at, timeZone)}
              {review.submitted_by?.name ? ` by ${review.submitted_by.name}` : ''}.
              {review.draft_changed ? ' The draft changed since then; the version that was sent is what gets approved.' : ''}
            </p>
            {review.note && <p className="rounded bg-muted px-2 py-1 whitespace-pre-line">{review.note}</p>}
            {canPublish ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  onOpenReview()
                }}
              >
                Open the review
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={withdrawing}
                onClick={() => {
                  setWithdrawing(true)
                  void onWithdraw().finally(() => {
                    setWithdrawing(false)
                    setOpen(false)
                  })
                }}
              >
                {withdrawing && <Loader2Icon className="animate-spin" aria-hidden />} Withdraw the request
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="font-medium">Sent back{review.decided_by?.name ? ` by ${review.decided_by.name}` : ''}</p>
            <p className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 whitespace-pre-line">{review.comment || 'No comment.'}</p>
            {!canPublish && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  onResubmit()
                }}
              >
                Submit again
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
