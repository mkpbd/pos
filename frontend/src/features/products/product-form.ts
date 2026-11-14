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
    /**
     * New products: the single price row. Existing products edit their variants in the
     * variant grid (P1a), so this is empty and the saved variants are sent unchanged.
     */
    variants: z.array(variantSchema).max(1),
  })
  .superRefine((form, ctx) => {
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
      track_stock: true, track_batches: false, track_serials: false, max_discount_percent: '', is_active: true, variants: [emptyVariant()],
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
    variants: [],
  }
}

/**
 * The POST/PUT /products body. `current` (editing): the product as last loaded — its options and
 * variants are sent unchanged, since the variant grid saves those (PUT /products/{id}/variants).
 */
export function toProductInput(form: ProductFormValues, current?: Product): ProductInput {
  const details = {
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
  }

  if (current) {
    return {
      ...details,
      options: current.options?.length ? current.options : null,
      variants: current.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        option_values: v.option_values,
        purchase_price: v.purchase_price ?? '0',
        selling_price: v.selling_price,
        wholesale_price: v.wholesale_price,
        reorder_level: v.reorder_level,
        barcodes: v.barcodes,
        is_active: v.is_active,
      })),
    }
  }

  return {
    ...details,
    options: null,
    variants: form.variants.slice(0, 1).map((v) => ({
      sku: v.sku.trim() || null,
      name: v.name.trim() || null,
      option_values: {},
      purchase_price: v.purchase_price,
      selling_price: v.selling_price,
      wholesale_price: v.wholesale_price || null,
      reorder_level: v.reorder_level || '0',
      barcodes: splitList(v.barcodes, /[\s,]+/),
      is_active: v.is_active,
    })),
  }
}
