import { z } from 'zod'
import type { LineValue } from '@/components/common/line-values'
import { compareDecimal, decimalPattern } from '@/lib/money'

const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/
const SIGNED_QUANTITY = /^-?\d{1,15}(\.\d{1,3})?$/
const COST = decimalPattern(4)

type Options = {
  signed?: boolean
  cost?: 'required' | 'optional'
  tax?: boolean
  batch?: 'in' | 'out' | 'signed'
  /** Stock count (Q1 §1): the quantity is what was counted (0 or more); batch-tracked lines name the counted batch. */
  count?: boolean
  /** ST2a purchase lines: discount % (0 to under 100) and free quantity. */
  discount?: boolean
}

const DISCOUNT = /^\d{1,2}(\.\d{1,4})?$/

const variantShape = z.object({
  id: z.string(),
  label: z.string(),
  sku: z.string(),
  unit_code: z.string().nullable(),
  allow_decimal: z.boolean(),
  track_stock: z.boolean(),
  track_batches: z.boolean(),
  purchase_price: z.string().optional(),
  tax_rate: z.string().nullable(),
})

/**
 * Client-side checks mirroring the server's line rules, for instant feedback.
 * The server validates everything again.
 */
export function linesSchema(options: Options) {
  return z
    .array(
      z.object({
        variant: variantShape.nullable(),
        quantity: z.string(),
        unit_cost: z.string(),
        tax_rate: z.string(),
        batch_number: z.string(),
        expires_on: z.string(),
        batch_id: z.string().nullable(),
        source_line_id: z.string().optional(),
        max_quantity: z.string().optional(),
        discount_percent: z.string().optional(),
        bonus_quantity: z.string().optional(),
      }),
    )
    .min(1, 'Add at least one line.')
    .superRefine((lines, ctx) => {
      lines.forEach((line, i) => {
        const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [i, path], message })
        const quantity = line.quantity.trim()
        const negative = quantity.startsWith('-')

        if (!line.variant) issue('variant', 'Choose a product.')
        if (options.count) {
          if (!QUANTITY.test(quantity)) issue('quantity', 'The counted quantity: 0 or more (up to 3 decimals).')
          else if (line.variant && !line.variant.allow_decimal && quantity.includes('.') && !/\.0+$/.test(quantity)) issue('quantity', `Whole ${line.variant.unit_code ?? 'units'} only.`)
          const cost = line.unit_cost.trim()
          if (options.cost && cost !== '' && !COST.test(cost)) issue('unit_cost', 'Cost with up to 4 decimals.')
          if (line.variant?.track_batches && !line.batch_id) issue('batch_id', 'Choose the batch you counted.')
          return
        }
        if (!(options.signed ? SIGNED_QUANTITY : QUANTITY).test(quantity)) {
          issue('quantity', options.signed ? 'A quantity like 5 or -2 (up to 3 decimals).' : 'A positive quantity (up to 3 decimals).')
        } else if (/^-?0+(\.0+)?$/.test(quantity)) {
          issue('quantity', 'Must not be zero.')
        } else if (line.variant && !line.variant.allow_decimal && quantity.includes('.') && !/\.0+$/.test(quantity)) {
          issue('quantity', `Whole ${line.variant.unit_code ?? 'units'} only.`)
        } else if (line.max_quantity && compareDecimal(quantity, line.max_quantity) > 0) {
          issue('quantity', `At most ${line.max_quantity}.`)
        }

        const cost = line.unit_cost.trim()
        if (options.cost === 'required' && !negative && !COST.test(cost)) issue('unit_cost', 'Cost with up to 4 decimals.')
        if (options.cost === 'optional' && cost !== '' && !COST.test(cost)) issue('unit_cost', 'Cost with up to 4 decimals.')
        if (options.tax && line.tax_rate.trim() !== '' && !decimalPattern(4).test(line.tax_rate.trim())) issue('tax_rate', 'A percentage.')

        if (options.discount) {
          const discount = (line.discount_percent ?? '').trim()
          const bonus = (line.bonus_quantity ?? '').trim()
          if (discount !== '' && !DISCOUNT.test(discount)) issue('discount_percent', 'From 0 to 99.9999 %.')
          if (bonus !== '' && !QUANTITY.test(bonus)) issue('bonus_quantity', 'A quantity (up to 3 decimals).')
          else if (line.variant && !line.variant.allow_decimal && bonus.includes('.') && !/\.0+$/.test(bonus)) issue('bonus_quantity', `Whole ${line.variant.unit_code ?? 'units'} only.`)
        }

        if (line.variant?.track_batches && options.batch) {
          const mode = options.batch === 'signed' ? (negative ? 'out' : 'in') : options.batch
          if (mode === 'in' && line.batch_number.trim() === '') issue('batch_number', 'Batch number required.')
          if (mode === 'out' && !line.batch_id) issue('batch_id', 'Choose a batch.')
        }
      })
    })
}

/** API line payload (only the fields the endpoint understands). */
export function toApiLine(line: LineValue, options: Options & { sourceField?: string }) {
  const quantity = line.quantity.trim()
  const negative = quantity.startsWith('-')
  const mode = options.batch === 'signed' ? (negative ? 'out' : 'in') : options.batch
  const tracksBatches = !!line.variant?.track_batches

  return {
    variant_id: line.variant?.id ?? '',
    quantity,
    ...(options.cost && !negative ? { unit_cost: line.unit_cost.trim() || null } : {}),
    ...(options.tax ? { tax_rate: line.tax_rate.trim() || null } : {}),
    ...(options.discount ? { discount_percent: line.discount_percent?.trim() || '0', bonus_quantity: line.bonus_quantity?.trim() || '0' } : {}),
    ...(tracksBatches && mode === 'in' ? { batch_number: line.batch_number.trim(), expires_on: line.expires_on || null } : {}),
    ...(tracksBatches && mode === 'out' ? { batch_id: line.batch_id } : {}),
    ...(options.sourceField && line.source_line_id ? { [options.sourceField]: line.source_line_id } : {}),
  }
}

/** Stock count line (Q1 §1): the counted quantity; the server works out the change (counted − in stock) under a row lock. */
export function toCountApiLine(line: LineValue, options: Pick<Options, 'cost'>) {
  return {
    variant_id: line.variant?.id ?? '',
    counted_quantity: line.quantity.trim(),
    ...(options.cost ? { unit_cost: line.unit_cost.trim() || null } : {}),
    ...(line.variant?.track_batches ? { batch_id: line.batch_id } : {}),
  }
}
