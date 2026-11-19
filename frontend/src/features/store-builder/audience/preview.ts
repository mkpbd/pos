import { evaluateAudience } from '@/storefront/builder/audience/evaluate'
import { WEEKDAYS, type Audience, type AudienceCampaigns, type PreviewContext, type Weekday } from '@/storefront/builder/audience/types'
import type { BuilderContent, Device } from '@/storefront/builder/types'
import { DAY_SHORT, LANGUAGE_WORDS, clock, taka } from './words'

/*
 * B13 "Preview as" (pure): the shopper the canvas pretends to be. Null = "Show everything" (the
 * editor's default: every node drawn, audience badges only). A setting = the canvas evaluates each
 * node's audience against it and fades the ones this shopper wouldn't see (still selectable). The
 * device is the canvas's own (the toolbar's width buttons), so it lives outside the settings.
 */

export type PreviewSettings = Omit<PreviewContext, 'device'>

/** Weekday and "HH:MM" now in a timezone (the store's; undefined = the browser's). */
export function nowIn(timeZone: string | undefined, at: Date = new Date()): { day: Weekday; time: string } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = (get('weekday').slice(0, 3).toLowerCase() as Weekday) || 'mon'
  return { day: WEEKDAYS.includes(day) ? day : 'mon', time: `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}` }
}

/** A first-time guest, no district or campaign, empty cart, now in the store's time. */
export function defaultPreview(timeZone: string | undefined, language: 'en' | 'bn' = 'en', at?: Date): PreviewSettings {
  return { visitor: 'new', account: 'guest', district_id: null, campaign: null, cart_subtotal: '0.00', ...nowIn(timeZone, at), language }
}

/**
 * The context the canvas checks rules against. The language follows "Edit in" when the store edits
 * Bangla (both controls set both), so the shopper and the texts on the canvas agree.
 */
export function previewContext(settings: PreviewSettings, device: Device): PreviewContext {
  return { ...settings, device }
}

/** A short line for the toolbar button: "New visitor · guest · Fri 8 PM". */
export function previewSummary(settings: PreviewSettings, names: { district?: string | null; campaign?: string | null } = {}): string {
  const parts = [settings.visitor === 'new' ? 'New visitor' : 'Returning visitor', settings.account === 'guest' ? 'guest' : 'signed in']
  if (settings.district_id !== null) parts.push(names.district ?? 'a district')
  if (settings.campaign) parts.push(names.campaign ?? settings.campaign.utm_campaign ?? settings.campaign.utm_source ?? 'a campaign')
  if (settings.cart_subtotal !== '0.00' && settings.cart_subtotal !== '0') parts.push(`cart ${taka(settings.cart_subtotal)}`)
  parts.push(`${DAY_SHORT[settings.day]} ${clock(settings.time)}`)
  parts.push(LANGUAGE_WORDS[settings.language])
  return parts.join(' · ')
}

type AnyNode = { id: string; audience?: Audience | null; columns?: { id: string; elements: AnyNode[] }[] }

/**
 * The ids a shopper wouldn't see because of an audience — the node with the rule and everything
 * inside it (for fading Layers rows). Empty for "Show everything".
 */
export function audienceHiddenIds(content: Pick<BuilderContent, 'sections'>, context: PreviewContext | null, campaigns?: AudienceCampaigns | null): Set<string> {
  const out = new Set<string>()
  if (!context) return out
  const walk = (node: AnyNode, hidden: boolean) => {
    const own = hidden || (node.audience ? !evaluateAudience(node.audience, context, { campaigns }) : false)
    if (own) out.add(node.id)
    for (const column of node.columns ?? []) {
      if (own) out.add(column.id)
      for (const element of column.elements) walk(element, own)
    }
  }
  for (const section of content.sections as unknown as AnyNode[]) walk(section, false)
  return out
}
