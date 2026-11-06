import type { ReportDefinition, ReportParam } from '@/features/reports/api'
import { shiftDate, todayIn } from '@/features/promotions/report'

/**
 * Report params live in the URL (shareable links): every definition param, plus `sort`,
 * `page` and `per_page`. Dates are calendar days in the organization's timezone.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'last_30_days' | 'this_month' | 'last_month' | 'this_year'

/** Presets offered on report pages. */
export const DATE_PRESETS: readonly DatePreset[] = ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year']

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
}

const DAILY_MAX_DAYS = 366

/** The server pages 50 rows by default (at most 500). */
export const PER_PAGE_OPTIONS = [25, 50, 100, 200] as const
export const DEFAULT_PER_PAGE = 50

/** Day of week of a Y-m-d date, Monday = 0. */
function weekdayMonday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The range a preset stands for, ending today at the latest (weeks start on Monday). */
export function presetRange(preset: DatePreset, timeZone: string | undefined, now = new Date()): { from: string; to: string } {
  const today = todayIn(timeZone, now)
  const [y, m] = today.split('-').map(Number) as [number, number]
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const day = shiftDate(today, -1)
      return { from: day, to: day }
    }
    case 'this_week':
      return { from: shiftDate(today, -weekdayMonday(today)), to: today }
    case 'last_30_days':
      return { from: shiftDate(today, -29), to: today }
    case 'this_month':
      return { from: `${y}-${pad(m)}-01`, to: today }
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y
      const lm = m === 1 ? 12 : m - 1
      return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDayOfMonth(ly, lm))}` }
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today }
  }
}

export function matchPreset(from: string, to: string, timeZone: string | undefined, now = new Date(), presets: readonly DatePreset[] = DATE_PRESETS): DatePreset | null {
  return presets.find((p) => {
    const r = presetRange(p, timeZone, now)
    return r.from === from && r.to === to
  }) ?? null
}

export function rangeProblem(from: string, to: string): string | null {
  if (!DATE.test(from) || !DATE.test(to)) return 'Choose both dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  return null
}

/** Days in an inclusive Y-m-d range. */
export function rangeDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

export const hasParam = (def: ReportDefinition, key: string) => def.params.some((p) => p.key === key)
export const findParam = (def: ReportDefinition, key: string): ReportParam | undefined => def.params.find((p) => p.key === key)

/** True when the report takes a date range (date_from + date_to). */
export const isRanged = (def: ReportDefinition) => hasParam(def, 'date_from') && hasParam(def, 'date_to')

/**
 * Values a report starts with when the URL does not say otherwise: the definition's defaults,
 * this month for a date range (this year when grouped by month), today for single dates, and
 * the first option of a required choice.
 */
export function defaultValues(def: ReportDefinition, timeZone: string | undefined, now = new Date()): Record<string, string> {
  const values: Record<string, string> = {}
  for (const p of def.params) if (p.default !== null && p.default !== '') values[p.key] = p.default
  if (isRanged(def) && (!values.date_from || !values.date_to)) {
    const monthly = def.key === 'sales_monthly' || values.group_by === 'month'
    const range = presetRange(monthly ? 'this_year' : 'this_month', timeZone, now)
    values.date_from ??= range.from
    values.date_to ??= range.to
  }
  for (const p of def.params) {
    if (values[p.key] !== undefined || !p.required) continue
    if (p.type === 'date') values[p.key] = todayIn(timeZone, now)
    else if (p.type === 'enum' && p.options[0]) values[p.key] = p.options[0].value
  }
  return values
}

/** The params the URL holds for this report (definition params only), defaults filled in. */
export function paramValues(def: ReportDefinition, search: URLSearchParams, timeZone: string | undefined, now = new Date()): Record<string, string> {
  const defaults = defaultValues(def, timeZone, now)
  const values: Record<string, string> = {}
  for (const p of def.params) {
    const v = search.get(p.key)
    if (v !== null && v !== '') values[p.key] = v
    else if (defaults[p.key] !== undefined) values[p.key] = defaults[p.key] as string
  }
  return values
}

/** True when a required param the URL lacks has a default, so the URL should be completed. */
export function missingDefaults(def: ReportDefinition, search: URLSearchParams, timeZone: string | undefined, now = new Date()): boolean {
  const defaults = defaultValues(def, timeZone, now)
  return Object.keys(defaults).some((k) => !search.get(k))
}

export function sortValue(def: ReportDefinition, search: URLSearchParams): string | null {
  return search.get('sort') || def.default_sort
}

export function pageValues(search: URLSearchParams): { page: number; per_page: number } {
  const page = Math.max(1, Math.floor(Number(search.get('page')) || 1))
  const perPage = Number(search.get('per_page'))
  return { page, per_page: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : DEFAULT_PER_PAGE }
}

/** Client-side check before asking the server (it validates again and has the final say). */
export function paramsProblem(def: ReportDefinition, values: Record<string, string>): string | null {
  if (isRanged(def)) {
    const problem = rangeProblem(values.date_from ?? '', values.date_to ?? '')
    if (problem) return problem
    const days = rangeDays(values.date_from as string, values.date_to as string)
    // Rows per day (daily granularity, or grouped by day) allow at most 366 days.
    const limit = values.group_by === 'day' ? Math.min(def.max_range_days ?? DAILY_MAX_DAYS, DAILY_MAX_DAYS) : def.max_range_days
    if (limit !== null && days > limit) {
      return limit <= DAILY_MAX_DAYS
        ? `With one row per day the period can be at most ${limit} days (this one is ${days}). Choose a shorter period${hasParam(def, 'group_by') ? ' or group by month' : ''}.`
        : `The period can be at most ${limit} days (this one is ${days}).`
    }
  }
  const missing = def.params.filter((p) => p.required && !values[p.key])
  if (missing.length > 0) return `Choose ${missing.map((p) => p.label.toLowerCase()).join(', ')}.`
  return null
}

/** The request query: params, sort and paging (the export drops paging). */
export function runQuery(def: ReportDefinition, search: URLSearchParams, timeZone: string | undefined, now = new Date()): Record<string, string> {
  const query: Record<string, string> = { ...paramValues(def, search, timeZone, now) }
  const sort = sortValue(def, search)
  if (sort) query.sort = sort
  if (def.layout === 'table' && def.paginated) {
    const { page, per_page } = pageValues(search)
    query.page = String(page)
    query.per_page = String(per_page)
  }
  return query
}

/** Next URL params after changing some report params (paging restarts on any filter change). */
export function withChanges(search: URLSearchParams, changes: Record<string, string | null>): URLSearchParams {
  const next = new URLSearchParams(search)
  let resetPage = false
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    if (key !== 'page') resetPage = true
  }
  if (resetPage) next.delete('page')
  return next
}

/** Parses "-net_sales" / "net_sales". */
export function parseSort(sort: string | null): { key: string; desc: boolean } | null {
  if (!sort) return null
  const desc = sort.startsWith('-')
  const key = sort.replace(/^-/, '')
  return key ? { key, desc } : null
}
