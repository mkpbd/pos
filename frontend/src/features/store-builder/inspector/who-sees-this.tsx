/*
 * B13 Advanced → "Who sees this": a section or element shown only to some shoppers. Rules in plain
 * words (one per kind: new or returning, signed in or guest, device, district, campaign, cart value,
 * day and time, language), "all of these" or "any of these", and the sentence they add up to. The
 * storefront checks them in the shopper's browser after the page loads — presentation, not a lock.
 */

import { useId, useMemo, useState, type ReactNode } from 'react'
import { InfoIcon, PlusIcon, Trash2Icon, UsersIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useCurrentUserQuery } from '@/features/auth/api'
import { cn } from '@/lib/utils'
import { AUDIENCE_RULE_KINDS, MAX_AUDIENCE_RULES, WEEKDAYS, type Audience, type AudienceRule, type Weekday } from '@/storefront/builder/audience/types'
import type { Device } from '@/storefront/builder/types'
import { useAudienceData, type AudienceData } from '../audience/lookups'
import { DAY_LONG, DAY_SHORT, DEVICE_WORDS, MAX_CAMPAIGN_VALUES, MAX_DISTRICTS, RULE_KIND_LABELS, describeAudience, describeRule, freeKinds, newRule, parseValues, toMoneyString } from '../audience/words'
import { parseMoney } from './b8a-model'
import { FieldError, type Errors } from './fields'
import type { InspectorChangeOptions } from './types'

type Change = (audience: Audience | null, opts?: InspectorChangeOptions) => void

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile']

/** "1500.00" → "1500", "99.50" → "99.50" (how a stored amount is shown in its field). */
function moneyInput(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\.00$/, '')
}

/** The first problem of a rule (any of its fields), for the message under it. */
function ruleError(errors: Errors, index: number): string | undefined {
  const prefix = `audience.rules.${index}`
  const key = Object.keys(errors).find((k) => k === prefix || k.startsWith(`${prefix}.`))
  return key ? errors[key] : undefined
}

function fieldError(errors: Errors, index: number, field: string): string | undefined {
  return errors[`audience.rules.${index}.${field}`]
}

