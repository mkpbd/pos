import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatStoreTime, scheduleBounds, storeTimeLabel } from './schedule-time'
import type { PublishWhen } from './use-publish-when'

/*
 * B11 "When should it go live?" — shared by the page publish dialog and the theme publish dialog
 * (Theme page and the builder's Site styles): Publish now | Publish later (a date and time in the
 * store's timezone), and, when a publish is already planned, "Cancel it" (ticked) for publishing now.
 */

/** The radios, the date and time, and the planned-publish choice (nothing without `later`). */
export function PublishWhenFields({ when, noun }: { when: PublishWhen; noun: string }) {
  const id = useId()
  const { later, scheduling, checked, replaces } = when
  if (!later) return null
  const bounds = scheduleBounds(later.timeZone)
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">When should it go live?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: 'now', label: 'Publish now', hint: 'Shoppers see it right away.' },
              { value: 'later', label: 'Publish later', hint: 'Choose a date and time.' },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
              <input type="radio" name={`${id}-when`} value={option.value} checked={when.mode === option.value} onChange={() => when.setMode(option.value)} className="mt-1 accent-primary" />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {scheduling && (
        <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-3" data-testid="publish-later">
          <Label htmlFor={`${id}-at`}>Date and time</Label>
          <Input
            id={`${id}-at`}
            type="datetime-local"
            value={when.at}
            min={bounds.min}
            max={bounds.max}
            aria-invalid={when.atError ? true : undefined}
            aria-describedby={when.atError ? `${id}-hint ${id}-error` : `${id}-hint`}
            onChange={(e) => {
              when.setAt(e.target.value)
              when.setAtError(null)
            }}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            In {storeTimeLabel(later.timeZone)}.
            {checked?.ok && (
              <>
                {' '}
                Goes live on <strong className="font-medium text-foreground">{formatStoreTime(checked.iso, later.timeZone)}</strong>.
              </>
            )}
          </p>
          {when.atError && (
            <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
              {when.atError}
            </p>
          )}
          {replaces && <p className="text-xs text-muted-foreground">This replaces the publish planned for {formatStoreTime(replaces.publish_at, later.timeZone)}.</p>}
        </div>
      )}
      {!scheduling && replaces && (
        <div className="flex flex-col gap-1 rounded-md border border-info/40 bg-info/5 p-3 text-sm" data-testid="publish-pending-schedule">
          <p>A publish is planned for {formatStoreTime(replaces.publish_at, later.timeZone)}.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={when.cancelPlanned} onChange={(e) => when.setCancelPlanned(e.target.checked)} className="mt-0.5 accent-primary" />
            <span>Cancel it (your {noun} goes live now)</span>
          </label>
        </div>
      )}
    </>
  )
}
