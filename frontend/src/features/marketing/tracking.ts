import type { TrackingSettings, TrackingSettingsInput } from '@/features/marketing/tracking-api'

/** BD1c: the Tracking & pixels form (pure helpers; the server's rules). */

export const META_PIXEL_ID = /^\d{10,20}$/
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/
export const TIKTOK_PIXEL_ID = /^[A-Z0-9]{10,30}$/
export const TEST_EVENT_CODE_MAX = 40
export const CODE_MAX = 20_000

export type TrackingDraft = {
  meta_pixel_id: string
  meta_capi_enabled: boolean
  meta_test_event_code: string
  ga4_measurement_id: string
  tiktok_pixel_id: string
  head_code: string
  body_code: string
}

export type TrackingErrorKey = keyof TrackingDraft | 'meta_capi_token' | 'form'
export type TrackingErrors = Partial<Record<TrackingErrorKey, string>>
export const TRACKING_ERROR_KEYS: TrackingErrorKey[] = ['meta_pixel_id', 'meta_capi_enabled', 'meta_capi_token', 'meta_test_event_code', 'ga4_measurement_id', 'tiktok_pixel_id', 'head_code', 'body_code']

export function toTrackingDraft(s: TrackingSettings): TrackingDraft {
  return {
    meta_pixel_id: s.meta_pixel_id ?? '',
    meta_capi_enabled: s.meta_capi_enabled,
    meta_test_event_code: s.meta_test_event_code ?? '',
    ga4_measurement_id: s.ga4_measurement_id ?? '',
    tiktok_pixel_id: s.tiktok_pixel_id ?? '',
    head_code: s.head_code ?? '',
    body_code: s.body_code ?? '',
  }
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
/** IDs are typed as shown in the ad tools; GA4 and TikTok IDs are upper-case. */
const upperOrNull = (v: string) => orNull(v)?.toUpperCase() ?? null
/** Pasted code is kept as typed (only empty becomes null). */
const codeOrNull = (v: string) => (v.trim() === '' ? null : v)

/** The changed fields only; the token only when a new one was typed; the code only for people who may change it. */
export function trackingChanges(d: TrackingDraft, s: TrackingSettings, token: string): TrackingSettingsInput {
  const input: TrackingSettingsInput = {}
  if (orNull(d.meta_pixel_id) !== s.meta_pixel_id) input.meta_pixel_id = orNull(d.meta_pixel_id)
  if (d.meta_capi_enabled !== s.meta_capi_enabled) input.meta_capi_enabled = d.meta_capi_enabled
  if (orNull(d.meta_test_event_code) !== s.meta_test_event_code) input.meta_test_event_code = orNull(d.meta_test_event_code)
  if (upperOrNull(d.ga4_measurement_id) !== s.ga4_measurement_id) input.ga4_measurement_id = upperOrNull(d.ga4_measurement_id)
  if (upperOrNull(d.tiktok_pixel_id) !== s.tiktok_pixel_id) input.tiktok_pixel_id = upperOrNull(d.tiktok_pixel_id)
  if (s.can_edit_code) {
    if (codeOrNull(d.head_code) !== s.head_code) input.head_code = codeOrNull(d.head_code)
    if (codeOrNull(d.body_code) !== s.body_code) input.body_code = codeOrNull(d.body_code)
  }
  if (token.trim() !== '') input.meta_capi_token = token.trim()
  return input
}

export function validateTracking(d: TrackingDraft, s: TrackingSettings, token: string): TrackingErrors {
  const errors: TrackingErrors = {}
  const pixel = d.meta_pixel_id.trim()
  if (pixel !== '' && !META_PIXEL_ID.test(pixel)) errors.meta_pixel_id = 'The pixel ID is 10 to 20 digits, e.g. 1234567890123456.'
  const ga4 = d.ga4_measurement_id.trim().toUpperCase()
  if (ga4 !== '' && !GA4_MEASUREMENT_ID.test(ga4)) errors.ga4_measurement_id = 'Starts with G-, e.g. G-AB12CD34EF.'
  const tiktok = d.tiktok_pixel_id.trim().toUpperCase()
  if (tiktok !== '' && !TIKTOK_PIXEL_ID.test(tiktok)) errors.tiktok_pixel_id = '10 to 30 letters and digits, e.g. C4ABCDEFGHIJ1234KLMN.'
  if (d.meta_test_event_code.trim().length > TEST_EVENT_CODE_MAX) errors.meta_test_event_code = `Up to ${TEST_EVENT_CODE_MAX} characters.`
  if (d.head_code.length > CODE_MAX) errors.head_code = `Up to ${CODE_MAX.toLocaleString('en')} characters.`
  if (d.body_code.length > CODE_MAX) errors.body_code = `Up to ${CODE_MAX.toLocaleString('en')} characters.`
  if (d.meta_capi_enabled && (pixel === '' || (!s.meta_capi_token_set && token.trim() === ''))) {
    errors.meta_capi_enabled = 'Add the pixel ID and an access token to use the Conversions API.'
  }
  return errors
}

/** Server field errors onto the form's keys; anything else under `form`. */
export function trackingServerErrors(map: Record<string, string>): TrackingErrors {
  const errors: TrackingErrors = {}
  for (const [key, message] of Object.entries(map)) {
    const root = key.split('.')[0] as TrackingErrorKey
    if (TRACKING_ERROR_KEYS.includes(root)) errors[root] ??= message
    else errors.form ??= message
  }
  return errors
}
