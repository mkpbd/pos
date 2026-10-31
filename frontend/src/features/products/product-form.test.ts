import { describe, expect, it } from 'vitest'
import { emptyVariant, generateVariants, productFormSchema, toFormValues, toProductInput, type VariantFormValues } from '@/features/products/product-form'

const priced = (overrides: Partial<VariantFormValues>): VariantFormValues => ({ ...emptyVariant(), purchase_price: '10', selling_price: '15', ...overrides })

describe('product form', () => {
  it('generates the option matrix and keeps existing rows', () => {
    const existing = [priced({ id: 'v-m', sku: 'POLO-M', option_values: { Size: 'M' }, selling_price: '450' })]

    const rows = generateVariants([{ name: 'Size', values: 'M, L' }, { name: 'Color', values: 'Red' }], existing)

    expect(rows.map((r) => r.option_values)).toEqual([{ Size: 'M', Color: 'Red' }, { Size: 'L', Color: 'Red' }])
    // M/Red is a new combination (Color added), so it copies prices from the template row.
    expect(rows[0]?.selling_price).toBe('450')
    expect(rows[0]?.id).toBeUndefined()

    const again = generateVariants([{ name: 'Size', values: 'M, L' }], [priced({ id: 'v-m', option_values: { size: 'm' }, selling_price: '450' })])
    expect(again[0]?.id).toBe('v-m')
    expect(again[1]?.id).toBeUndefined()
  })

  it('builds the API payload with trimmed values, parsed barcodes and nulls for blanks', () => {
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
