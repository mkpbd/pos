/** Date helpers for the promotion report: days are calendar days in the organization's timezone. */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

/** Today's date (Y-m-d) in the zone; browser date without a usable zone. */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      const value = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
      if (DATE.test(value)) return value
    } catch {
      // fall through
    }
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "2026-11-01" + -29 → "2026-10-03" (pure calendar arithmetic, no zone involved). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** The default range: the last 30 days including today. */
export function defaultReportRange(timeZone: string | undefined, now = new Date()): { from: string; to: string } {
  const to = todayIn(timeZone, now)
  return { from: shiftDate(to, -29), to }
}

/** Error for a date range, or null when both dates are valid and in order. */
export function rangeError(from: string, to: string): string | null {
  if (!DATE.test(from) || !DATE.test(to)) return 'Choose both dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  return null
}

/** "2026-11-01" → "1 Nov 2026" in the user's locale (the date is already the organization's day). */
export function formatDay(date: string): string {
  if (!DATE.test(date)) return date
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' })
}
