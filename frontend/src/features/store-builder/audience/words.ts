import { formatMoney } from '@/lib/money'
import type { Device } from '@/storefront/builder/types'
import {
  MAX_AUDIENCE_RULES,
  WEEKDAYS,
  type Audience,
  type AudienceCampaignRule,
  type AudienceCartRule,
  type AudienceRule,
  type AudienceRuleKind,
  type AudienceTimeRule,
  type Weekday,
} from '@/storefront/builder/audience/types'

/*
 * B13 "Who sees this" in plain words (pure): the sentence the inspector, the canvas badge and the
 * Layers row show ("Only new visitors", "Only shoppers in Dhaka, Chattogram", "Only on phones",
 * "Only when the cart is ৳1,500 or more", "Only 6 PM–11 PM on Fri, Sat"), a short badge text, the
 * rule a kind starts with, and the checks the editor runs before saving (the server checks again,
 * including that districts and campaigns exist in the store).
 */

/** Names for ids the words mention (district id → name, campaign id → name); missing = a fallback. */
export type AudienceLookups = { districts?: ReadonlyMap<string, string>; campaigns?: ReadonlyMap<string, string> }

export const RULE_KIND_LABELS: Record<AudienceRuleKind, string> = {
  visitor: 'New or returning',
  account: 'Signed in or guest',
  device: 'Device',
  district: 'District',
  campaign: 'Campaign',
  cart: 'Cart value',
  time: 'Day and time',
  language: 'Language',
}

export const DAY_SHORT: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
export const DAY_LONG: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

export const DEVICE_WORDS: Record<Device, { one: string; plural: string }> = {
  desktop: { one: 'Computer', plural: 'computers' },
  tablet: { one: 'Tablet', plural: 'tablets' },
  mobile: { one: 'Phone', plural: 'phones' },
}

export const LANGUAGE_WORDS: Record<'en' | 'bn', string> = { en: 'English', bn: 'Bangla' }

/** Server limits (backend contract): districts per rule, campaign ids / utm values per list. */
export const MAX_DISTRICTS = 64
export const MAX_CAMPAIGN_VALUES = 10

const DEVICE_ORDER: readonly Device[] = ['desktop', 'tablet', 'mobile']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MONEY = /^\d{1,12}(\.\d{1,2})?$/

/** "a, b and c". */
export function joinAnd(parts: readonly string[], last = 'and'): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} ${last} ${parts[parts.length - 1]}`
}

/** Comma-separated link values → lower-cased, unique, non-empty (≤ 10, ≤ 100 characters each). */
export function parseValues(text: string): string[] {
  const values = text.split(',').map((v) => v.trim().toLowerCase().slice(0, 100)).filter((v) => v !== '')
  return [...new Set(values)].slice(0, MAX_CAMPAIGN_VALUES)
}

/** "1500" → "1500.00" (the NUMERIC string the document stores). */
export function toMoneyString(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.')
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

/** "1500" → "৳1,500", "99.5" → "৳99.50". */
export function taka(value: string): string {
  const whole = /^\d+(\.0+)?$/.test(value)
  return `৳${formatMoney(value.replace(/^0+(?=\d)/, ''), undefined, whole ? 0 : 2)}`
}

/** "18:00" → "6 PM", "18:30" → "6:30 PM". */
export function clock(time: string): string {
  if (!TIME.test(time)) return time
  const [h, m] = time.split(':').map(Number) as [number, number]
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`} ${h < 12 ? 'AM' : 'PM'}`
}

/** Days in week order: "Fri, Sat"; all seven = "every day"; Monday to Friday = "Mon–Fri". */
export function dayList(days: readonly Weekday[]): string {
  const set = WEEKDAYS.filter((d) => days.includes(d))
  if (set.length === 7) return 'every day'
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri']
  if (set.length === 5 && weekdays.every((d) => set.includes(d as Weekday))) return 'Mon–Fri'
  return set.map((d) => DAY_SHORT[d]).join(', ')
}

function names(ids: readonly (string | number)[], lookup: ReadonlyMap<string, string> | undefined, fallback: string, max = 3): string {
  const list = ids.map((id) => lookup?.get(String(id)) ?? `${fallback} ${id}`)
  if (list.length <= max) return list.join(', ')
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`
}

function campaignValues(rule: AudienceCampaignRule, lookups: AudienceLookups): string[] {
  return [
    ...(rule.in ?? []).map((id) => lookups.campaigns?.get(id) ?? 'a campaign'),
    ...(rule.utm_campaign ?? []).map((v) => `“${v}”`),
    ...(rule.utm_source ?? []).map((v) => v),
  ]
}

