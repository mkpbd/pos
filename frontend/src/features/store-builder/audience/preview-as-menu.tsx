import { useId, useMemo, useState } from 'react'
import { ChevronDownIcon, ClockIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useCurrentUserQuery } from '@/features/auth/api'
import { cn } from '@/lib/utils'
import { WEEKDAYS, type Weekday } from '@/storefront/builder/audience/types'
import type { Device } from '@/storefront/builder/types'
import { parseMoney } from '../inspector/b8a-model'
import { useEditor } from '../store'
import { ruledNodes } from './badges'
import { useAudienceData } from './lookups'
import { audienceHiddenIds, defaultPreview, nowIn, previewContext, previewSummary, type PreviewSettings } from './preview'
import { DAY_LONG, DEVICE_WORDS, toMoneyString } from './words'

/*
 * B13 toolbar "Preview as": "Show everything" (the default: every part drawn, rules shown as
 * badges) or a made-up shopper — new or returning, signed in or guest, device (the canvas width),
 * district, campaign, cart value, day and time (store time) and language. The canvas fades what
 * that shopper wouldn't see; the parts stay selectable so they can still be edited.
 */

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile']
const selectClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'


function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string; lang?: string }[]; onChange: (value: V) => void }) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-flow-col gap-1 rounded-md border p-0.5">
      {options.map((option) => (
        <label
          key={option.value}
          lang={option.lang}
          className={cn(
            'flex cursor-pointer items-center justify-center rounded px-2 py-1 text-xs has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
            value === option.value ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <input type="radio" className="sr-only" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
          {option.label}
        </label>
      ))}
    </div>
  )
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm">{label}</label>
      ) : (
        <span className="text-sm" aria-hidden>{label}</span>
      )}
      {children}
    </div>
  )
}

