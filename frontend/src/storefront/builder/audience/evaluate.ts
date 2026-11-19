import { compareDecimal } from '@/lib/money'
import type { Device } from '../types'
import {
  AUDIENCE_LANGUAGES,
  MAX_AUDIENCE_RULES,
  WEEKDAYS,
  type Audience,
  type AudienceCampaigns,
  type AudienceContext,
  type AudienceLanguage,
  type AudienceRule,
  type Weekday,
} from './types'

/*
 * B13 §1, pure: whether a node's `audience` lets it show for a context. The payload is checked
 * again here (it may come from an older or newer server): rules that are not well-formed are
 * dropped, and an audience left without rules shows to everyone. Matching never throws.
 */

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile']
const MONEY = /^\d{1,12}(\.\d{1,4})?$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_VALUES = 100

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Strings (or ids) of a list, trimmed and capped; null when not a list. */
function stringList(value: unknown, lower = false): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value.slice(0, MAX_VALUES)) {
    if (typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item))) continue
    const text = String(item).trim()
    if (text) out.push(lower ? text.toLowerCase() : text)
  }
  return out
}

function pickList<T extends string>(value: unknown, options: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null
  const out = options.filter((option) => value.includes(option))
  return out.length > 0 ? out : null
}

const money = (value: unknown): string | null => (typeof value === 'string' && MONEY.test(value) ? value : null)
const time = (value: unknown): string | null => (typeof value === 'string' && TIME.test(value) ? value : null)

/** One rule as the evaluator reads it; null when it is not well-formed. */
export function readAudienceRule(value: unknown): AudienceRule | null {
  if (!isRecord(value)) return null
  switch (value.kind) {
    case 'visitor':
      return value.is === 'new' || value.is === 'returning' ? { kind: 'visitor', is: value.is } : null
    case 'account':
      return value.is === 'signed_in' || value.is === 'guest' ? { kind: 'account', is: value.is } : null
    case 'device': {
      const list = pickList(value.in, DEVICES)
      return list ? { kind: 'device', in: list } : null
    }
    case 'district': {
      const list = stringList(value.in)
      return list && list.length > 0 ? { kind: 'district', in: list } : null
    }
    case 'campaign': {
      const ids = stringList(value.in) ?? []
      const sources = stringList(value.utm_source, true) ?? []
      const names = stringList(value.utm_campaign, true) ?? []
      if (ids.length + sources.length + names.length === 0) return null
      return { kind: 'campaign', in: ids, utm_source: sources, utm_campaign: names }
    }
    case 'cart': {
      const min = money(value.min)
      const max = money(value.max)
      return min || max ? { kind: 'cart', min, max } : null
    }
    case 'time': {
      const days = pickList(value.days, WEEKDAYS)
      const from = time(value.from)
      const to = time(value.to)
      // A rule that limits nothing (all days, all day) still matches everyone: keep it readable as such.
      return { kind: 'time', days, from, to }
    }
    case 'language': {
      const list = pickList(value.in, AUDIENCE_LANGUAGES)
      return list ? { kind: 'language', in: list } : null
    }
    default:
      return null
  }
}

/** A node's audience as the evaluator reads it; null = everyone (absent, not an object, or no well-formed rule). */
export function readAudience(value: unknown): Audience | null {
  if (!isRecord(value) || !Array.isArray(value.rules)) return null
  const rules = value.rules
    .slice(0, MAX_AUDIENCE_RULES)
    .map(readAudienceRule)
    .filter((rule): rule is AudienceRule => rule !== null)
  if (rules.length === 0) return null
  return { match: value.match === 'any' ? 'any' : 'all', rules, otherwise: 'hide' }
}

/** Whether a node carries rules at all (its first paint waits for the evaluation). */
export function hasAudience(node: { audience?: unknown } | null | undefined): boolean {
  return readAudience(node?.audience) !== null
}

const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

function previousDay(day: Weekday): Weekday {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) + WEEKDAYS.length - 1) % WEEKDAYS.length]!
}

/** The time rule: the window `from`–`to` on the listed days; `to` before `from` runs past midnight (the window's day is the day it starts). */
export function matchesTime(rule: { days?: readonly Weekday[] | null; from?: string | null; to?: string | null }, day: Weekday, now: string): boolean {
  if (!TIME.test(now) || !WEEKDAYS.includes(day)) return false
  const days = rule.days && rule.days.length > 0 ? rule.days : null
  const dayOk = (d: Weekday) => days === null || days.includes(d)
  const from = rule.from && TIME.test(rule.from) ? minutesOf(rule.from) : null
  const to = rule.to && TIME.test(rule.to) ? minutesOf(rule.to) : null
  const at = minutesOf(now)
  if (from === null && to === null) return dayOk(day)
  if (from !== null && to === null) return dayOk(day) && at >= from
  if (from === null && to !== null) return dayOk(day) && at < to
  if (from === to) return dayOk(day)
  if (from! < to!) return dayOk(day) && at >= from! && at < to!
  // Past midnight: the evening part belongs to today, the early-morning part to yesterday's window.
  return (at >= from! && dayOk(day)) || (at < to! && dayOk(previousDay(day)))
}

function matchesCampaign(rule: Extract<AudienceRule, { kind: 'campaign' }>, context: AudienceContext, campaigns: AudienceCampaigns | null | undefined): boolean {
  const touch = context.campaign
  if (!touch) return false
  const lower = (value: string | null | undefined) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null)
  const source = lower(touch.utm_source)
  const name = lower(touch.utm_campaign)
  const shortLink = lower(touch.short_link)
  if (source && rule.utm_source?.includes(source)) return true
  if (name && rule.utm_campaign?.includes(name)) return true
  for (const id of rule.in ?? []) {
    if (touch.id && touch.id === id) return true
    const campaign = campaigns && isRecord(campaigns) && Object.hasOwn(campaigns, id) ? campaigns[id] : undefined
    if (!isRecord(campaign)) continue
    if (name && lower(campaign.utm_campaign as string) === name) return true
    if (shortLink && Array.isArray(campaign.short_links) && campaign.short_links.some((code) => lower(code as string) === shortLink)) return true
  }
  return false
}

function matchesRule(rule: AudienceRule, context: AudienceContext, campaigns: AudienceCampaigns | null | undefined): boolean {
  switch (rule.kind) {
    case 'visitor':
      return context.visitor === rule.is
    case 'account':
      return context.account === rule.is
    case 'device':
      return rule.in.includes(context.device)
    case 'district':
      return context.district_id !== null && context.district_id !== undefined && rule.in.map(String).includes(String(context.district_id))
    case 'campaign':
      return matchesCampaign(rule, context, campaigns)
    case 'cart': {
      const subtotal = MONEY.test(context.cart_subtotal) ? context.cart_subtotal : '0'
      if (rule.min && compareDecimal(subtotal, rule.min) < 0) return false
      if (rule.max && compareDecimal(subtotal, rule.max) > 0) return false
      return true
    }
    case 'time':
      return matchesTime(rule, context.day, context.time)
    case 'language':
      return rule.in.includes(context.language as AudienceLanguage)
  }
}

/**
 * Whether a node with this `audience` shows for the context: true for no audience (everyone);
 * `all` = every rule matches, `any` = at least one. `campaigns`: the payload's
 * `audience_campaigns` (campaign rules by id).
 */
export function evaluateAudience(audience: unknown, context: AudienceContext, options: { campaigns?: AudienceCampaigns | null } = {}): boolean {
  const read = readAudience(audience)
  if (!read) return true
  const results = read.rules.map((rule) => matchesRule(rule, context, options.campaigns))
  return read.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}