function timeWindow(rule: AudienceTimeRule): string {
  const times = rule.from && rule.to ? `${clock(rule.from)}–${clock(rule.to)}` : ''
  const days = rule.days && rule.days.length > 0 && rule.days.length < 7 ? `on ${dayList(rule.days)}` : ''
  if (times && days) return `${times} ${days}`
  return times || days || 'at any time'
}

function cartWords(rule: AudienceCartRule): string {
  const { min, max } = rule
  if (min && max) return `when the cart is ${taka(min)}–${taka(max)}`
  if (min) return `when the cart is ${taka(min)} or more`
  if (max) return `when the cart is ${taka(max)} or less`
  return 'whatever is in the cart'
}

/** One rule as words that follow "Only …". */
export function describeRule(rule: AudienceRule, lookups: AudienceLookups = {}): string {
  switch (rule.kind) {
    case 'visitor':
      return rule.is === 'new' ? 'new visitors' : 'returning visitors'
    case 'account':
      return rule.is === 'signed_in' ? 'signed-in shoppers' : 'guests (not signed in)'
    case 'device': {
      const devices = DEVICE_ORDER.filter((d) => rule.in.includes(d))
      return devices.length === 0 ? 'on no device' : `on ${joinAnd(devices.map((d) => DEVICE_WORDS[d].plural))}`
    }
    case 'district':
      return rule.in.length === 0 ? 'shoppers in no district yet' : `shoppers in ${names(rule.in, lookups.districts, 'district')}`
    case 'campaign': {
      const values = campaignValues(rule, lookups)
      return values.length === 0 ? 'visitors from no campaign yet' : `visitors from ${joinAnd(values.length > 3 ? [...values.slice(0, 3), `${values.length - 3} more`] : values, 'or')}`
    }
    case 'cart':
      return cartWords(rule)
    case 'time':
      return timeWindow(rule)
    case 'language':
      return rule.in.length === 0 ? 'in no language' : `shoppers reading in ${joinAnd(rule.in.map((l) => LANGUAGE_WORDS[l]), 'or')}`
  }
}

/** The whole audience as one sentence: "Everyone" or "Only new visitors and on phones". */
export function describeAudience(audience: Audience | null | undefined, lookups: AudienceLookups = {}): string {
  if (!audience || audience.rules.length === 0) return 'Everyone'
  const parts = audience.rules.map((r) => describeRule(r, lookups))
  return `Only ${joinAnd(parts, audience.match === 'any' ? 'or' : 'and')}`
}

/** A few words for a badge on the canvas and in Layers. */
export function audienceBadgeText(audience: Audience | null | undefined, lookups: AudienceLookups = {}): string | null {
  if (!audience || audience.rules.length === 0) return null
  if (audience.rules.length > 1) return `${audience.rules.length} rules · ${audience.match === 'any' ? 'any' : 'all'}`
  const rule = audience.rules[0]!
  switch (rule.kind) {
    case 'visitor':
      return rule.is === 'new' ? 'New visitors' : 'Returning visitors'
    case 'account':
      return rule.is === 'signed_in' ? 'Signed in' : 'Guests'
    case 'device':
      return DEVICE_ORDER.filter((d) => rule.in.includes(d)).map((d) => DEVICE_WORDS[d].one).join(' + ') || 'No device'
    case 'district': {
      const first = rule.in[0]
      if (first === undefined) return 'District'
      const name = lookups.districts?.get(String(first)) ?? 'District'
      return rule.in.length > 1 ? `${name} +${rule.in.length - 1}` : name
    }
    case 'campaign': {
      const values = campaignValues(rule, lookups)
      return values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0] ?? 'Campaign'
    }
    case 'cart':
      return rule.min && rule.max ? `Cart ${taka(rule.min)}–${taka(rule.max)}` : rule.min ? `Cart ≥ ${taka(rule.min)}` : rule.max ? `Cart ≤ ${taka(rule.max)}` : 'Cart'
    case 'time': {
      const text = timeWindow(rule)
      return text.charAt(0).toUpperCase() + text.slice(1)
    }
    case 'language':
      return rule.in.map((l) => LANGUAGE_WORDS[l]).join(' or ') || 'Language'
  }
}

/** The rule a kind starts with when it is added (filled with something sensible, never invalid where avoidable). */
export function newRule(kind: AudienceRuleKind): AudienceRule {
  switch (kind) {
    case 'visitor':
      return { kind, is: 'new' }
    case 'account':
      return { kind, is: 'signed_in' }
    case 'device':
      return { kind, in: ['mobile'] }
    case 'district':
      return { kind, in: [] }
    case 'campaign':
      return { kind, in: [] }
    case 'cart':
      return { kind, min: '1000.00', max: null }
    case 'time':
      return { kind, days: ['fri', 'sat'], from: '18:00', to: '23:00' }
    case 'language':
      return { kind, in: ['bn'] }
  }
}