export function PreviewAsMenu({ bangla = false }: { bangla?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const previewAs = useEditor((s) => s.previewAs)
  const setPreviewAs = useEditor((s) => s.setPreviewAs)
  const device = useEditor((s) => s.device)
  const setDevice = useEditor((s) => s.setDevice)
  const editLocale = useEditor((s) => s.editLocale)
  const setEditLocale = useEditor((s) => s.setEditLocale)
  const content = useEditor((s) => s.content)
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone
  const data = useAudienceData({ enabled: open || previewAs !== null })
  const [cartText, setCartText] = useState('')

  const ruled = useMemo(() => ruledNodes(content.sections).length, [content.sections])
  const faded = useMemo(
    () => (previewAs ? audienceHiddenIds(content, previewContext(previewAs, device), data.campaignUtm) : new Set<string>()),
    [content, previewAs, device, data.campaignUtm],
  )
  // Parts with a rule that this shopper wouldn't see (by their own rule or one around them).
  const fadedRules = useMemo(() => ruledNodes(content.sections).filter((n) => faded.has(n.id)).length, [content.sections, faded])

  const set = (patch: Partial<PreviewSettings>) => previewAs && setPreviewAs({ ...previewAs, ...patch })
  const start = () => {
    setCartText('')
    setPreviewAs(defaultPreview(timeZone, editLocale))
  }
  const district = previewAs?.district_id != null ? (data.districts?.get(String(previewAs.district_id)) ?? null) : null
  const campaign = previewAs?.campaign?.id ? (data.campaigns?.get(previewAs.campaign.id) ?? null) : null
  const summary = previewAs ? previewSummary(previewAs, { district, campaign }) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={previewAs ? 'secondary' : 'ghost'}
          size="sm"
          className="max-w-56"
          data-testid="preview-as-button"
          aria-label={previewAs ? `Preview as: ${summary}` : 'Preview as: show everything'}
          title={previewAs ? `Previewing as: ${summary}` : 'See the page as a particular shopper would'}
        >
          <UsersIcon data-icon="inline-start" />
          <span className="truncate">{previewAs ? summary : 'Show everything'}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80" data-testid="preview-as-panel">
        <PopoverTitle>Preview as</PopoverTitle>
        <PopoverDescription>
          {ruled === 0 ? 'Nothing on this page has a “Who sees this” rule yet, so every shopper sees all of it.' : `${ruled} ${ruled === 1 ? 'part of this page has' : 'parts of this page have'} a “Who sees this” rule.`}
        </PopoverDescription>

        <div role="radiogroup" aria-label="What the canvas shows" className="mt-3 flex flex-col gap-1">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" className="mt-1 accent-primary" name={`${id}-mode`} checked={previewAs === null} onChange={() => setPreviewAs(null)} data-testid="preview-as-everything" />
            <span>
              Show everything
              <span className="block text-xs text-muted-foreground">Every part, whoever it is for.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" className="mt-1 accent-primary" name={`${id}-mode`} checked={previewAs !== null} onChange={start} data-testid="preview-as-shopper" />
            <span>
              A shopper like this
              <span className="block text-xs text-muted-foreground">Parts they wouldn’t see are faded (you can still edit them).</span>
            </span>
          </label>
        </div>

        {previewAs && (
          <div className="mt-3 flex flex-col gap-2 border-t pt-3">
            <Row label="Visitor">
              <Segmented label="Visitor" value={previewAs.visitor} onChange={(visitor) => set({ visitor })} options={[{ value: 'new', label: 'New' }, { value: 'returning', label: 'Returning' }]} />
            </Row>
            <Row label="Account">
              <Segmented label="Account" value={previewAs.account} onChange={(account) => set({ account })} options={[{ value: 'guest', label: 'Guest' }, { value: 'signed_in', label: 'Signed in' }]} />
            </Row>
            <Row label="Device">
              <Segmented label="Device" value={device} onChange={setDevice} options={DEVICES.map((d) => ({ value: d, label: DEVICE_WORDS[d].one }))} />
            </Row>
            <Row label="District" htmlFor={`${id}-district`}>
              <select
                id={`${id}-district`}
                className={selectClass}
                value={previewAs.district_id === null ? '' : String(previewAs.district_id)}
                onChange={(e) => set({ district_id: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Not known</option>
                {data.districtList.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Row>
            <Row label="Came from" htmlFor={`${id}-campaign`}>
              <select
                id={`${id}-campaign`}
                className={selectClass}
                value={previewAs.campaign?.id ?? ''}
                onChange={(e) => {
                  const picked = data.campaignList.find((c) => c.id === e.target.value)
                  set({ campaign: picked ? { id: picked.id, utm_source: null, utm_campaign: picked.utm_campaign.toLowerCase() } : null })
                }}
              >
                <option value="">No campaign</option>
                {data.campaignList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Row>
            <Row label="Link source" htmlFor={`${id}-source`}>
              <Input
                id={`${id}-source`}
                className="h-8"
                placeholder="e.g. facebook"
                spellCheck={false}
                value={previewAs.campaign?.utm_source ?? ''}
                onChange={(e) => {
                  const utm_source = e.target.value.trim().toLowerCase() || null
                  const base = previewAs.campaign ?? { id: null, utm_campaign: null, utm_source: null }
                  const next = { ...base, utm_source }
                  set({ campaign: next.id === null && next.utm_campaign === null && next.utm_source === null ? null : next })
                }}
              />
            </Row>
            <Row label="Cart value" htmlFor={`${id}-cart`}>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground" aria-hidden>৳</span>
                <Input
                  id={`${id}-cart`}
                  className="h-8"
                  inputMode="decimal"
                  placeholder="0 (empty cart)"
                  value={cartText}
                  aria-invalid={cartText.trim() !== '' && parseMoney(cartText) === null ? true : undefined}
                  onChange={(e) => {
                    setCartText(e.target.value)
                    const amount = e.target.value.trim() === '' ? '0' : parseMoney(e.target.value)
                    if (amount !== null) set({ cart_subtotal: toMoneyString(amount) })
                  }}
                />
              </div>
            </Row>
            <Row label="Day and time">
              <div className="flex items-center gap-1">
                <select aria-label="Day" className={cn(selectClass, 'w-auto')} value={previewAs.day} onChange={(e) => set({ day: e.target.value as Weekday })}>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>{DAY_LONG[d]}</option>
                  ))}
                </select>
                <input
                  type="time"
                  aria-label="Time"
                  className={cn(selectClass, 'w-auto tabular-nums')}
                  value={previewAs.time}
                  onChange={(e) => e.target.value && set({ time: e.target.value })}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Now" title={`Now in store time${timeZone ? ` (${timeZone})` : ''}`} onClick={() => set(nowIn(timeZone))}>
                  <ClockIcon />
                </Button>
              </div>
            </Row>
            <Row label="Language">
              <Segmented
                label="Language"
                value={previewAs.language}
                onChange={(language) => {
                  set({ language })
                  // The canvas shows that language's texts too when the store has Bangla.
                  if (bangla) setEditLocale(language)
                }}
                options={[{ value: 'en', label: 'English', lang: 'en' }, { value: 'bn', label: 'বাংলা', lang: 'bn' }]}
              />
            </Row>
            <p role="status" className="text-xs text-muted-foreground" data-testid="preview-as-result">
              {ruled === 0 ? 'Store time. No rules to check.' : fadedRules === 0 ? 'This shopper sees every part.' : `${fadedRules} ${fadedRules === 1 ? 'part is' : 'parts are'} faded: this shopper wouldn’t see ${fadedRules === 1 ? 'it' : 'them'}.`}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
