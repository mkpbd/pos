import { describe, expect, it } from 'vitest'
import type { Product } from '@/features/products/api'
import { emptyVariant, productFormSchema, toFormValues, toProductInput, type VariantFormValues } from '@/features/products/product-form'

const priced = (overrides: Partial<VariantFormValues>): VariantFormValues => ({ ...emptyVariant(), purchase_price: '10', selling_price: '15', ...overrides })

describe('product form', () => {
  it('builds the create payload with trimmed values, parsed barcodes and nulls for blanks', () => {
    const form = {
      ...toFormValues(),
      name: '  Juice ',
      unit_id: 'u-1',
      variants: [priced({ barcodes: '96385074, 4006381333931\n96385074', wholesale_price: '', reorder_level: '' })],
    }

    const input = toProductInput(form)

    expect(input.name).toBe('Juice')
    expect(input.options).toBeNull()
    expect(input.max_discount_percent).toBeNull()
    expect(input.variants[0]).toEqual({
      sku: null, name: null, option_values: {}, purchase_price: '10', selling_price: '15',
      wholesale_price: null, reorder_level: '0', barcodes: ['96385074', '4006381333931'], is_active: true,
    })
  })

  it('sends the saved variants unchanged when editing details (the grid owns them)', () => {
    const product = {
      id: 'p-1', name: 'Polo', description: null, type: 'standard', category: null, brand: null, unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false },
      tax_rate: null, track_stock: true, track_batches: false, track_serials: false, max_discount_percent: null, is_active: true, archived_at: null,
      options: [{ name: 'Size', values: ['M'] }], images: [],
      variants: [{ id: 'v-m', sku: 'POLO-M', name: null, option_values: { Size: 'M' }, purchase_price: '300.00', selling_price: '450.00', wholesale_price: null, reorder_level: '2.000', barcodes: ['111'], is_active: true }],
    } satisfies Product

    const form = toFormValues(product)
    expect(form.variants).toEqual([])
    const input = toProductInput({ ...form, name: 'Polo Shirt' }, product)

    expect(input.name).toBe('Polo Shirt')
    expect(input.options).toEqual([{ name: 'Size', values: ['M'] }])
    expect(input.variants).toEqual([{ id: 'v-m', sku: 'POLO-M', name: null, option_values: { Size: 'M' }, purchase_price: '300.00', selling_price: '450.00', wholesale_price: null, reorder_level: '2.000', barcodes: ['111'], is_active: true }])
  })

  it('services never track stock', () => {
    const input = toProductInput({ ...toFormValues(), type: 'service', unit_id: 'u', track_stock: true, track_serials: true, variants: [priced({})] })

    expect(input.track_stock).toBe(false)
    expect(input.track_serials).toBe(false)
  })

  it('validates money and required fields', () => {
    const result = productFormSchema.safeParse({ ...toFormValues(), variants: [priced({ selling_price: '1.999' })] })

    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('name')
    expect(paths).toContain('unit_id')
    expect(paths).toContain('variants.0.selling_price')
  })
})
