import { useEffect, useRef, useState } from 'react'
import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, ShieldCheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { longAxisLabel } from '@/features/reports/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Device } from '@/storefront/builder/types'
import { DailyChart } from './daily-chart'
import type { DocumentInsights, InsightsDevice, InsightsSection, VitalKey, VitalRating } from './insights-api'
import {
  barWidth,
  clickSpots,
  conversionOf,
  DEVICE_FILTERS,
  formatCount,
  formatPercent,
  formatVital,
  headline,
  matchPeriod,
  PERIOD_PRESETS,
  periodProblem,
  presetPeriod,
  RATING_LABEL,
  sectionsBySeen,
  VITALS,
  type PeriodPreset,
} from './insights-model'
import type { InsightsState } from './use-insights'

/*
 * B15 Insights panel (in place of the left panel while open): what happened on the published
 * page in plain words — the headline, four figures, each day (views or orders, one axis), the
 * heat map switch with "Clicks as a list", the sections by people who saw them and the real
 * speed shoppers had (Web Vitals as traffic lights with an explanation each).
 */

const CUSTOM = 'custom'
const DEVICE_VIEW: Record<Exclude<InsightsDevice, 'all'>, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

type Props = {
  insights: InsightsState
  /** "page", "home page"… for the sentences. */
  noun: string
  published: boolean
  timeZone: string | undefined
  /** The canvas device (the heat map is drawn on it). */
  device: Device
  onDevice: (device: Device) => void
  /** The draft's name for a section; null when it is not on the draft any more. */
  nameOf: (nodeId: string) => string | null
  onShowSection: (nodeId: string) => void
  onClose: () => void
}

