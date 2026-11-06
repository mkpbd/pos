/**
 * Landed cost allocation preview (SC3), exact and identical to the server's rule:
 *
 * - each charge is spread over the receipt lines on its own, by line subtotal value
 *   (quantity × unit cost, rounded half away from zero to 2 decimals) or by quantity; a value
 *   charge over lines that are all worth 0 falls back to quantity;
 * - the split is Money::allocate's largest-remainder method: every line gets the floor of
 *   its exact share in cents, and the leftover cents go to the largest fractional remainders
 *   (remainders compared at 12 decimals, ties to the earlier line) — so it sums exactly;
 * - a line's landed cost is the sum of its shares; stock enters at
 *   unit cost + landed cost ÷ quantity, rounded half away from zero to 4 decimals.
 *   (LandedCostAllocator on the server.)
 *
 * Decimal strings are scaled to bigints — never binary floats. The server recomputes all of it.
 */

export type ChargeType = 'freight' | 'duty' | 'insurance' | 'handling' | 'other'
export type ChargeAllocation = 'value' | 'quantity'

export const CHARGE_TYPES: Record<ChargeType, string> = {
  freight: 'Freight',
  duty: 'Duty',
  insurance: 'Insurance',
  handling: 'Handling',
  other: 'Other',
}

export const ALLOCATION_LABELS: Record<ChargeAllocation, string> = {
  value: 'By value',
  quantity: 'By quantity',
}

export const chargeTypeLabel = (type: string): string => CHARGE_TYPES[type as ChargeType] ?? type
export const allocationLabel = (allocation: string): string => ALLOCATION_LABELS[allocation as ChargeAllocation] ?? allocation

const DECIMAL = /^\d{1,16}(\.\d+)?$/
const RATIO_SCALE = 6
const REMAINDER_DIGITS = 10n ** 12n

/** Non-negative decimal string → integer at `scale` (extra digits truncated), or null when invalid. */
function toScaled(value: string | null | undefined, scale: number): bigint | null {
  const v = (value ?? '').trim()
  if (!DECIMAL.test(v)) return null
  const [integer = '0', fraction = ''] = v.split('.')
  return BigInt((integer || '0') + (fraction + '0'.repeat(scale)).slice(0, scale))
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0')
  const body = scale > 0 ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  return negative ? `-${body}` : body
}

/** a ÷ b rounded half away from zero (both non-negative, b > 0). */
function divideRounded(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b)
}

/** quantity × unit cost rounded half away from zero to 2 decimals ("0.00" when either is invalid). */
export function lineSubtotal(quantity: string, unitCost: string): string {
  const q = toScaled(quantity, 3)
  const c = toScaled(unitCost, 4)
  if (q === null || c === null) return '0.00'
  // q × c is at scale 7; down to cents (scale 2).
  return fromScaled(divideRounded(q * c, 10n ** 5n), 2)
}

/**
 * Split a 2-decimal amount over non-negative ratios with the largest-remainder method.
 * Returns null when the amount or a ratio is invalid, or every ratio is zero.
 */
export function allocateAmount(amount: string, ratios: string[]): string[] | null {
  const cents = toScaled(amount, 2)
  if (cents === null || ratios.length === 0) return null
  const scaled = ratios.map((r) => toScaled(r, RATIO_SCALE))
  if (scaled.some((r) => r === null)) return null
  const parts = scaled as bigint[]
  const total = parts.reduce((sum, r) => sum + r, 0n)
  if (total === 0n) return null

  const shares = parts.map((r) => (cents * r) / total)
  const remainders = parts.map((r) => (((cents * r) % total) * REMAINDER_DIGITS) / total)
  let leftover = cents - shares.reduce((sum, s) => sum + s, 0n)

  const order = parts.map((_, i) => i).sort((a, b) => {
    const ra = remainders[a] as bigint
    const rb = remainders[b] as bigint
    return ra === rb ? a - b : rb > ra ? 1 : -1
  })
  for (const i of order) {
    if (leftover <= 0n) break
    shares[i] = (shares[i] as bigint) + 1n
    leftover -= 1n
  }

  return shares.map((s) => fromScaled(s, 2))
}

