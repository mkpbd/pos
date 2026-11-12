/*
 * B8a: the store hours week editor. One line per day in the order shoppers see it (the week can
 * start on Saturday, Sunday or Monday): an Open switch, the opening and closing time, and a hint
 * when a day closes after midnight. "Copy Monday to every day" fills the week at once.
 */

import { useId } from 'react'
import { CopyIcon, MoonIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { StoreHoursDay, WeekDay } from '@/storefront/builder/types'
import { closesAfterMidnight, copyHoursToAll, DAY_NAMES, displayOrder, twelveHour } from './b8a-model'
import { FieldError, type Errors } from './fields'

export type StoreHoursEditorProps = {
  days: readonly StoreHoursDay[]
  weekStarts: WeekDay
  onChange: (days: StoreHoursDay[], typing?: string) => void
  /** Problems by form key (`days`, `days.<index>.open`, …; index in stored order, Monday first). */
  errors?: Errors
}

export function StoreHoursEditor({ days, weekStarts, onChange, errors = {} }: StoreHoursEditorProps) {
  const id = useId()
  const setDay = (day: WeekDay, patch: Partial<StoreHoursDay>, typing?: string) => onChange(days.map((d) => (d.day === day ? { ...d, ...patch } : d)), typing ? `${day}.${typing}` : undefined)
  const first = displayOrder(weekStarts)[0]!
  const timeClass =
    'h-8 w-full min-w-0 rounded-md border border-input bg-background px-1.5 text-sm tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive'

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2" data-testid="store-hours-editor">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-title`} className="flex-1 text-sm font-medium">Opening hours</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(copyHoursToAll(days, first))} title={`Give every day the same hours as ${DAY_NAMES[first]}.`}>
          <CopyIcon data-icon="inline-start" /> Copy {DAY_NAMES[first]} to all
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        {displayOrder(weekStarts).map((name) => {
          const day = days.find((d) => d.day === name)
          if (!day) return null
          const index = days.indexOf(day)
          const label = DAY_NAMES[name]
          const late = closesAfterMidnight(day)
          const openError = errors[`days.${index}.open`]
          const closeError = errors[`days.${index}.close`]
          const dayError = errors[`days.${index}`] ?? errors[`days.${index}.closed`]
          return (
            <li key={name} className="flex flex-col gap-1.5 p-2" data-testid={`hours-${name}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                <Switch checked={!day.closed} aria-label={`Open on ${label}`} onCheckedChange={(open) => setDay(name, { closed: !open })} />
                <span aria-hidden className={cn('w-14 text-sm', day.closed && 'text-muted-foreground')}>{day.closed ? 'Closed' : 'Open'}</span>
              </div>
              {!day.closed && (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                  <input
                    type="time"
                    aria-label={`${label}: opens at`}
                    className={timeClass}
                    value={day.open}
                    aria-invalid={openError ? true : undefined}
                    onChange={(e) => e.target.value && setDay(name, { open: e.target.value }, 'open')}
                  />
                  <span className="text-xs text-muted-foreground" aria-hidden>to</span>
                  <input
                    type="time"
                    aria-label={`${label}: closes at`}
                    className={timeClass}
                    value={day.close}
                    aria-invalid={closeError ? true : undefined}
                    onChange={(e) => e.target.value && setDay(name, { close: e.target.value }, 'close')}
                  />
                </div>
              )}
              {late && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MoonIcon className="size-3.5 shrink-0" aria-hidden />
                  Closes after midnight ({twelveHour(day.close)} the next morning).
                </p>
              )}
              <FieldError message={openError ?? closeError ?? dayError} />
            </li>
          )
        })}
      </ul>
      <FieldError message={errors.days} />
    </section>
  )
}
