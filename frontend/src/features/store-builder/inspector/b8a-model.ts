/*
 * B8a editor helpers (pure): prices as typed by shop owners, the store hours week, the comparison
 * table's cells (and their Bangla texts) when columns change, and team member links.
 */

import type { ComparisonCell, ComparisonRow, StoreHoursDay, TeamLinkKind, WeekDay } from '@/storefront/builder/types'
import { teamLinkUrl } from '@/storefront/builder/validate'
import type { ItemListChange } from './b6-model'

type Translations = Record<string, Record<string, string>>

/* ----------------------------------------------------------------------------------------------
 * Money
 * -------------------------------------------------------------------------------------------- */

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/**
 * A price as typed: Bangla digits, thousands separators (1,250 / ১,২৫০) and a currency sign around
 * it (৳ 1,250, Tk 99.50) are fine. Returns the NUMERIC string the document stores ("1250",
 * "99.5", "99.50"), or null when it isn't a price (negative, more than 2 decimals, not a number).
 */
export function parseMoney(raw: string): string | null {
  let text = raw.trim().replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
  text = text.replace(/^[^\d.-]+/, '').replace(/[^\d.]+$/, '').replace(/[\s  ,]/g, '')
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null
  // No leading zeros ("007" → "7"); keeps "0" and "0.50".
  return text.replace(/^0+(?=\d)/, '')
}

/* ----------------------------------------------------------------------------------------------
 * Store hours
 * -------------------------------------------------------------------------------------------- */

/** Week order as stored (Monday first). */
export const WEEK: readonly WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export const DAY_NAMES: Record<WeekDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/** The days in the order shoppers see them (the week starts on Saturday, Sunday or Monday). */
export function displayOrder(weekStarts: WeekDay): WeekDay[] {
  const start = WEEK.indexOf(weekStarts)
  return [...WEEK.slice(start), ...WEEK.slice(0, start)]
}

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** A day that closes after midnight (close earlier than open, e.g. 18:00 → 02:00). */
export const closesAfterMidnight = (day: StoreHoursDay) => !day.closed && TIME.test(day.open) && TIME.test(day.close) && day.close < day.open

/** Every day gets the hours of `from` (open / closed too). */
export function copyHoursToAll(days: readonly StoreHoursDay[], from: WeekDay = 'mon'): StoreHoursDay[] {
  const source = days.find((d) => d.day === from)
  if (!source) return [...days]
  return days.map((d) => ({ ...d, closed: source.closed, open: source.open, close: source.close }))
}

/** "18:30" → "6:30 pm" (the owner's preview; the store writes times in the shopper's language). */
export function twelveHour(time: string): string {
  if (!TIME.test(time)) return time
  const [h, m] = time.split(':').map(Number) as [number, number]
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/* ----------------------------------------------------------------------------------------------
 * Comparison table
 * -------------------------------------------------------------------------------------------- */

export const EMPTY_CELL: ComparisonCell = { kind: 'no', text: '' }

/**
 * The rows after the columns changed: a new column gets an empty cell ("No") in every row, a
 * removed column's cells go, a duplicated column's cells are copied. Cells of unknown columns are
 * dropped.
 */
export function rowsForColumns(rows: readonly ComparisonRow[], columnIds: readonly string[], change?: ItemListChange): ComparisonRow[] {
  return rows.map((row) => {
    const cells: Record<string, ComparisonCell> = {}
    for (const id of columnIds) {
      const copied = change?.duplicated && change.duplicated.to === id ? row.cells[change.duplicated.from] : undefined
      cells[id] = { ...(row.cells[id] ?? copied ?? EMPTY_CELL) }
    }
    return { ...row, cells }
  })
}

/**
 * Bangla cell texts (`rows.<row_id>.cells.<column_id>.text`) when a column is removed (dropped) or
 * duplicated (copied to the new column). The column's own texts (`columns.<id>.title`) move with
 * moveItemTranslations.
 */
export function cellTranslationsForColumns(translations: Translations, change: ItemListChange | undefined): Translations {
  const removed = change?.removed
  const duplicated = change?.duplicated
  if (!removed && !duplicated) return translations
  const out: Translations = {}
  for (const [locale, texts] of Object.entries(translations)) {
    const next: Record<string, string> = {}
    for (const [key, text] of Object.entries(texts)) {
      const cell = /^rows\.([^.]+)\.cells\.([^.]+)\.(.+)$/.exec(key)
      if (cell && removed === cell[2]) continue
      next[key] = text
      if (cell && duplicated && duplicated.from === cell[2]) next[`rows.${cell[1]}.cells.${duplicated.to}.${cell[3]}`] = text
    }
    if (Object.keys(next).length > 0) out[locale] = next
  }
  return out
}

/* ----------------------------------------------------------------------------------------------
 * Team links
 * -------------------------------------------------------------------------------------------- */

export const LINK_KINDS: readonly { value: TeamLinkKind; label: string }[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'website', label: 'Website' },
  { value: 'email', label: 'Email' },
]

export const linkKindLabel = (kind: string) => LINK_KINDS.find((k) => k.value === kind)?.label ?? kind

/** The address of a `mailto:` link ("" for anything else). */
export const emailOf = (url: string) => (url.toLowerCase().startsWith('mailto:') ? url.slice(7) : '')

/** The stored URL of a typed email address. */
export const emailUrl = (address: string) => (address.trim() === '' ? '' : `mailto:${address.trim()}`)

/** A problem with a team link's address, or null (the storefront's rule: email a valid `mailto:` address, others https only). */
export function teamLinkProblem(kind: TeamLinkKind, url: string): string | null {
  if (kind === 'email') {
    if (emailOf(url).trim() === '') return 'Enter an email address.'
    return teamLinkUrl(kind, url) ? null : 'Enter an email address such as hello@myshop.com.'
  }
  if (url.trim() === '') return 'Paste the page address.'
  return teamLinkUrl(kind, url) ? null : 'Use a full, secure address starting with https://.'
}