/** The kinds still free to add (one rule per kind keeps the sentence clear). */
export function freeKinds(audience: Audience | null | undefined, kinds: readonly AudienceRuleKind[]): AudienceRuleKind[] {
  const used = new Set((audience?.rules ?? []).map((r) => r.kind))
  return kinds.filter((k) => !used.has(k))
}

/** Exact comparison of non-negative NUMERIC strings (no floats). */
export function compareMoney(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.')
  const [bi = '0', bf = ''] = b.split('.')
  const ia = ai.replace(/^0+(?=\d)/, '')
  const ib = bi.replace(/^0+(?=\d)/, '')
  if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1
  if (ia !== ib) return ia < ib ? -1 : 1
  const fa = af.padEnd(2, '0')
  const fb = bf.padEnd(2, '0')
  return fa === fb ? 0 : fa < fb ? -1 : 1
}

export type AudienceProblem = { path: string; message: string }

/** Problems of a node's audience; paths relative to the node (`audience.rules.2.min`). */
export function audienceProblems(audience: Audience | null | undefined): AudienceProblem[] {
  if (!audience) return []
  const problems: AudienceProblem[] = []
  const add = (path: string, message: string) => problems.push({ path: `audience${path}`, message })
  if (audience.match !== 'all' && audience.match !== 'any') add('.match', 'Choose “all of these” or “any of these”.')
  if (audience.rules.length === 0) add('.rules', 'Add a rule, or let everyone see it.')
  if (audience.rules.length > MAX_AUDIENCE_RULES) add('.rules', `At most ${MAX_AUDIENCE_RULES} rules.`)
  audience.rules.forEach((rule, i) => {
    const at = `.rules.${i}`
    switch (rule.kind) {
      case 'device':
        if (rule.in.length === 0) add(`${at}.in`, 'Pick at least one device.')
        break
      case 'district':
        if (rule.in.length === 0) add(`${at}.in`, 'Pick at least one district.')
        else if (rule.in.length > MAX_DISTRICTS) add(`${at}.in`, `At most ${MAX_DISTRICTS} districts.`)
        break
      case 'campaign':
        if ((rule.in?.length ?? 0) + (rule.utm_campaign?.length ?? 0) + (rule.utm_source?.length ?? 0) === 0) add(`${at}.in`, 'Pick a campaign or type a source.')
        if ((rule.in?.length ?? 0) > MAX_CAMPAIGN_VALUES) add(`${at}.in`, `At most ${MAX_CAMPAIGN_VALUES} campaigns.`)
        if ((rule.utm_source?.length ?? 0) > MAX_CAMPAIGN_VALUES) add(`${at}.utm_source`, `At most ${MAX_CAMPAIGN_VALUES} sources.`)
        if ((rule.utm_campaign?.length ?? 0) > MAX_CAMPAIGN_VALUES) add(`${at}.utm_campaign`, `At most ${MAX_CAMPAIGN_VALUES} campaign names.`)
        break
      case 'language':
        if (rule.in.length === 0) add(`${at}.in`, 'Pick a language.')
        break
      case 'cart': {
        const min = rule.min ?? null
        const max = rule.max ?? null
        if (min === null && max === null) add(`${at}.min`, 'Type a lowest or a highest cart value.')
        if (min !== null && !MONEY.test(min)) add(`${at}.min`, 'Type an amount like 1500 or 99.50.')
        if (max !== null && !MONEY.test(max)) add(`${at}.max`, 'Type an amount like 1500 or 99.50.')
        if (min !== null && max !== null && MONEY.test(min) && MONEY.test(max) && compareMoney(min, max) > 0) add(`${at}.max`, 'The highest value is less than the lowest.')
        break
      }
      case 'time': {
        const from = rule.from ?? null
        const to = rule.to ?? null
        if ((from === null) !== (to === null)) add(`${at}.${from === null ? 'from' : 'to'}`, 'Set both times, or neither for all day.')
        if (from !== null && !TIME.test(from)) add(`${at}.from`, 'Enter a time.')
        if (to !== null && !TIME.test(to)) add(`${at}.to`, 'Enter a time.')
        if (from !== null && to !== null && from === to) add(`${at}.to`, 'The start and end can’t be the same time.')
        if ((!rule.days || rule.days.length === 0) && from === null && to === null) add(`${at}.days`, 'Pick days or a time.')
        break
      }
      default:
        break
    }
  })
  return problems
}
