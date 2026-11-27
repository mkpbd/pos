import type { VariantOption } from '@/components/common/variant-options'

export type LineValue = {
  variant: VariantOption | null
  quantity: string
  unit_cost: string
  tax_rate: string
  batch_number: string
  expires_on: string
  batch_id: string | null
  /** Set when the line comes from another document (purchase order line, receipt line). */
  source_line_id?: string
  /** Upper bound shown to the user (e.g. open quantity on the order). */
  max_quantity?: string
  /** ST2a purchase lines: line discount % and free (bonus) units received on top of the quantity. */
  discount_percent?: string
  bonus_quantity?: string
  /**
   * ST2c front-end helper (never sent): the chosen pack's barcode ('' = single units), the number
   * of packs and the cost of one pack; they fill `quantity` and `unit_cost`.
   */
  pack?: string
  pack_count?: string
  pack_cost?: string
}

export type LinesForm = { lines: LineValue[] }

export const emptyLine = (): LineValue => ({ variant: null, quantity: '', unit_cost: '', tax_rate: '', batch_number: '', expires_on: '', batch_id: null, discount_percent: '', bonus_quantity: '' })

const DECIMAL = /^\d{1,15}(\.\d{1,4})?$/

function scaled(value: string): { n: bigint; scale: number } {
  const [i = '0', f = ''] = value.trim().split('.')
  return { n: BigInt((i || '0') + f), scale: f.length }
}

function format(n: bigint, scale: number): string {
  const digits = n.toString().padStart(scale + 1, '0')
  const body = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits
  return body.includes('.') ? body.replace(/0+$/, '').replace(/\.$/, '') : body
}

/** ST2c: packs × units per pack, exactly ("2" × "24.000" → "48"); null when either is not a number. */
export function packQuantity(packs: string, units: string): string | null {
  if (!DECIMAL.test(packs.trim()) || !DECIMAL.test(units.trim())) return null
  const a = scaled(packs)
  const b = scaled(units)
  return format(a.n * b.n, a.scale + b.scale)
}

/** ST2c: pack cost ÷ units per pack, rounded half up to 4 decimals ("100" ÷ "3" → "33.3333"); null when invalid. */
export function packUnitCost(cost: string, units: string): string | null {
  if (!DECIMAL.test(cost.trim()) || !DECIMAL.test(units.trim())) return null
  const c = scaled(cost)
  const u = scaled(units)
  if (u.n === 0n) return null
  // cost / units × 10⁴ = c.n × 10^u.scale × 10⁴ / (u.n × 10^c.scale)
  const num = c.n * 10n ** BigInt(u.scale + 4)
  const den = u.n * 10n ** BigInt(c.scale)
  return format((2n * num + den) / (2n * den), 4)
}