/**
 * unit cost + landed cost ÷ quantity at 4 decimals, rounded like the server: the quotient is
 * taken at 16 places (truncated), rounded half away from zero to 10, added, then rounded to 4.
 */
export function landedUnitCost(unitCost: string, landedCost: string, quantity: string): string | null {
  const c = toScaled(unitCost, 4)
  const l = toScaled(landedCost, 2)
  const q = toScaled(quantity, 3)
  if (c === null || l === null || q === null || q === 0n) return null
  // (l / 10^2) ÷ (q / 10^3) at scale 16 = l × 10^17 ÷ q (truncated).
  const at16 = (l * 10n ** 17n) / q
  const at10 = (at16 + 5n * 10n ** 5n) / 10n ** 6n
  const sum10 = c * 10n ** 6n + at10
  return fromScaled((sum10 + 5n * 10n ** 5n) / 10n ** 6n, 4)
}

/** Exact sum of 2-decimal amounts; invalid entries count as zero. */
export function sumMoney(values: (string | null | undefined)[]): string {
  return fromScaled(values.reduce<bigint>((sum, v) => sum + (toScaled(v, 2) ?? 0n), 0n), 2)
}

export type PreviewLine = { quantity: string; unit_cost: string }
export type PreviewCharge = { amount: string; allocation: ChargeAllocation }

export type LandedLinePreview = {
  subtotal: string
  landed_cost: string
  /** null while the line has no usable quantity. */
  landed_unit_cost: string | null
}

export type LandedCostPreview = {
  lines: LandedLinePreview[]
  goods_total: string
  charges_total: string
  landed_total: string
  /** Why some charges could not be spread (the rest still are), or null. */
  problem: string | null
}

const POSITIVE_MONEY = /^\d{1,16}(\.\d{1,2})?$/

/**
 * Live preview of a receipt's charges over its lines. Lines with an invalid quantity or cost
 * weigh zero; charges with an invalid amount are skipped (the form flags them).
 */
export function previewLandedCosts(lines: PreviewLine[], charges: PreviewCharge[]): LandedCostPreview {
  const subtotals = lines.map((l) => lineSubtotal(l.quantity, l.unit_cost))
  const quantities = lines.map((l) => (toScaled(l.quantity, 3) === null ? '0' : l.quantity.trim()))
  const landed = lines.map(() => 0n)
  let problem: string | null = null
  const valid = charges.filter((c) => POSITIVE_MONEY.test(c.amount.trim()) && (toScaled(c.amount, 2) ?? 0n) > 0n)

  const anyValue = subtotals.some((v) => v !== '0.00')
  for (const charge of valid) {
    // Like the server: a value charge over lines that are all worth 0 is spread by quantity.
    const byQuantity = charge.allocation === 'quantity' || !anyValue
    const parts = lines.length === 0 ? null : allocateAmount(charge.amount.trim(), byQuantity ? quantities : subtotals)
    if (!parts) {
      problem = lines.length === 0 ? 'Add goods lines to spread the charges over.' : 'Lines have no quantity yet.'
      continue
    }
    parts.forEach((p, i) => (landed[i] = (landed[i] as bigint) + (toScaled(p, 2) as bigint)))
  }

  const goods = sumMoney(subtotals)
  const chargesTotal = sumMoney(valid.map((c) => c.amount))
  return {
    lines: lines.map((l, i) => {
      const cost = fromScaled(landed[i] as bigint, 2)
      return { subtotal: subtotals[i] as string, landed_cost: cost, landed_unit_cost: landedUnitCost(l.unit_cost, cost, l.quantity) }
    }),
    goods_total: goods,
    charges_total: chargesTotal,
    landed_total: sumMoney([goods, chargesTotal]),
    problem,
  }
}
