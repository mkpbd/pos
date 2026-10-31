import { z } from 'zod'
import { decimalPattern, MONEY_PATTERN } from '@/lib/money'
import type { Product, ProductInput } from '@/features/products/api'

const money = z.string().trim().regex(MONEY_PATTERN, 'Amount with up to 2 decimals.')
const optionalMoney = z.union([money, z.literal('')])

const variantSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().max(64).regex(/^[A-Za-z0-9\-_./]*$/, 'Letters, digits and - _ . / only.'),
  name: z.string().trim().max(255),
  option_values: z.record(z.string(), z.string()),
  purchase_price: money,
  selling_price: money,
  wholesale_price: optionalMoney,
  reorder_level: z.union([z.string().trim().regex(decimalPattern(3), 'Up to 3 decimals.'), z.literal('')]),
  /** Barcodes separated by commas, spaces or new lines. */
  barcodes: z.string(),
  is_active: z.boolean(),
})

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Required.').max(255),
    description: z.string().max(5000),
    type: z.enum(['standard', 'service']),
    category_id: z.string().nullable(),
    brand_id: z.string().nullable(),
    unit_id: z.string({ error: 'Choose a unit.' }).min(1, 'Choose a unit.'),
    tax_rate_id: z.string().nullable(),
    track_stock: z.boolean(),
    track_batches: z.boolean(),
    track_serials: z.boolean(),
    max_discount_percent: z.union([z.string().trim().regex(decimalPattern(2), 'A percentage.').refine((v) => Number(v) <= 100, 'At most 100.'), z.literal('')]),
    is_active: z.boolean(),
    has_variants: z.boolean(),
    /** Option values separated by commas. */
    options: z.array(z.object({ name: z.string().trim().min(1, 'Name the option.').max(50), values: z.string().trim().min(1, 'List at least one value.') })).max(3),
    variants: z.array(variantSchema).min(1, 'Add at least one variant.'),
  })
  .superRefine((form, ctx) => {
    if (form.has_variants && form.options.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one option, e.g. Size.' })
    }
    if ((form.track_batches || form.track_serials) && !form.track_stock && form.type === 'standard') {
      ctx.addIssue({ code: 'custom', path: ['track_stock'], message: 'Batch or serial tracking requires stock tracking.' })
    }
  })

export type ProductFormValues = z.infer<typeof productFormSchema>
export type VariantFormValues = ProductFormValues['variants'][number]

export function splitList(value: string, separators = /[,\n]+/): string[] {
  return [...new Set(value.split(separators).map((v) => v.trim()).filter(Boolean))]
}

export function emptyVariant(optionValues: Record<string, string> = {}): VariantFormValues {
  return { sku: '', name: '', option_values: optionValues, purchase_price: '', selling_price: '', wholesale_price: '', reorder_level: '', barcodes: '', is_active: true }
}

export function toFormValues(product?: Product): ProductFormValues {
  if (!product) {
    return {
      name: '', description: '', type: 'standard', category_id: null, brand_id: null, unit_id: '', tax_rate_id: null,
      track_stock: true, track_batches: false, track_serials: false, max_discount_percent: '', is_active: true,
      has_variants: false, options: [], variants: [emptyVariant()],
    }
  }

  return {
    name: product.name,
    description: product.description ?? '',
    type: product.type,
    category_id: product.category?.id ?? null,
    brand_id: product.brand?.id ?? null,
    unit_id: product.unit?.id ?? '',
    tax_rate_id: product.tax_rate?.id ?? null,
    track_stock: product.track_stock,
    track_batches: product.track_batches,
    track_serials: product.track_serials,
    max_discount_percent: product.max_discount_percent ?? '',
    is_active: product.is_active,
    has_variants: !!product.options?.length,
    options: (product.options ?? []).map((o) => ({ name: o.name, values: o.values.join(', ') })),
    variants: product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name ?? '',
      option_values: { ...v.option_values },
      purchase_price: v.purchase_price ?? '',
      selling_price: v.selling_price,
      wholesale_price: v.wholesale_price ?? '',
      reorder_level: v.reorder_level.replace(/\.?0+$/, '') || '0',
      barcodes: v.barcodes.join(', '),
      is_active: v.is_active,
    })),
  }
}

function comboKey(values: Record<string, string>): string {
  return JSON.stringify(Object.keys(values).sort().map((k) => [k.toLowerCase(), (values[k] ?? '').toLowerCase()]))
}

/**
 * Cartesian product of the option values. Rows that already exist for a combination are kept
 * (with their id, SKU, prices and barcodes); new combinations copy prices from the first row.
 */
export function generateVariants(options: ProductFormValues['options'], existing: VariantFormValues[]): VariantFormValues[] {
  const parsed = options.map((o) => ({ name: o.name.trim(), values: splitList(o.values) })).filter((o) => o.name && o.values.length)
  if (parsed.length === 0) return existing.length ? existing.slice(0, 1).map((v) => ({ ...v, option_values: {} })) : [emptyVariant()]

  let combos: Record<string, string>[] = [{}]
  for (const option of parsed) {
    combos = combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value })))
  }

  const byCombo = new Map(existing.map((v) => [comboKey(v.option_values), v]))
  const template = existing[0]

  return combos.map((combo) => {
    const match = byCombo.get(comboKey(combo))
    if (match) return { ...match, option_values: combo }
    return {
      ...emptyVariant(combo),
      purchase_price: template?.purchase_price ?? '',
      selling_price: template?.selling_price ?? '',
      wholesale_price: template?.wholesale_price ?? '',
      reorder_level: template?.reorder_level ?? '',
    }
  })
}

export function toProductInput(form: ProductFormValues): ProductInput {
  const options = form.has_variants ? form.options.map((o) => ({ name: o.name.trim(), values: splitList(o.values) })) : null
  const variants = form.has_variants ? form.variants : form.variants.slice(0, 1)

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    type: form.type,
    category_id: form.category_id,
    brand_id: form.brand_id,
    unit_id: form.unit_id,
    tax_rate_id: form.tax_rate_id,
    track_stock: form.type === 'standard' && form.track_stock,
    track_batches: form.type === 'standard' && form.track_batches,
    track_serials: form.type === 'standard' && form.track_serials,
    max_discount_percent: form.max_discount_percent || null,
    is_active: form.is_active,
    options,
    variants: variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku.trim() || null,
      name: v.name.trim() || null,
      option_values: options ? v.option_values : {},
      purchase_price: v.purchase_price,
      selling_price: v.selling_price,
      wholesale_price: v.wholesale_price || null,
      reorder_level: v.reorder_level || '0',
      barcodes: splitList(v.barcodes, /[\s,]+/),
      is_active: v.is_active,
    })),
  }
}
