import type { Promotion, PromotionInput, PromotionScope, PromotionState, PromotionTarget, PromotionTrigger, PromotionType } from '@/features/promotions/api'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { ApiError } from '@/lib/api/client'
import { compareDecimal, formatMoney, isZeroDecimal, MONEY_PATTERN, trimDecimal } from '@/lib/money'

type BadgeVariant = 'success' | 'info' | 'warning' | 'outline'

export const STATE_BADGES: Record<PromotionState, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  expired: { label: 'Expired', variant: 'warning' },
  inactive: { label: 'Inactive', variant: 'outline' },
}

/** Unknown states from a newer server still render, just unstyled. */
export function stateBadge(state: string): { label: string; variant: BadgeVariant } {
  return STATE_BADGES[state as PromotionState] ?? { label: state, variant: 'outline' }
}

export const TYPE_LABELS: Record<PromotionType, string> = {
  percent: 'Percentage off',
  fixed: 'Fixed amount off',
  free_shipping: 'Free shipping',
}

export const SCOPE_LABELS: Record<PromotionScope, string> = {
  order: 'Whole order',
  products: 'Selected products',
  categories: 'Selected categories',
  brands: 'Selected brands',
}

export const TRIGGER_LABELS: Record<PromotionTrigger, string> = {
  automatic: 'Automatic',
  coupon: 'Coupon code',
}

/** The rule shoppers' prices follow (mirrors the server's PromotionEngine). */
export const APPLICATION_RULE =
  'Shoppers get the single best product offer per item, plus the best order offer. Offers do not stack on the same item; free shipping applies on top when its conditions are met.'

/** "10% off", "BDT 50.00 off" or "Free shipping". */
export function offerLabel(type: PromotionType, value: string | null, currency?: string): string {
  if (type === 'free_shipping') return 'Free shipping'
  if (type === 'percent') return `${trimDecimal(value ?? '0')}% off`
  return `${formatMoney(value ?? '0', currency)} off`
}

/** Product-level scopes: a discount per matching item. */
export const isProductScope = (scope: PromotionScope) => scope !== 'order'

// ── Coupon codes ─────────────────────────────────────────────────────────────

export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{3,40}$/
export const COUPON_PREFIX_PATTERN = /^[A-Z0-9-]{1,20}$/
export const MAX_GENERATE = 500

export const normalizeCode = (value: string) => value.trim().toUpperCase()

export function couponCodeError(code: string): string | null {
  if (!code) return 'Enter a code.'
  if (!COUPON_CODE_PATTERN.test(code)) return '3–40 characters: letters A–Z, digits and hyphens.'
  return null
}

export function generateError(count: string, prefix: string): Record<string, string> {
  const errors: Record<string, string> = {}
  const n = Number(count)
  if (!/^\d+$/.test(count.trim()) || n < 1 || n > MAX_GENERATE) errors.generate = `Between 1 and ${MAX_GENERATE}.`
  if (prefix && !COUPON_PREFIX_PATTERN.test(prefix)) errors.prefix = 'Up to 20 characters: letters A–Z, digits and hyphens.'
  return errors
}

// ── Editor draft ─────────────────────────────────────────────────────────────

export type PromotionDraft = {
  name: string
  description: string
  type: PromotionType
  value: string
  scope: PromotionScope
  targets: PromotionTarget[]
  minSubtotal: string
  maxDiscount: string
  trigger: PromotionTrigger
  startsAt: string
  endsAt: string
  showCountdown: boolean
  isActive: boolean
  usageLimit: string
  usageLimitPerCustomer: string
}

export function toDraft(p: Promotion | undefined, timeZone: string | undefined): PromotionDraft {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    type: p?.type ?? 'percent',
    value: p && p.type !== 'free_shipping' ? trimDecimal(p.value ?? '') : '',
    scope: p?.scope ?? 'order',
    targets: p?.targets ?? [],
    minSubtotal: p?.min_subtotal ?? '',
    maxDiscount: p?.max_discount ?? '',
    trigger: p?.trigger ?? 'automatic',
    startsAt: toZonedInput(p?.starts_at, timeZone),
    endsAt: toZonedInput(p?.ends_at, timeZone),
    showCountdown: p?.show_countdown ?? false,
    isActive: p?.is_active ?? true,
    usageLimit: p?.usage_limit == null ? '' : String(p.usage_limit),
    usageLimitPerCustomer: p?.usage_limit_per_customer == null ? '' : String(p.usage_limit_per_customer),
  }
}

