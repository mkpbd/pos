import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { SCHEDULE_MAX_DAYS } from '../publishing-api'

/*
 * B11 "Publish later": the date and time are chosen in the store's timezone (the organization's,
 * e.g. Asia/Dhaka), whatever the computer's clock says, and sent as an ISO instant with offset.
 */

const DAY = 86_400_000

/** The default planned time: tomorrow at 09:00 store time (datetime-local value). */
export function defaultScheduleInput(timeZone: string | undefined, now: number = Date.now()): string {
  const tomorrow = toZonedInput(new Date(now + DAY).toISOString(), timeZone)
  return tomorrow ? `${tomorrow.slice(0, 10)}T09:00` : ''
}

/** The datetime-local `min` / `max`: from now to a year ahead, store time. */
export function scheduleBounds(timeZone: string | undefined, now: number = Date.now()): { min: string; max: string } {
  return { min: toZonedInput(new Date(now).toISOString(), timeZone), max: toZonedInput(new Date(now + SCHEDULE_MAX_DAYS * DAY).toISOString(), timeZone) }
}

export type ScheduleCheck = { ok: true; iso: string } | { ok: false; error: string }

/** A planned time the server accepts (future, at most a year ahead), or why not. */
export function checkScheduleInput(value: string, timeZone: string | undefined, now: number = Date.now()): ScheduleCheck {
  const iso = value ? fromZonedInput(value, timeZone) : null
  if (!iso) return { ok: false, error: 'Choose the date and time it should go live.' }
  const at = Date.parse(iso)
  if (at <= now + 60_000) return { ok: false, error: 'Choose a time in the future, or publish now.' }
  if (at > now + SCHEDULE_MAX_DAYS * DAY) return { ok: false, error: 'Choose a time within the next year.' }
  return { ok: true, iso }
}

/** "Fri, 20 Nov 2026, 09:00" in the store's timezone ("—" when unknown). */
export function formatStoreTime(iso: string | null | undefined, timeZone: string | undefined, options: { short?: boolean } = {}): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const format: Intl.DateTimeFormatOptions = options.short
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return date.toLocaleString('en-GB', { ...format, timeZone })
  } catch {
    return date.toLocaleString('en-GB', format)
  }
}

/** "store time, Asia/Dhaka" (or "your computer's time" without a store timezone). */
export function storeTimeLabel(timeZone: string | undefined): string {
  return timeZone ? `store time, ${timeZone.replace(/_/g, ' ')}` : 'your computer’s time'
}