export function WhoSeesThis({ nodeId, noun, audience, onChange, errors }: {
  nodeId: string
  noun: string
  audience: Audience | null | undefined
  onChange: Change
  errors: Errors
}) {
  const id = useId()
  const data = useAudienceData()
  const rules = audience?.rules ?? []
  const free = freeKinds(audience, AUDIENCE_RULE_KINDS)
  const sentence = describeAudience(audience, data)
  const topError = errors['audience'] ?? errors['audience.rules'] ?? errors['audience.match']

  const setRules = (next: AudienceRule[], opts?: InspectorChangeOptions) =>
    onChange(next.length === 0 ? null : { match: audience?.match ?? 'all', rules: next, otherwise: 'hide' }, opts)
  const setRule = (index: number, rule: AudienceRule, typing?: string) =>
    setRules(rules.map((r, i) => (i === index ? rule : r)), typing ? { coalesceKey: `${nodeId}:audience.${index}.${typing}` } : undefined)

  return (
    <fieldset className="flex flex-col gap-3" data-testid="who-sees-this" aria-describedby={`${id}-sentence`}>
      <legend className="mb-1.5 text-sm font-medium">Who sees this</legend>

      <p id={`${id}-sentence`} data-testid="audience-sentence" className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
        <UsersIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{rules.length === 0 ? `Everyone sees this ${noun}.` : `${sentence}.`}</span>
      </p>

      {rules.length > 1 && (
        <div role="radiogroup" aria-label="When to show it" className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground" aria-hidden>Show it when</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(['all', 'any'] as const).map((match) => (
              <label
                key={match}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                  audience?.match === match ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <input type="radio" className="accent-primary" name={`${id}-match`} checked={audience?.match === match} onChange={() => audience && onChange({ ...audience, match })} />
                {match === 'all' ? 'All of these are true' : 'Any one is true'}
              </label>
            ))}
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Rules">
          {rules.map((rule, index) => (
            <RuleCard
              key={rule.kind}
              rule={rule}
              index={index}
              data={data}
              error={ruleError(errors, index)}
              errors={errors}
              onChange={(next, typing) => setRule(index, next, typing)}
              onRemove={() => setRules(rules.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      )}
      <FieldError message={topError} />

      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={free.length === 0 || rules.length >= MAX_AUDIENCE_RULES} data-testid="audience-add-rule">
              <PlusIcon data-icon="inline-start" /> {rules.length === 0 ? 'Show only to some shoppers' : 'Add a rule'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Only show it to shoppers by…</DropdownMenuLabel>
            {free.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => setRules([...rules, newRule(kind)])} data-testid={`audience-add-${kind}`}>
                {RULE_KIND_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {rules.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} data-testid="audience-clear">
            Let everyone see it
          </Button>
        )}
      </div>

      <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid="audience-not-secret">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          This only changes what shoppers see; it is not a lock. Everything is still sent to every browser, so never put secret prices or discount codes here.
          {rules.length > 0 && ' Shoppers who don’t match don’t see it (nothing shows in its place — for a different version, add a second one with the opposite rule).'}
        </span>
      </p>
    </fieldset>
  )
}

function RuleCard({ rule, index, data, error, errors, onChange, onRemove }: {
  rule: AudienceRule
  index: number
  data: AudienceData
  error?: string
  errors: Errors
  onChange: (rule: AudienceRule, typing?: string) => void
  onRemove: () => void
}) {
  const headingId = useId()
  const label = RULE_KIND_LABELS[rule.kind]
  return (
    <li className={cn('flex flex-col gap-2 rounded-md border p-2.5', error && 'border-destructive')} aria-labelledby={headingId} data-testid={`audience-rule-${rule.kind}`}>
      <div className="flex items-center gap-2">
        <h4 id={headingId} className="flex-1 text-sm font-medium">{label}</h4>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove the ${label.toLowerCase()} rule`} title="Remove this rule" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>
      <RuleFields rule={rule} index={index} data={data} errors={errors} onChange={onChange} />
      <p className="text-xs text-muted-foreground">Only {describeRule(rule, data)}.</p>
      <FieldError message={error} />
    </li>
  )
}

function Radios<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string; hint?: string }[]; onChange: (value: V) => void }) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
          <input type="radio" className="mt-1 accent-primary" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>
            {option.label}
            {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

function Toggles<V extends string>({ label, values, options, onChange, lang }: {
  label: string
  values: readonly V[]
  options: { value: V; label: string; title?: string; lang?: string }[]
  onChange: (values: V[]) => void
  lang?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5" lang={lang}>
      {options.map((option) => {
        const on = values.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            title={option.title}
            lang={option.lang}
            onClick={() => onChange(on ? values.filter((v) => v !== option.value) : options.map((o) => o.value).filter((v) => v === option.value || values.includes(v)))}
            className={cn(
              'min-h-8 min-w-10 rounded-md border px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              on ? 'border-primary bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function RuleFields({ rule, index, data, errors, onChange }: { rule: AudienceRule; index: number; data: AudienceData; errors: Errors; onChange: (rule: AudienceRule, typing?: string) => void }) {
  switch (rule.kind) {
    case 'visitor':
      return (
        <Radios
          label="New or returning"
          value={rule.is}
          onChange={(is) => onChange({ ...rule, is })}
          options={[
            { value: 'new', label: 'New visitors', hint: 'Their first visit to your store in this browser.' },
            { value: 'returning', label: 'Returning visitors', hint: 'They have visited your store before (remembered for 2 years).' },
          ]}
        />
      )
    case 'account':
      return (
        <Radios
          label="Signed in or guest"
          value={rule.is}
          onChange={(is) => onChange({ ...rule, is })}
          options={[
            { value: 'signed_in', label: 'Signed-in shoppers' },
            { value: 'guest', label: 'Guests (not signed in)' },
          ]}
        />
      )
    case 'device':
      return <Toggles label="Devices" values={rule.in} onChange={(next) => onChange({ ...rule, in: next })} options={DEVICES.map((d) => ({ value: d, label: `${DEVICE_WORDS[d].one}s` }))} />
    case 'language':
      return (
        <Toggles
          label="Languages"
          values={rule.in}
          onChange={(next) => onChange({ ...rule, in: next })}
          options={[
            { value: 'en', label: 'English', lang: 'en' },
            { value: 'bn', label: 'বাংলা', title: 'Bangla', lang: 'bn' },
          ]}
        />
      )
    case 'district':
      return <DistrictPicker value={rule.in.map(Number)} data={data} onChange={(ids) => onChange({ ...rule, in: ids })} />
    case 'campaign':
      return <CampaignPicker rule={rule} data={data} onChange={onChange} />
    case 'cart':
      return (
        <div className="grid grid-cols-2 gap-2">
          <MoneyField label="At least" value={rule.min ?? null} error={fieldError(errors, index, 'min')} onChange={(min) => onChange({ ...rule, min }, 'min')} />
          <MoneyField label="At most" value={rule.max ?? null} error={fieldError(errors, index, 'max')} onChange={(max) => onChange({ ...rule, max }, 'max')} />
          <p className="col-span-2 text-xs text-muted-foreground">The cart’s total before discounts, in ৳. Leave one empty for no limit.</p>
        </div>
      )
    case 'time':
      return <TimeFields rule={rule} onChange={onChange} />
  }
}

function MoneyField({ label, value, error, onChange }: { label: string; value: string | null; error?: string; onChange: (value: string | null) => void }) {
  const id = useId()
  const [text, setText] = useState(moneyInput(value))
  const [bad, setBad] = useState(false)
  // A new value from outside (undo, another rule) replaces what is typed unless it means the same.
  const parsed = text.trim() === '' ? null : parseMoney(text)
  if (!bad && (parsed === null ? null : toMoneyString(parsed)) !== value) setText(moneyInput(value))
  const message = bad ? 'Type an amount like 1500 or 99.50.' : error
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">{label}</label>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground" aria-hidden>৳</span>
        <Input
          id={id}
          inputMode="decimal"
          placeholder="No limit"
          value={text}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-error` : undefined}
          className="h-8"
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            if (next.trim() === '') {
              setBad(false)
              onChange(null)
              return
            }
            const amount = parseMoney(next)
            setBad(amount === null)
            if (amount !== null) onChange(toMoneyString(amount))
          }}
        />
      </div>
      {message && <p id={`${id}-error`} className="text-xs text-destructive">{message}</p>}
    </div>
  )
}

