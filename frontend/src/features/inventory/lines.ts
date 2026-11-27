import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import type { LineValue } from '@/components/common/line-values'
import { ApiError } from '@/lib/api/client'
import { handleFormError } from '@/lib/forms'
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
  /** ST2d serial-tracked products: 'in' receives serials, 'out' issues in-stock ones, 'signed' decides by the quantity's sign. */
  serials?: 'in' | 'out' | 'signed'
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
  track_serials: z.boolean().optional(),
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
        serials: z.array(z.string()).optional(),
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

        const needed = serialsNeeded(line, options)
        const count = line.serials?.length ?? 0
        if (needed !== null && count !== needed) issue('serials', `Enter ${needed} serial number${needed === 1 ? '' : 's'} (${count} entered).`)

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
    ...(options.serials && line.variant?.track_serials ? { serials: line.serials ?? [] } : {}),
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

/**
 * ST2d: how many serial numbers a line of a serial-tracked product needs — one per unit moved
 * (received lines count the free units too); null when the line needs none or its quantity is
 * not a whole number yet.
 */
export function serialsNeeded(line: Pick<LineValue, 'quantity' | 'bonus_quantity'> & { variant: { track_serials?: boolean } | null }, options: Pick<Options, 'serials' | 'discount'>): number | null {
  if (!options.serials || !line.variant?.track_serials) return null
  const quantity = line.quantity.trim().replace(/^-/, '')
  const bonus = options.discount ? (line.bonus_quantity ?? '').trim() || '0' : '0'
  if (!/^\d+(\.0+)?$/.test(quantity) || !/^\d+(\.0+)?$/.test(bonus)) return null
  return Math.trunc(Number(quantity)) + Math.trunc(Number(bonus))
}

/** 'in' or 'out' for a line under a serials option ('signed' decides by the quantity's sign). */
export function serialsMode(options: Pick<Options, 'serials'>, quantity: string): 'in' | 'out' | null {
  if (!options.serials) return null
  return options.serials === 'signed' ? (quantity.trim().startsWith('-') ? 'out' : 'in') : options.serials
}

const SERIAL_ERRORS: Record<string, string> = { SERIAL_NOT_IN_STOCK: 'Not in stock at this store', SERIAL_IN_STOCK: 'Already in stock' }

/**
 * ST2d: a SERIAL_NOT_IN_STOCK / SERIAL_IN_STOCK refusal (`details.serials`) as errors on the
 * lines holding those serials (matched case-insensitively), e.g. `lines.0.serials`.
 */
export function serialErrors(error: unknown, lines: { serials?: string[] }[]): { path: `lines.${number}.serials`; message: string }[] {
  if (!(error instanceof ApiError) || !(error.code in SERIAL_ERRORS)) return []
  const refused = Array.isArray(error.details.serials) ? (error.details.serials as unknown[]).map(String) : []
  const lower = new Set(refused.map((s) => s.toLowerCase()))
  return lines.flatMap((line, i) => {
    const hit = (line.serials ?? []).filter((s) => lower.has(s.toLowerCase()))
    return hit.length > 0 ? [{ path: `lines.${i}.serials` as const, message: `${SERIAL_ERRORS[error.code]}: ${hit.join(', ')}` }] : []
  })
}

/** handleFormError for document forms with lines, placing serial refusals at the lines' serials. */
export function handleLinesError<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[], lines: { serials?: string[] }[]): void {
  const found = serialErrors(error, lines)
  if (found.length === 0) {
    handleFormError(error, setError, fields, { nested: true })
    return
  }
  for (const f of found) setError(f.path as Path<T>, { type: 'server', message: f.message })
  toast.error((error as Error).message)
}
