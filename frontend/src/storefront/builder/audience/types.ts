import type { Device } from '../types'

/*
 * B13 — who sees a section or element (audiences) and A/B tests (experiments). The one place for
 * these shapes on the client: the storefront evaluates them, the editor builds them, the canvas
 * previews them. Audiences are presentation, not security: the server sends every variant in the
 * (cacheable) payload and the browser decides what to draw — never hide a secret price or code
 * behind one.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const AUDIENCE_LANGUAGES = ['en', 'bn'] as const
export type AudienceLanguage = (typeof AUDIENCE_LANGUAGES)[number]

export const AUDIENCE_RULE_KINDS = ['visitor', 'account', 'device', 'district', 'campaign', 'cart', 'time', 'language'] as const
export type AudienceRuleKind = (typeof AUDIENCE_RULE_KINDS)[number]

/** Most rules in one audience. */
export const MAX_AUDIENCE_RULES = 6

/** `new` = first page view of this store in this browser; `returning` = seen before (localStorage flag, 2 years). */
export type AudienceVisitorRule = { kind: 'visitor'; is: 'new' | 'returning' }
export type AudienceAccountRule = { kind: 'account'; is: 'signed_in' | 'guest' }
export type AudienceDeviceRule = { kind: 'device'; in: Device[] }
/** Geography district ids (integers; compared as strings): the signed-in shopper's default address, else the district last chosen at checkout / in an order form. */
export type AudienceDistrictRule = { kind: 'district'; in: (string | number)[] }
/**
 * P2a attribution of this visit (last campaign touch, 30 days). Any one matching value is enough:
 * `in` = the store's campaign ids, matched through the payload's `audience_campaigns` (the
 * campaign's utm_campaign or one of its short links); `utm_source` / `utm_campaign` = plain
 * values (lower-cased).
 */
export type AudienceCampaignRule = { kind: 'campaign'; in?: string[]; utm_source?: string[]; utm_campaign?: string[] }

/** Render payload top-level `audience_campaigns`: each campaign a rule names → how a visit is recognised. */
export type AudienceCampaigns = Record<string, { utm_campaign: string; short_links?: string[] }>

/** Cart subtotal (before discounts) as NUMERIC strings; both ends inclusive; at least one end set. */
export type AudienceCartRule = { kind: 'cart'; min?: string | null; max?: string | null }
/**
 * Day / time in the store's timezone. `from`–`to` "HH:MM" (24 h, both or neither, `to` exclusive);
 * `to` before `from` crosses midnight (the day is the day the window starts on). No days / `[]` =
 * every day; no times = all day.
 */
export type AudienceTimeRule = { kind: 'time'; days?: Weekday[] | null; from?: string | null; to?: string | null }
export type AudienceLanguageRule = { kind: 'language'; in: AudienceLanguage[] }

export type AudienceRule =
  | AudienceVisitorRule
  | AudienceAccountRule
  | AudienceDeviceRule
  | AudienceDistrictRule
  | AudienceCampaignRule
  | AudienceCartRule
  | AudienceTimeRule
  | AudienceLanguageRule

/** A node's `audience` (null / absent = everyone). `otherwise`: only `hide` (show-instead = two nodes with opposite rules). */
export type Audience = { match: 'all' | 'any'; rules: AudienceRule[]; otherwise?: 'hide' }

/**
 * What the rules are checked against. Built from the browser on the store (./context.ts); the
 * editor's "Preview as" sends one to the canvas (protocol `preview-as`).
 */
export type AudienceContext = {
  visitor: 'new' | 'returning'
  account: 'signed_in' | 'guest'
  device: Device
  /** District id (compared as a string), null = unknown. */
  district_id: string | number | null
  /**
   * The campaign touch of this visit; null = direct / none. On the store `id` is null (the touch
   * has utm values and a short link code only: ids match through `audience_campaigns`); the
   * editor's preview may set it.
   */
  campaign: { id: string | null; utm_source: string | null; utm_campaign: string | null; short_link?: string | null } | null
  /** Cart subtotal as a NUMERIC string ("0.00" for an empty cart). */
  cart_subtotal: string
  /** Weekday and "HH:MM" now, in the store's timezone. */
  day: Weekday
  time: string
  language: AudienceLanguage
}

/** The editor's "Preview as" (protocol `preview-as`): the same shape. */
export type PreviewContext = AudienceContext

/* ----------------------------------------------------------------------------------------------
 * A/B tests
 * -------------------------------------------------------------------------------------------- */

export type ExperimentArm = 'A' | 'B'
export const EXPERIMENT_ARMS: readonly ExperimentArm[] = ['A', 'B']
export type ExperimentStatus = 'draft' | 'running' | 'stopped' | 'ended'
export type ExperimentGoal = 'orders' | 'add_to_cart' | 'clicks'

/** Most experiments per document. */
export const MAX_EXPERIMENTS = 3

/** Document-level `experiments[]`. `split` = the share (%) of visitors who get version B. */
export type Experiment = {
  id: string
  name: string
  status: ExperimentStatus
  goal: ExperimentGoal
  split: number
  started_at: string | null
  ended_at: string | null
  winner: ExperimentArm | null
}

/** A section's `experiment`: the arm it belongs to (arms are sibling sections, 1–3 each). */
export type SectionExperiment = { id: string; arm: ExperimentArm }

/** The arm of each experiment a visitor sees, by experiment id. */
export type ExperimentArms = Record<string, ExperimentArm>
