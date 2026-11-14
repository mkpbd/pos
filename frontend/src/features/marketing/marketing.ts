import type { SectionTab } from '@/features/inventory/sections'
import type { Campaign, CampaignStatus } from '@/features/marketing/api'
import { presetRange, rangeDays, rangeProblem, type DatePreset } from '@/features/reports/params'
import { shortAxisLabel } from '@/features/reports/format'

/** P2a campaigns and short links (marketing.*), P2b social posts and product feeds (social.*). */
export const MARKETING_TABS: SectionTab[] = [
  { to: '/marketing/campaigns', label: 'Campaigns', permission: 'marketing.view' },
  { to: '/marketing/short-links', label: 'Short links', permission: 'marketing.view' },
  { to: '/marketing/social', label: 'Social posts', permission: 'social.view' },
  { to: '/marketing/feeds', label: 'Product feeds', permission: 'social.view' },
]

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; variant: 'success' | 'outline' }> = {
  active: { label: 'Active', variant: 'success' },
  archived: { label: 'Archived', variant: 'outline' },
}

/** Lower-case letters, digits and dashes; 3–32 characters (the server's rule). */
export const CODE_PATTERN = /^[a-z0-9-]{3,32}$/

/** "Eid Sale 2026!" → "eid-sale-2026" (a suggestion for link codes and tags). */
export function slugify(text: string, max = 32): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

/** A store address the short link may open: a path on the store, never another site. */
export function storePathProblem(path: string): string | null {
  const p = path.trim()
  if (p === '') return 'Choose the page the link opens.'
  if (!p.startsWith('/') || p.startsWith('//')) return 'Start with “/”, e.g. /p/eid-sale.'
  if (/\s/.test(p)) return 'An address cannot contain spaces.'
  if (p.length > 255) return 'Keep the address under 255 characters.'
  if (/^\/go\//.test(p)) return 'A short link cannot open another short link.'
  return null
}

/** Whole numbers with thousands separators ("1,250"). Admin is English, so Latin digits. */
export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(value)
}

/** "3.2500" → "3.25%"; null → "—". The server computes the rate. */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = String(value)
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!match) return `${text}%`
  const [, sign = '', integer = '0', fraction = ''] = match
  const two = (fraction + '00').slice(0, 2).replace(/0+$/, '')
  return `${sign}${integer}${two ? `.${two}` : ''}%`
}

/** Where visitors came from, in plain words. No source and no medium = direct visits and everything untagged. */
export function sourceLabel(source: string | null | undefined, medium: string | null | undefined): string {
  const s = source?.trim()
  const m = medium?.trim()
  if (!s && !m) return 'Direct / other'
  return [s || 'Unknown source', m].filter(Boolean).join(' / ')
}

/** The `Y-m-d` part of a date or date-time ("2026-11-01T00:00:00+06:00" → "2026-11-01"). */
export function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

/** "1 Nov – 30 Nov" / "From 1 Nov" / "Until 30 Nov" / "Always on". */
export function campaignDates(campaign: Pick<Campaign, 'starts_at' | 'ends_at'>): string {
  const from = dateOnly(campaign.starts_at)
  const to = dateOnly(campaign.ends_at)
  if (from && to) return `${shortAxisLabel(from)} – ${shortAxisLabel(to)} ${to.slice(0, 4)}`
  if (from) return `From ${shortAxisLabel(from)} ${from.slice(0, 4)}`
  if (to) return `Until ${shortAxisLabel(to)} ${to.slice(0, 4)}`
  return 'No end date'
}

export type StatsMetric = 'visits' | 'orders' | 'revenue'

export const STATS_METRICS: { key: StatsMetric; label: string }[] = [
  { key: 'visits', label: 'Visits' },
  { key: 'orders', label: 'Orders' },
  { key: 'revenue', label: 'Revenue' },
]

/** The stats range from the address (`from` / `to`), else the last 30 days in the organization's calendar. */
export function statsRange(search: URLSearchParams, timeZone: string | undefined, now = new Date()): { from: string; to: string } {
  const from = search.get('from') ?? ''
  const to = search.get('to') ?? ''
  if (!rangeProblem(from, to) && rangeDays(from, to) <= MAX_RANGE_DAYS) return { from, to }
  return presetRange('last_30_days', timeZone, now)
}

/** The server answers at most 366 days at once. */
export const MAX_RANGE_DAYS = 366

/** Range presets offered on the marketing pages. */
export const STATS_PRESETS: readonly DatePreset[] = ['last_30_days', 'this_week', 'this_month', 'last_month', 'today', 'yesterday']