/** A flash-sale countdown needs an automatic product offer with an end. */
export function countdownAllowed(d: Pick<PromotionDraft, 'type' | 'scope' | 'trigger' | 'endsAt'>): boolean {
  return d.trigger === 'automatic' && d.type !== 'free_shipping' && isProductScope(d.scope) && d.endsAt !== ''
}

const LIMIT = /^\d{1,9}$/

/** Client checks before saving, keyed like the API's validation errors. */
export function validateDraft(d: PromotionDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  const name = d.name.trim()
  if (!name) errors.name = 'Enter a name.'
  else if (name.length > 80) errors.name = 'At most 80 characters.'
  if (d.description.trim().length > 200) errors.description = 'At most 200 characters.'

  if (d.type !== 'free_shipping') {
    const value = d.value.trim()
    if (!MONEY_PATTERN.test(value) || isZeroDecimal(value)) errors.value = d.type === 'percent' ? 'Enter a percentage from 0.01 to 100.' : 'Enter an amount above zero.'
    else if (d.type === 'percent' && compareDecimal(value, '100') > 0) errors.value = 'At most 100%.'
  }
  if (d.type === 'free_shipping' && d.scope !== 'order') errors.scope = 'Free shipping applies to the whole order.'
  if (isProductScope(d.scope) && d.targets.length === 0) errors.target_ids = `Choose at least one ${d.scope === 'products' ? 'product' : d.scope === 'categories' ? 'category' : 'brand'}.`

  if (d.minSubtotal.trim() && !MONEY_PATTERN.test(d.minSubtotal.trim())) errors.min_subtotal = 'Enter an amount, e.g. 500.'
  if (d.type === 'percent' && d.maxDiscount.trim() && (!MONEY_PATTERN.test(d.maxDiscount.trim()) || isZeroDecimal(d.maxDiscount))) errors.max_discount = 'Enter an amount above zero.'

  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) errors.ends_at = 'The end must be after the start.'
  if (d.showCountdown && !countdownAllowed(d)) errors.show_countdown = 'A countdown needs an automatic product offer with an end date.'

  for (const [key, value] of [['usage_limit', d.usageLimit], ['usage_limit_per_customer', d.usageLimitPerCustomer]] as const) {
    if (value.trim() && (!LIMIT.test(value.trim()) || Number(value) < 1)) errors[key] = 'A whole number of at least 1, or empty for no limit.'
  }
  return errors
}

const orNull = (value: string) => value.trim() || null
const intOrNull = (value: string) => (value.trim() ? Number(value.trim()) : null)

/** The request body; fields that do not apply are sent empty. */
export function toInput(d: PromotionDraft, timeZone: string | undefined): PromotionInput {
  const scope = d.type === 'free_shipping' ? 'order' : d.scope
  return {
    name: d.name.trim(),
    description: orNull(d.description),
    type: d.type,
    value: d.type === 'free_shipping' ? null : d.value.trim(),
    scope,
    target_ids: isProductScope(scope) ? d.targets.map((t) => t.id) : [],
    min_subtotal: orNull(d.minSubtotal),
    max_discount: d.type === 'percent' ? orNull(d.maxDiscount) : null,
    trigger: d.trigger,
    starts_at: fromZonedInput(d.startsAt, timeZone),
    ends_at: fromZonedInput(d.endsAt, timeZone),
    show_countdown: d.showCountdown && countdownAllowed({ ...d, scope }),
    is_active: d.isActive,
    usage_limit: intOrNull(d.usageLimit),
    usage_limit_per_customer: intOrNull(d.usageLimitPerCustomer),
  }
}

const FIELD_CODES = new Set(['VALIDATION_FAILED', 'PROMOTION_INVALID'])

/**
 * Field errors of a refused save as `{field: message}`; dotted keys ("target_ids.0") collapse
 * to their field. Anything else lands under `form`.
 */
export function promotionErrorMap(error: unknown): Record<string, string> {
  if (error instanceof ApiError && FIELD_CODES.has(error.code)) {
    const map: Record<string, string> = {}
    for (const [key, messages] of Object.entries(error.details)) {
      const message = Array.isArray(messages) ? messages[0] : messages
      const root = key.split('.')[0] as string
      if (typeof message === 'string' && !(root in map)) map[root] = message
    }
    if (Object.keys(map).length > 0) return map
  }
  return { form: error instanceof Error ? error.message : 'Something went wrong.' }
}

export const isInUse = (error: unknown) => error instanceof ApiError && error.code === 'IN_USE'
