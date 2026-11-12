import { dateFormat, type DigitOptions } from '../../i18n/format'
import type { WeekDay } from '../types'
import { B8A_ENUMS, timeMinutes } from '../validate'

/*
 * Store hours (B8a contract §1), pure: today and "open now" in the store's time zone, the next
 * opening, and 12-hour times / weekday names in the shopper's language. A day whose closing time is
 * before its opening time closes after midnight (into the next day); open = close means 24 hours.
 */

export const WEEK: readonly WeekDay[] = B8A_ENUMS.weekDay

export type Hours = { day: WeekDay; closed: boolean; open: number; close: number }

/** The days of a store_hours element as minutes, Monday first; null unless all 7 are valid and in order. */
export function hoursOf(value: unknown): Hours[] | null {
  if (!Array.isArray(value) || value.length !== WEEK.length) return null
  const out: Hours[] = []
  for (const [i, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) return null
    const day = entry as Record<string, unknown>
    const open = timeMinutes(day.open)
    const close = timeMinutes(day.close)
    if (day.day !== WEEK[i] || open === null || close === null) return null
    out.push({ day: WEEK[i]!, closed: day.closed === true, open, close })
  }
  return out
}

/** The display order: Saturday, Sunday or Monday first. */
export function displayOrder(hours: Hours[], start: 'sat' | 'sun' | 'mon'): Hours[] {
  const from = WEEK.indexOf(start)
  return hours.map((_, i) => hours[(from + i) % hours.length]!)
}

const SHORT_DAYS: Record<string, WeekDay> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' }

/** The weekday and minutes since midnight of an instant in a time zone; null for an unknown zone. */
export function zonedNow(date: Date, timeZone: string): { day: WeekDay; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    const get = (type: string) => parts.find((part) => part.type === type)?.value
    const day = SHORT_DAYS[get('weekday') ?? '']
    const hour = Number(get('hour'))
    const minute = Number(get('minute'))
    if (!day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return { day, minutes: (hour % 24) * 60 + minute }
  } catch {
    return null
  }
}

export type OpenStatus =
  /** `closes` null = open all day. */
  | { open: true; closes: number | null }
  /** `opens` null = never opens (every day closed); `today` = later today. */
  | { open: false; opens: { day: WeekDay; minutes: number; today: boolean } | null }

/** Whether the store is open at `now` (store time), and when it closes or next opens. */
export function openStatus(hours: Hours[], now: { day: WeekDay; minutes: number }): OpenStatus {
  const index = WEEK.indexOf(now.day)
  const at = (offset: number) => hours[(index + offset + 7) % 7]!
  const today = at(0)
  const yesterday = at(-1)
  const m = now.minutes
  // Yesterday's late hours running past midnight.
  if (!yesterday.closed && yesterday.close < yesterday.open && m < yesterday.close) return { open: true, closes: yesterday.close }
  if (!today.closed) {
    if (today.open === today.close) return { open: true, closes: null }
    if (today.close > today.open && m >= today.open && m < today.close) return { open: true, closes: today.close }
    if (today.close < today.open && m >= today.open) return { open: true, closes: today.close }
    if (m < today.open) return { open: false, opens: { day: today.day, minutes: today.open, today: true } }
  }
  for (let k = 1; k <= 7; k += 1) {
    const day = at(k)
    if (!day.closed) return { open: false, opens: { day: day.day, minutes: day.open, today: false } }
  }
  return { open: false, opens: null }
}

/** "9:00 pm" / "রাত ৯:০০" (12-hour, the shopper's language and digits). */
export function formatTime(minutes: number, digits: DigitOptions): string {
  const date = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60), minutes % 60))
  return dateFormat({ hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }, digits).format(date)
}

/** "Monday" / "সোমবার". 2024-01-01 was a Monday. */
export function weekdayName(day: WeekDay, digits: DigitOptions): string {
  const date = new Date(Date.UTC(2024, 0, 1 + WEEK.indexOf(day)))
  return dateFormat({ weekday: 'long', timeZone: 'UTC' }, digits).format(date)
}
