import { z } from 'zod'
import type { ChargeInput } from '@/features/landed-cost/api'
import type { GoodsReceipt } from '@/features/purchasing/api'
import { CHARGE_TYPES, type ChargeAllocation, type ChargeType } from '@/features/landed-cost/allocation'

/** Form values of a charge row (receipt charges and landed cost voucher charges). */
export type ChargeValue = {
  type: ChargeType
  description: string
  amount: string
  tax_amount: string
  allocation: ChargeAllocation
  /** Receipt charges only: who bills it (null = the receipt's own supplier invoice). */
  charge_supplier_id: string | null
}

export type ChargesForm = { charges: ChargeValue[] }

export const DESCRIPTION_MAX = 120

export const emptyCharge = (type: ChargeType = 'freight'): ChargeValue => ({ type, description: '', amount: '', tax_amount: '', allocation: 'value', charge_supplier_id: null })

const MONEY = /^\d{1,16}(\.\d{1,2})?$/
const isZero = (v: string) => /^0*(\.0*)?$/.test(v)

/** Client checks mirroring the server's charge rules; the server validates again. */
export const chargesSchema = z
  .array(
    z.object({
      type: z.enum(Object.keys(CHARGE_TYPES) as [ChargeType, ...ChargeType[]]),
      description: z.string(),
      amount: z.string(),
      tax_amount: z.string(),
      allocation: z.enum(['value', 'quantity']),
      charge_supplier_id: z.string().nullable(),
    }),
  )
  .superRefine((charges, ctx) => {
    charges.forEach((charge, i) => {
      const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [i, path], message })
      const amount = charge.amount.trim()
      const tax = charge.tax_amount.trim()
      if (charge.description.trim().length > DESCRIPTION_MAX) issue('description', `At most ${DESCRIPTION_MAX} characters.`)
      if (!MONEY.test(amount)) issue('amount', 'An amount with up to 2 decimals.')
      else if (isZero(amount)) issue('amount', 'Must be more than zero.')
      if (tax !== '' && !MONEY.test(tax)) issue('tax_amount', 'An amount with up to 2 decimals.')
    })
  })

export function toChargeInput(charge: ChargeValue): ChargeInput {
  return {
    type: charge.type,
    description: charge.description.trim() || null,
    amount: charge.amount.trim(),
    tax_amount: charge.tax_amount.trim() || '0',
    allocation: charge.allocation,
    charge_supplier_id: charge.charge_supplier_id,
  }
}

export function chargeError(errors: unknown, index: number, field: string): string | undefined {
  return (errors as Record<number, Record<string, { message?: string }>> | undefined)?.[index]?.[field]?.message
}

/** True when the receipt carries landed costs worth showing (charges, or vouchers posted later). */
export function hasLandedCosts(receipt: GoodsReceipt): boolean {
  return (receipt.charges ?? []).length > 0 || (receipt.landed_cost_vouchers ?? []).length > 0
}