export function InsightsPanel({ insights, noun, published, timeZone, device, onDevice, nameOf, onShowSection, onClose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  const { query, range, setRange } = insights
  const data = query.data

  return (
    <section aria-labelledby="insights-title" className="flex min-h-0 flex-1 flex-col" data-testid="insights-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 id="insights-title" ref={headingRef} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          Insights
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close insights" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <Filters
          range={range}
          timeZone={timeZone}
          onRange={(next) => setRange({ ...range, ...next })}
          onDeviceFilter={(next) => {
            setRange({ ...range, device: next })
            // The heat map lines up with the view of that device.
            if (next !== 'all') onDevice(next)
          }}
        />
        {!published && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">This {noun} isn’t published yet. Visits and orders are counted once shoppers can open it.</p>}
        {query.isPending && !data ? (
          <LoadingState rows={4} label="Loading insights" />
        ) : query.error && !data ? (
          <ErrorState title="Insights couldn’t be loaded" error={query.error} onRetry={() => void query.refetch()} />
        ) : data ? (
          <div className={cn('flex flex-col gap-5 transition-opacity motion-reduce:transition-none', query.isFetching && 'opacity-60')} aria-busy={query.isFetching || undefined}>
            <Figures data={data} noun={noun} />
            <DailyFigures data={data} timeZone={timeZone} />
            <HeatControls insights={insights} data={data} device={device} nameOf={nameOf} />
            <SectionList data={data} nameOf={nameOf} onShow={onShowSection} />
            <Speed data={data} />
          </div>
        ) : null}
        <p className="mt-auto flex items-start gap-1.5 pt-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Counted without cookies or personal details. Visits are kept for 90 days; people who ask not to be tracked aren’t counted.
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------------- filters ----- */

function Filters({ range, timeZone, onRange, onDeviceFilter }: { range: { from: string; to: string; device: InsightsDevice }; timeZone: string | undefined; onRange: (range: { from: string; to: string }) => void; onDeviceFilter: (device: InsightsDevice) => void }) {
  const preset = matchPeriod(range, timeZone)
  const [custom, setCustom] = useState(preset === null)
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const problem = custom ? periodProblem(from, to) : null
  const change = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    if (!periodProblem(nextFrom, nextTo)) onRange({ from: nextFrom, to: nextTo })
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="What to show">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="insights-period" className="text-xs">Period</Label>
          <Select
            value={custom ? CUSTOM : (preset ?? CUSTOM)}
            onValueChange={(value) => {
              if (value === CUSTOM) return setCustom(true)
              setCustom(false)
              const next = presetPeriod(value as PeriodPreset, timeZone)
              change(next.from, next.to)
            }}
          >
            <SelectTrigger id="insights-period" size="sm" className="w-full" data-testid="insights-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIOD_PRESETS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              <SelectItem value={CUSTOM}>Choose dates</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="insights-device" className="text-xs">Device</Label>
          <Select value={range.device} onValueChange={(value) => onDeviceFilter(value as InsightsDevice)}>
            <SelectTrigger id="insights-device" size="sm" className="w-full" data-testid="insights-device"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEVICE_FILTERS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {custom && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="insights-from" className="text-xs">First day</Label>
            <Input id="insights-from" type="date" className="h-8" value={from} max={to || undefined} onChange={(e) => change(e.target.value, to)} aria-invalid={!!problem || undefined} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="insights-to" className="text-xs">Last day</Label>
            <Input id="insights-to" type="date" className="h-8" value={to} min={from || undefined} onChange={(e) => change(from, e.target.value)} aria-invalid={!!problem || undefined} />
          </div>
        </div>
      )}
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------------------- figures ----- */

function Figures({ data, noun }: { data: DocumentInsights; noun: string }) {
  const t = data.totals
  const tiles = [
    { key: 'people', label: 'People', value: formatCount(t.unique_visitors), detail: `${formatCount(t.views)} ${t.views === 1 ? 'visit' : 'visits'}` },
    { key: 'orders', label: 'Orders', value: formatCount(t.orders), detail: t.orders > 0 ? `${formatMoney(t.revenue, data.currency ?? undefined)} · ${formatPercent(conversionOf(t))} of people` : 'None yet' },
    { key: 'clicks', label: 'Clicks', value: formatCount(t.clicks), detail: 'On buttons, links and products' },
    { key: 'scroll', label: 'Scrolled', value: formatPercent(t.avg_scroll), detail: 'Of the page, on average' },
  ]
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base leading-snug font-semibold" data-testid="insights-headline">{headline(t, noun)}</p>
      <ul className="grid grid-cols-2 gap-2" aria-label="Key figures">
        {tiles.map((tile) => (
          <li key={tile.key} className="flex flex-col gap-0.5 rounded-md border p-2.5" data-testid={`insights-${tile.key}`}>
            <span className="text-xs text-muted-foreground">{tile.label}</span>
            <span className="text-lg font-semibold">{tile.value}</span>
            <span className="text-xs text-muted-foreground">{tile.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DailyFigures({ data, timeZone }: { data: DocumentInsights; timeZone: string | undefined }) {
  const [metric, setMetric] = useState<'views' | 'orders'>('views')
  const title = metric === 'views' ? 'Visits each day' : 'Orders each day'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Each day</h3>
        <Tabs value={metric} onValueChange={(v) => setMetric(v as 'views' | 'orders')}>
          <TabsList aria-label="Figure shown in the chart" className="h-8">
            <TabsTrigger value="views" className="text-xs">Visits</TabsTrigger>
            <TabsTrigger value="orders" className="text-xs">Orders</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <DailyChart key={metric} title={title} points={data.daily.map((d) => ({ day: d.day, value: d[metric] }))} publishes={data.versions} timeZone={data.timezone ?? timeZone} />
      {data.versions.length > 0 && <p className="text-xs text-muted-foreground">Lines mark the days you published a new version.</p>}
      <details className="rounded-md border text-sm">
        <summary className="cursor-pointer px-2.5 py-1.5 font-medium">Day-by-day table</summary>
        <div className="max-h-64 overflow-auto border-t">
          <table className="w-full text-xs" aria-label="Figures by day">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-2 py-1 font-medium">Day</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Visits</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">People</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day} className="border-t">
                  <th scope="row" className="px-2 py-1 text-left font-normal whitespace-nowrap">{longAxisLabel(d.day)}</th>
                  <td className="px-2 py-1 text-right tabular-nums">{formatCount(d.views)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatCount(d.unique_visitors)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatCount(d.orders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/* ------------------------------------------------------------------------------- heat map ---- */

function HeatControls({ insights, data, device, nameOf }: { insights: InsightsState; data: DocumentInsights; device: Device; nameOf: (id: string) => string | null }) {
  const hasClicks = Object.keys(data.heat).length > 0
  const sections = data.sections.filter((s) => (data.heat[s.node_id]?.length ?? 0) > 0)
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Where people click</h3>
      <div className="flex items-start gap-2">
        <Switch id="insights-heat" checked={insights.heatOn} disabled={!hasClicks} onCheckedChange={insights.setHeatOn} className="mt-0.5" data-testid="heat-switch" />
        <Label htmlFor="insights-heat" className="flex flex-col items-start gap-0.5 text-sm font-normal">
          Show clicks on the page
          <span className="text-xs text-muted-foreground">
            {!hasClicks
              ? 'No clicks in these days yet.'
              : insights.range.device === 'all'
                ? `Clicks from every device, drawn on the ${DEVICE_VIEW[device]} view. Darker means more clicks.`
                : `Clicks from ${DEVICE_FILTERS.find((d) => d.value === insights.range.device)?.label.toLowerCase()}. Darker means more clicks.`}
          </span>
        </Label>
      </div>
      {hasClicks && (
        <details className="rounded-md border text-sm" data-testid="clicks-list">
          <summary className="cursor-pointer px-2.5 py-1.5 font-medium">Clicks as a list</summary>
          <ul className="divide-y border-t">
            {sections.map((s) => {
              const { total, spots } = clickSpots(data.heat[s.node_id] ?? [])
              return (
                <li key={s.node_id} className="flex flex-col gap-0.5 px-2.5 py-2">
                  <span className="font-medium">{sectionName(s, nameOf)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatCount(total)} {total === 1 ? 'click' : 'clicks'}
                    {spots.length > 0 && ` — most at the ${spots.map((spot) => `${spot.place} (${formatPercent(spot.share)})`).join(', ')}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------- sections ---- */

function sectionName(section: InsightsSection, nameOf: (id: string) => string | null): string {
  if (!section.live) return section.label ? `Removed section: ${section.label}` : 'Removed section'
  return nameOf(section.node_id) ?? (section.label || 'Section')
}

function Bar({ label, value, width }: { label: string; value: string; width: number }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
}

function SectionList({ data, nameOf, onShow }: { data: DocumentInsights; nameOf: (id: string) => string | null; onShow: (id: string) => void }) {
  const sections = sectionsBySeen(data.sections)
  const maxOrders = Math.max(0, ...sections.map((s) => s.orders))
  if (sections.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Sections, by people who saw them</h3>
      <ul className="flex flex-col gap-2" aria-label="Sections" data-testid="insights-sections">
        {sections.map((s) => {
          const name = s.live ? sectionName(s, nameOf) : s.label || 'Section'
          const onPage = s.live && nameOf(s.node_id) !== null
          return (
            <li key={s.node_id} className="flex flex-col gap-1.5 rounded-md border p-2.5" data-testid={`insights-section-${s.node_id}`}>
              <div className="flex items-start justify-between gap-2">
                {onPage ? (
                  <button type="button" className="min-w-0 text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:underline" onClick={() => onShow(s.node_id)} title="Show this section on the page">
                    {name}
                  </button>
                ) : (
                  <span className="min-w-0 text-sm font-medium">{name}</span>
                )}
                {!s.live && <Badge variant="soft">Removed section</Badge>}
              </div>
              <Bar label="Seen" value={formatPercent(s.view_rate)} width={barWidth(s.view_rate)} />
              <Bar label="Clicked" value={formatPercent(s.click_rate)} width={barWidth(s.click_rate)} />
              <Bar label="Orders" value={formatCount(s.orders)} width={maxOrders > 0 ? (s.orders / maxOrders) * 100 : 0} />
              <p className="text-xs text-muted-foreground">
                {formatCount(s.views)} saw it · {formatCount(s.clicks)} {s.clicks === 1 ? 'click' : 'clicks'}
                {s.reach !== null && ` · ${formatPercent(s.reach)} scrolled this far`}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------------------- speed ------- */

const RATING_ICON: Record<VitalRating, typeof CircleCheckIcon> = { good: CircleCheckIcon, needs_improvement: TriangleAlertIcon, poor: CircleXIcon }
const RATING_TONE: Record<VitalRating, string> = { good: 'text-success-soft-foreground', needs_improvement: 'text-warning-soft-foreground', poor: 'text-destructive' }

function Speed({ data }: { data: DocumentInsights }) {
  const vitals = data.totals.vitals
  const value: Record<VitalKey, number | null> = { lcp: vitals.lcp_p75, cls: vitals.cls_p75, inp: vitals.inp_p75 }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Speed shoppers had</h3>
      <p className="text-xs text-muted-foreground">Measured on shoppers’ own phones and computers (3 in 4 visits were this fast or faster).</p>
      <ul className="flex flex-col gap-2" aria-label="Speed" data-testid="insights-vitals">
        {VITALS.map((vital) => {
          const rating = vitals.rating[vital.key]
          const Icon = rating ? RATING_ICON[rating] : CircleHelpIcon
          return (
            <li key={vital.key} className="flex gap-2 rounded-md border p-2.5" data-testid={`vital-${vital.key}`}>
              <Icon className={cn('mt-0.5 size-4 shrink-0', rating ? RATING_TONE[rating] : 'text-muted-foreground')} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                  <span className="font-medium">{vital.name}</span>
                  <span className={cn('text-xs font-semibold', rating ? RATING_TONE[rating] : 'text-muted-foreground')}>
                    {rating ? `${RATING_LABEL[rating]} · ${formatVital(vital.key, value[vital.key])}` : 'Not enough visits yet'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{vital.question}. {vital.explain}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