function TimeFields({ rule, onChange }: { rule: Extract<AudienceRule, { kind: 'time' }>; onChange: (rule: AudienceRule, typing?: string) => void }) {
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone
  const allDay = !rule.from && !rule.to
  const days = rule.days ?? []
  const timeClass = 'h-8 w-full min-w-0 rounded-md border border-input bg-background px-1.5 text-sm tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/40'
  const wraps = rule.from && rule.to && rule.to < rule.from
  return (
    <div className="flex flex-col gap-2">
      <Toggles
        label="Days"
        values={days}
        onChange={(next) => onChange({ ...rule, days: next as Weekday[] })}
        options={WEEKDAYS.map((d) => ({ value: d, label: DAY_SHORT[d], title: DAY_LONG[d] }))}
      />
      <p className="text-xs text-muted-foreground">{days.length === 0 ? 'No day picked: every day.' : null}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-primary" checked={allDay} onChange={(e) => onChange(e.target.checked ? { ...rule, from: null, to: null } : { ...rule, from: '18:00', to: '23:00' })} />
        All day
      </label>
      {!allDay && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <input type="time" aria-label="From" className={timeClass} value={rule.from ?? ''} onChange={(e) => onChange({ ...rule, from: e.target.value || null }, 'from')} />
          <span className="text-xs text-muted-foreground" aria-hidden>to</span>
          <input type="time" aria-label="Until" className={timeClass} value={rule.to ?? ''} onChange={(e) => onChange({ ...rule, to: e.target.value || null }, 'to')} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Store time{timeZone ? ` (${timeZone})` : ''}.{wraps ? ' Runs past midnight into the next morning.' : ''}
      </p>
    </div>
  )
}

function Chips({ items, label, onRemove }: { items: { key: string; text: ReactNode; name: string }[]; label: string; onRemove: (key: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-0.5 rounded-full border bg-muted py-0.5 pr-0.5 pl-2 text-xs">
          {item.text}
          <button type="button" className="rounded-full p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.key)}>
            <XIcon className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function DistrictPicker({ value, data, onChange }: { value: number[]; data: AudienceData; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState('')
  const listId = useId()
  const term = search.trim().toLowerCase()
  const shown = useMemo(
    () => data.districtList.filter((d) => term === '' || d.name.toLowerCase().includes(term) || (d.name_bn ?? '').includes(search.trim())),
    [data.districtList, term, search],
  )
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id].slice(0, MAX_DISTRICTS))
  return (
    <div className="flex flex-col gap-1.5">
      <Chips
        label="Chosen districts"
        items={value.map((id) => {
          const name = data.districts?.get(String(id)) ?? `District ${id}`
          return { key: String(id), text: name, name }
        })}
        onRemove={(key) => onChange(value.filter((v) => String(v) !== key))}
      />
      <Input type="search" aria-label="Find a district" placeholder="Find a district" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" aria-controls={listId} />
      {data.loadingDistricts ? (
        <p className="text-xs text-muted-foreground">Loading districts…</p>
      ) : (
        <ul id={listId} aria-label="Districts" className="max-h-40 overflow-y-auto rounded-md border p-1">
          {shown.length === 0 && <li className="px-1 py-0.5 text-xs text-muted-foreground">No district matches “{search}”.</li>}
          {shown.map((d) => (
            <li key={d.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <input type="checkbox" className="accent-primary" checked={value.includes(d.id)} onChange={() => toggle(d.id)} />
                <span className="flex-1">{d.name}</span>
                {d.name_bn && <span lang="bn" className="text-xs text-muted-foreground">{d.name_bn}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">From a signed-in shopper’s address, otherwise the district they last chose at checkout. Shoppers we don’t know a district for don’t match.</p>
    </div>
  )
}

function ValuesField({ label, hint, values, onChange }: { label: string; hint: string; values: string[]; onChange: (values: string[]) => void }) {
  const id = useId()
  const [text, setText] = useState(values.join(', '))
  if (parseValues(text).join(',') !== values.join(',')) setText(values.join(', '))
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">{label}</label>
      <Input
        id={id}
        className="h-8"
        value={text}
        spellCheck={false}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value)
          onChange(parseValues(e.target.value))
        }}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function CampaignPicker({ rule, data, onChange }: { rule: Extract<AudienceRule, { kind: 'campaign' }>; data: AudienceData; onChange: (rule: AudienceRule, typing?: string) => void }) {
  const ids = rule.in ?? []
  const known = new Set(data.campaignList.map((c) => c.id))
  const toggle = (id: string) => onChange({ ...rule, in: ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id].slice(0, MAX_CAMPAIGN_VALUES) })
  return (
    <div className="flex flex-col gap-2">
      {data.canListCampaigns ? (
        data.loadingCampaigns ? (
          <p className="text-xs text-muted-foreground">Loading campaigns…</p>
        ) : data.campaignList.length === 0 && ids.length === 0 ? (
          <p className="text-xs text-muted-foreground">No campaigns yet — create them under Marketing, or type the link values below.</p>
        ) : (
          <ul aria-label="Campaigns" className="max-h-40 overflow-y-auto rounded-md border p-1">
            {data.campaignList.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring">
                  <input type="checkbox" className="accent-primary" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="flex-1">{c.name}</span>
                  {c.status === 'archived' && <span className="text-xs text-muted-foreground">archived</span>}
                </label>
              </li>
            ))}
            {ids.filter((id) => !known.has(id)).map((id) => (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                  <input type="checkbox" className="accent-primary" checked onChange={() => toggle(id)} />
                  <span className="flex-1 text-muted-foreground">A campaign that is gone</span>
                </label>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-xs text-muted-foreground">
          {ids.length > 0 ? `${ids.length} chosen ${ids.length === 1 ? 'campaign' : 'campaigns'}. ` : ''}You can’t see the store’s campaigns; type the link values instead.
        </p>
      )}
      <ValuesField label="Link source" hint="utm_source, e.g. facebook, sms — separate with commas." values={rule.utm_source ?? []} onChange={(utm_source) => onChange({ ...rule, utm_source }, 'utm_source')} />
      <ValuesField label="Campaign name in the link" hint="utm_campaign, e.g. eid-sale — separate with commas." values={rule.utm_campaign ?? []} onChange={(utm_campaign) => onChange({ ...rule, utm_campaign }, 'utm_campaign')} />
      <p className="text-xs text-muted-foreground">Shoppers who came from any of these (their last campaign link within 30 days).</p>
    </div>
  )
}
