/**
 * Exact quantity helpers for reorder quantities and catalog pack sizes (decimal strings with
 * up to 3 places, scaled to integers — never binary floats). Amounts shown from them are
 * estimates; the server recomputes every document total.
 */

const QTY_SCALE = 3
const COST_SCALE = 4

export const QUANTITY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/

function toScaled(value: string, scale: number): bigint {
  const [integer = '0', fraction = ''] = value.trim().split('.')
  return BigInt((integer || '0') + (fraction + '0'.repeat(scale)).slice(0, scale))
}

function fromScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0')
  const body = scale > 0 ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  return body.includes('.') ? body.replace(/0+$/, '').replace(/\.$/, '') : body
}

/** A positive quantity with up to 3 decimals ("0" is not). */
export function isPositiveQuantity(value: string): boolean {
  const v = value.trim()
  return QUANTITY_PATTERN.test(v) && toScaled(v, QTY_SCALE) > 0n
}

export function isWholeQuantity(value: string): boolean {
  return QUANTITY_PATTERN.test(value.trim()) && toScaled(value, QTY_SCALE) % 10n ** BigInt(QTY_SCALE) === 0n
}

/** Normalised display form: "24.000" → "24", "1.500" → "1.5". */
export function normalizeQuantity(value: string | null | undefined): string {
  if (!value || !QUANTITY_PATTERN.test(value.trim())) return value?.trim() ?? ''
  return fromScaled(toScaled(value, QTY_SCALE), QTY_SCALE)
}

function hasPack(pack: string | null | undefined): pack is string {
  return !!pack && QUANTITY_PATTERN.test(pack.trim()) && toScaled(pack, QTY_SCALE) > 0n
}

/** True when the quantity is a whole number of packs (or there is no pack size). */
export function isWholePacks(quantity: string, pack: string | null | undefined): boolean {
  if (!hasPack(pack) || !QUANTITY_PATTERN.test(quantity.trim())) return true
  return toScaled(quantity, QTY_SCALE) % toScaled(pack, QTY_SCALE) === 0n
}

/** Number of packs in a whole-pack quantity ("72" in packs of "24" → "3"). */
export function packCount(quantity: string, pack: string): string {
  return (toScaled(quantity, QTY_SCALE) / toScaled(pack, QTY_SCALE)).toString()
}

/** The quantity raised to the minimum order and rounded up to whole packs. */
export function roundToCatalog(quantity: string, pack: string | null | undefined, min: string | null | undefined): string {
  if (!QUANTITY_PATTERN.test(quantity.trim())) return quantity
  let q = toScaled(quantity, QTY_SCALE)
  if (min && QUANTITY_PATTERN.test(min.trim())) {
    const m = toScaled(min, QTY_SCALE)
    if (q < m) q = m
  }
  if (hasPack(pack)) {
    const p = toScaled(pack, QTY_SCALE)
    q = ((q + p - 1n) / p) * p
  }
  return fromScaled(q, QTY_SCALE)
}

export function isBelowMinimum(quantity: string, min: string | null | undefined): boolean {
  if (!min || !QUANTITY_PATTERN.test(min.trim()) || !QUANTITY_PATTERN.test(quantity.trim())) return false
  return toScaled(quantity, QTY_SCALE) < toScaled(min, QTY_SCALE)
}

/** Hint for a quantity against the catalog's pack size and minimum order, or null when it fits. */
export function catalogHint(quantity: string, pack: string | null | undefined, min: string | null | undefined): { ok: boolean; text: string; rounded: string | null } | null {
  const packLabel = hasPack(pack) && toScaled(pack, QTY_SCALE) !== 10n ** BigInt(QTY_SCALE) ? normalizeQuantity(pack) : null
  if (!packLabel && !(min && isPositiveQuantity(min))) return null
  if (!isPositiveQuantity(quantity)) {
    const parts = [packLabel && `Packs of ${packLabel}`, min && isPositiveQuantity(min) && `min ${normalizeQuantity(min)}`].filter(Boolean)
    return { ok: true, text: parts.join(' · '), rounded: null }
  }
  const rounded = roundToCatalog(quantity, pack, min)
  if (rounded !== normalizeQuantity(quantity)) {
    const why = isBelowMinimum(quantity, min) ? `Minimum order ${normalizeQuantity(min)}` : `Packs of ${packLabel}`
    return { ok: false, text: `${why} — order ${rounded}`, rounded }
  }
  return { ok: true, text: packLabel ? `${packCount(quantity, pack as string)} × ${packLabel}` : `Min ${normalizeQuantity(min)}`, rounded: null }
}

/** quantity × unit cost, rounded half-up to 2 decimals (an estimate for previews). */
export function lineEstimate(quantity: string, unitCost: string | null | undefined): string {
  if (!unitCost || !QUANTITY_PATTERN.test(quantity.trim()) || !/^\d{1,16}(\.\d{1,4})?$/.test(unitCost.trim())) return '0.00'
  const product = toScaled(quantity, QTY_SCALE) * toScaled(unitCost, COST_SCALE)
  const divisor = 10n ** BigInt(QTY_SCALE + COST_SCALE - 2)
  const cents = (product + divisor / 2n) / divisor
  const digits = cents.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** Exact sum of 2-decimal amounts. */
export function sumAmounts(values: string[]): string {
  const cents = values.reduce((sum, v) => sum + toScaled(v, 2), 0n)
  const digits = cents.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}
