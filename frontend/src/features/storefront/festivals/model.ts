/*
 * Pure helpers of Online store → Festivals: dates in the store's timezone and the screen's
 * language, the status of an occasion, the setup form (prefill, checks, request body) and server
 * errors as field messages.
 */

import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import type { ScreenLang } from '@/features/store-builder/pages/messages'
import { slugProblemKey } from '@/features/store-builder/pages/page-helpers'
import { ApiError } from '@/lib/api/client'
import type { Festival, FestivalSetupInput, FestivalSetupState } from './api'
import type { FestivalMessageKey } from './messages'

export const MAX_DAYS = 60
const DAY = 86_400_000

/* ----------------------------------------------------------------------------------------------
 * Dates
 * -------------------------------------------------------------------------------------------- */

/** Today as `YYYY-MM-DD` in the timezone (browser time when unknown). */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  }
}

const ymd = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`)

/** Whole days from `a` to `b` (`YYYY-MM-DD`). */
export const daysBetween = (a: string, b: string) => Math.round((ymd(b) - ymd(a)) / DAY)

/** "In 12 days" / "Today" / "On now" for an occurrence. */
export function dayWord(today: string, startsOn: string, endsOn: string): { key: FestivalMessageKey; count?: number } {
  const until = daysBetween(today, startsOn)
  if (until > 1) return { key: 'day.in', count: until }
  if (until === 1) return { key: 'day.tomorrow' }
  if (until === 0) return { key: 'day.today' }
  return daysBetween(today, endsOn) >= 0 ? { key: 'day.on' } : { key: 'day.past' }
}

const locale = (lang: ScreenLang) => (lang === 'bn' ? 'bn-BD' : 'en-GB')

/** "Fri, 20 March 2026" (Bangla digits and month names in Bangla); a calendar date has no timezone. */
export function formatDay(lang: ScreenLang, value: string): string {
  const time = ymd(value)
  if (Number.isNaN(time)) return value
  return new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(time))
}

/** "20 March, 10:00" in the store's timezone. */
export function formatInstant(lang: ScreenLang, iso: string, timeZone: string | undefined): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(locale(lang), { ...options, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale(lang), options).format(date)
  }
}

/* ----------------------------------------------------------------------------------------------
 * Status
 * -------------------------------------------------------------------------------------------- */

export type FestivalStatus = 'none' | FestivalSetupState

/** The setup of the next occurrence; an ended setup of an earlier year doesn't count. */
export function currentSetup(festival: Festival) {
  const setup = festival.setup
  if (!setup) return null
  if (setup.state === 'ended' && setup.year !== festival.next.year) return null
  return setup
}

export function festivalStatus(festival: Festival): FestivalStatus {
  return currentSetup(festival)?.state ?? 'none'
}

/* ----------------------------------------------------------------------------------------------
 * Setup form
 * -------------------------------------------------------------------------------------------- */

export type SetupForm = {
  /** `datetime-local` values in the store's timezone. */
  starts: string
  ends: string
  landing: boolean
  home_hero: boolean
  bar: boolean
  slug: string
  discountId: string | null
}

export const defaultSlug = (key: string, year: number) => `${key}-${year}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60)

/** The form for an occasion: its current setup's dates and address, else the suggested window. */
export function prefill(festival: Festival, timeZone: string | undefined): SetupForm {
  const setup = currentSetup(festival)
  const sameYear = setup && setup.year === festival.next.year ? setup : null
  const roles = new Set(sameYear?.documents.map((d) => d.role) ?? [])
  return {
    starts: toZonedInput(sameYear?.starts_at ?? festival.suggested.starts_at, timeZone),
    ends: toZonedInput(sameYear?.ends_at ?? festival.suggested.ends_at, timeZone),
    landing: sameYear ? roles.has('landing') : true,
    home_hero: sameYear ? roles.has('home') : true,
    bar: sameYear ? roles.has('bar') : true,
    slug: sameYear?.landing_slug ?? defaultSlug(festival.key, festival.next.year),
    discountId: null,
  }
}

export type SetupProblems = Partial<Record<'starts' | 'ends' | 'include' | 'slug' | 'discount' | 'form', FestivalMessageKey | { text: string }>>

/** Checks before sending; empty = fine. */
export function checkSetup(form: SetupForm, timeZone: string | undefined, now: number = Date.now()): SetupProblems {
  const problems: SetupProblems = {}
  const starts = fromZonedInput(form.starts, timeZone)
  const ends = fromZonedInput(form.ends, timeZone)
  if (!starts) problems.starts = 'problem.dates'
  if (!ends) problems.ends = 'problem.dates'
  if (starts && ends) {
    const a = Date.parse(starts)
    const b = Date.parse(ends)
    if (b <= a) problems.ends = 'problem.order'
    else if (b - a > MAX_DAYS * DAY) problems.ends = 'problem.long'
    else if (b <= now) problems.ends = 'problem.past'
  }
  if (!form.landing && !form.home_hero && !form.bar) problems.include = 'problem.include'
  if (form.landing) {
    const slug = slugProblemKey(form.slug)
    if (slug) problems.slug = slug
  }
  return problems
}

export function setupInput(festival: Festival, form: SetupForm, timeZone: string | undefined): FestivalSetupInput {
  return {
    year: festival.next.year,
    starts_at: fromZonedInput(form.starts, timeZone) ?? form.starts,
    ends_at: fromZonedInput(form.ends, timeZone) ?? form.ends,
    include: { landing: form.landing, home_hero: form.home_hero, bar: form.bar },
    ...(form.discountId ? { discount_id: form.discountId } : {}),
    ...(form.landing ? { landing_slug: form.slug } : {}),
  }
}

const FIELD_OF: Record<string, keyof SetupProblems> = {
  starts_at: 'starts',
  ends_at: 'ends',
  year: 'form',
  include: 'include',
  'include.landing': 'include',
  'include.home_hero': 'include',
  'include.bar': 'include',
  discount_id: 'discount',
  landing_slug: 'slug',
}

/** A failed setup as field messages (the server's own words for validation errors). */
export function serverProblems(error: unknown): SetupProblems {
  if (!(error instanceof ApiError)) return error ? { form: 'problem.failed' } : {}
  if (error.code === 'SLUG_TAKEN') return { slug: 'problem.slugTaken' }
  if (error.code === 'FESTIVAL_DATE_UNKNOWN') return { form: 'problem.dateUnknown' }
  if (error.code === 'VALIDATION_FAILED' || error.code === 'VALIDATION_ERROR') {
    const details = error.details as Record<string, unknown>
    const fields = (details.errors && typeof details.errors === 'object' ? details.errors : details) as Record<string, unknown>
    const problems: SetupProblems = {}
    for (const [path, messages] of Object.entries(fields)) {
      const text = Array.isArray(messages) ? String(messages[0] ?? '') : String(messages ?? '')
      const field = FIELD_OF[path] ?? 'form'
      if (text && !problems[field]) problems[field] = { text }
    }
    return Object.keys(problems).length > 0 ? problems : { form: { text: error.message } }
  }
  return { form: { text: error.message || '' } }
}
