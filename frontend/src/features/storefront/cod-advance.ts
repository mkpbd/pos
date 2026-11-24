import type { CodAdvanceAmount, CodReviewMode, StorefrontSettings } from '@/features/storefront/api'
import { compareDecimal, MONEY_PATTERN } from '@/lib/money'

/** BD1c: the advance delivery charge settings form (pure helpers). */

export type CodAdvanceDraft = { mode: CodReviewMode; amount: CodAdvanceAmount; fixed: string; hours: string }
export type CodAdvanceErrors = Partial<Record<'fixed' | 'hours' | 'form', string>>

export const toCodAdvanceDraft = (s: StorefrontSettings): CodAdvanceDraft => ({
  mode: s.cod_advance ?? 'off',
  amount: s.cod_advance_amount ?? 'delivery',
  fixed: s.cod_advance_fixed ?? '',
  hours: String(s.cod_advance_hold_hours ?? 24),
})

export function validateCodAdvance(d: CodAdvanceDraft): CodAdvanceErrors {
  const errors: CodAdvanceErrors = {}
  if (d.mode !== 'off' && d.amount === 'fixed') {
    const v = d.fixed.trim()
    if (!MONEY_PATTERN.test(v) || compareDecimal(v, '0') <= 0) errors.fixed = 'An amount above 0 with at most 2 decimals.'
  }
  const h = d.hours.trim()
  if (!/^\d{1,3}$/.test(h) || Number(h) < 1 || Number(h) > 168) errors.hours = 'Whole hours between 1 and 168.'
  return errors
}

/**
 * The changed settings only; the fixed amount is cleared when the delivery charge is used. Turning the
 * advance off keeps the saved amount choice (its fields are hidden then).
 */
export function codAdvanceChanges(d: CodAdvanceDraft, s: StorefrontSettings) {
  const input: { cod_advance?: CodReviewMode; cod_advance_amount?: CodAdvanceAmount; cod_advance_fixed?: string | null; cod_advance_hold_hours?: number } = {}
  const before = toCodAdvanceDraft(s)
  if (d.mode !== before.mode) input.cod_advance = d.mode
  if (d.hours.trim() !== before.hours) input.cod_advance_hold_hours = Number(d.hours.trim())
  if (d.mode === 'off') return input
  if (d.amount !== before.amount) input.cod_advance_amount = d.amount
  const fixed = d.amount === 'fixed' ? d.fixed.trim() || null : null
  if (fixed !== (s.cod_advance_fixed ?? null)) input.cod_advance_fixed = fixed
  return input
}
