import { shiftDate, todayIn } from '@/features/promotions/report'
import type { HeatCell, InsightsDevice, InsightsSection, InsightsTotals, VitalKey, VitalRating } from './insights-api'

/*
 * B15 insights in plain words: the headline sentence, the period presets, the heat map's colour
 * steps and the words for where people click ("top right"). Pure functions — the panel, the
 * canvas overlay and the tests share them.
 */

/* ------------------------------------------------------------------------------- numbers ----- */

export const formatCount = (n: number): string => n.toLocaleString('en-US')

/** 3.14159 → "3.1 %" (a no-break space keeps the sign with its number); null → "—". */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toLocaleString('en-US')} %`
}

/** Orders per 100 different visitors: the server's figure, else worked out from the counts. */
export function conversionOf(totals: Pick<InsightsTotals, 'conversion' | 'orders' | 'unique_visitors'>): number | null {
  if (totals.conversion !== null) return totals.conversion
  return totals.unique_visitors > 0 ? (totals.orders / totals.unique_visitors) * 100 : null
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`

/** "1,240 people saw this page; 38 ordered (3.1 %)." */
export function headline(totals: InsightsTotals, noun = 'page'): string {
  if (totals.unique_visitors === 0 && totals.views === 0) return `Nobody has opened this ${noun} in these days yet.`
  const people = totals.unique_visitors > 0 ? totals.unique_visitors : totals.views
  const saw = `${plural(people, 'person', 'people')} saw this ${noun}`
  if (totals.orders === 0) return `${saw}; nobody ordered from it yet.`
  return `${saw}; ${formatCount(totals.orders)} ordered (${formatPercent(conversionOf(totals))}).`
}

/* ------------------------------------------------------------------------------- period ------ */

export type PeriodPreset = '7' | '30' | '90'
export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

/** The server keeps visits for 90 days and answers at most 365 days at once. */
export const MAX_RANGE_DAYS = 365

export function presetPeriod(preset: PeriodPreset, timeZone: string | undefined, now = new Date()): { from: string; to: string } {
  const to = todayIn(timeZone, now)
  return { from: shiftDate(to, -(Number(preset) - 1)), to }
}

export function matchPeriod(range: { from: string; to: string }, timeZone: string | undefined, now = new Date()): PeriodPreset | null {
  return PERIOD_PRESETS.find((p) => {
    const r = presetPeriod(p.value, timeZone, now)
    return r.from === range.from && r.to === range.to
  })?.value ?? null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Why a custom period can't be used (null = fine). */
export function periodProblem(from: string, to: string): string | null {
  if (!DATE.test(from) || !DATE.test(to)) return 'Choose both dates.'
  if (from > to) return 'The first day must be on or before the last day.'
  if (dayNumber(to) - dayNumber(from) + 1 > MAX_RANGE_DAYS) return `Choose ${MAX_RANGE_DAYS} days or fewer.`
  return null
}

export const DEVICE_FILTERS: { value: InsightsDevice; label: string }[] = [
  { value: 'all', label: 'All devices' },
  { value: 'desktop', label: 'Computers' },
  { value: 'tablet', label: 'Tablets' },
  { value: 'mobile', label: 'Phones' },
]

/* ------------------------------------------------------------------------------- web vitals -- */

export const VITALS: { key: VitalKey; name: string; question: string; explain: string }[] = [
  { key: 'lcp', name: 'Loading', question: 'How fast the main picture or text appears', explain: 'Good is 2.5 seconds or less. Smaller pictures near the top help most.' },
  { key: 'inp', name: 'Response', question: 'How fast the page reacts to a tap or click', explain: 'Good is 0.2 seconds or less. Fewer videos, carousels and custom code help.' },
  { key: 'cls', name: 'Steadiness', question: 'How little the page jumps while it loads', explain: 'Good is 0.1 or less. Pictures with a fixed shape keep things in place.' },
]

export const RATING_LABEL: Record<VitalRating, string> = { good: 'Good', needs_improvement: 'Could be better', poor: 'Slow' }

export function formatVital(key: VitalKey, value: number | null): string {
  if (value === null) return '—'
  if (key === 'cls') return (Math.round(value * 100) / 100).toString()
  return value >= 1000 ? `${(Math.round(value / 100) / 10).toLocaleString('en-US')} s` : `${Math.round(value)} ms`
}

/* ------------------------------------------------------------------------------- heat map ---- */

/** Sequential single-hue steps (light → dark, validated as an ordinal ramp on a light surface). */
export const HEAT_COLORS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'] as const

export const GRID = 20

export function heatMax(heat: Record<string, HeatCell[]>): number {
  let max = 0
  for (const cells of Object.values(heat)) for (const [, , clicks] of cells) if (clicks > max) max = clicks
  return max
}

/** The colour step (0–4) of a cell with `clicks` when the busiest cell has `max`. */
export function heatStep(clicks: number, max: number): number {
  if (max <= 0 || clicks <= 0) return 0
  return Math.min(HEAT_COLORS.length - 1, Math.max(0, Math.ceil((clicks / max) * HEAT_COLORS.length) - 1))
}

/** The legend: each step's click range ("1–4", "5–8", …), steps that hold no whole number left out. */
export function heatLegend(max: number): { color: string; label: string }[] {
  if (max <= 0) return []
  const steps = HEAT_COLORS.length
  const out: { color: string; label: string }[] = []
  for (let i = 0; i < steps; i++) {
    const low = Math.floor((max * i) / steps) + 1
    const high = Math.floor((max * (i + 1)) / steps)
    if (high < low) continue
    out.push({ color: HEAT_COLORS[i]!, label: low === high ? formatCount(low) : `${formatCount(low)}–${formatCount(high)}` })
  }
  return out
}

const ROWS = ['top', 'middle', 'bottom'] as const
const COLUMNS = ['left', 'centre', 'right'] as const

/** Where a cell is, in words ("top left", "middle", "bottom right"). */
export function placeWords(cx: number, cy: number): string {
  const row = ROWS[Math.min(2, Math.floor((cy * 3) / GRID))]!
  const column = COLUMNS[Math.min(2, Math.floor((cx * 3) / GRID))]!
  if (row === 'middle' && column === 'centre') return 'middle'
  if (column === 'centre') return `${row} centre`
  return `${row} ${column}`
}

export type ClickSpot = { place: string; clicks: number; share: number }

/** A section's clicks, grouped into nine areas, busiest first (at most `limit`). */
export function clickSpots(cells: HeatCell[], limit = 3): { total: number; spots: ClickSpot[] } {
  const total = cells.reduce((sum, [, , clicks]) => sum + clicks, 0)
  const byPlace = new Map<string, number>()
  for (const [cx, cy, clicks] of cells) {
    const place = placeWords(cx, cy)
    byPlace.set(place, (byPlace.get(place) ?? 0) + clicks)
  }
  const spots = [...byPlace.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([place, clicks]) => ({ place, clicks, share: total > 0 ? (clicks / total) * 100 : 0 }))
  return { total, spots }
}

/** Sections sorted by "people who saw it" (most first; ties keep the page order). */
export function sectionsBySeen(sections: InsightsSection[]): InsightsSection[] {
  return sections.map((s, i) => ({ s, i })).sort((a, b) => b.s.views - a.s.views || a.i - b.i).map(({ s }) => s)
}

/** "Seen by 72 % of visits" style bars: a width 0–100 from a percentage (null = 0). */
export const barWidth = (value: number | null): number => (value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)))
