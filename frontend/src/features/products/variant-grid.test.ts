import { describe, expect, it } from 'vitest'
import type { Product } from '@/features/products/api'
import { movePhoto, togglePhoto, toOptionImagesInput, toOptionPhotosState, MAX_PHOTOS_PER_VALUE } from '@/features/products/option-photos'
import {
  addPercent,
  barcodeErrorKey,
  barcodesInput,
  applyBulk,
  bulkValueError,
  emptyRow,
  generateRows,
  gridErrorKey,
  MAX_VARIANTS,
  parseClipboard,
  rowsWithValue,
  skuFor,
  toGridInput,
  toGridValues,
  TooManyVariantsError,
  variantGridSchema,
  type GridRow,
} from '@/features/products/variant-grid'

const row = (overrides: Partial<GridRow>): GridRow => ({ ...emptyRow(), purchase_price: '300', selling_price: '450', ...overrides })

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p-1', name: 'Polo Shirt', description: null, type: 'standard', category: null, brand: null,
  unit: { id: 'u-1', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null, track_stock: true, track_batches: false, track_serials: false,
  max_discount_percent: null, is_active: true, archived_at: null, options: [{ name: 'Size', values: ['M', 'L'] }], images: [],
  variants: [
    { id: 'v-m', sku: 'POLO-M', name: null, option_values: { Size: 'M' }, purchase_price: '300.00', selling_price: '450.00', wholesale_price: null, reorder_level: '2.000', barcodes: ['111'], is_active: true, compare_at_price: '500.00' },
    { id: 'v-s', sku: 'POLO-S', name: null, option_values: { Size: 'S' }, purchase_price: '300.00', selling_price: '450.00', wholesale_price: null, reorder_level: '0.000', barcodes: [], is_active: false, compare_at_price: null },
  ],
  ...overrides,
})

describe('variant grid', () => {
  it('loads saved variants and marks those outside the options as removed', () => {
    const values = toGridValues(product())

    expect(values.options).toEqual([{ name: 'Size', values: 'M, L' }])
    expect(values.variants[0]).toMatchObject({ id: 'v-m', compare_at_price: '500.00', reorder_level: '2', barcodes: '111', removed: false })
    expect(values.variants[1]).toMatchObject({ id: 'v-s', removed: true })
  })

  it('generates combinations, keeps matched rows, reuses a variant when an option is added and keeps dropped ones as removed', () => {
    const existing = [
      row({ id: 'v-m', sku: 'POLO-M', option_values: { size: 'm' }, selling_price: '450' }),
      row({ id: 'v-xl', sku: 'POLO-XL', option_values: { Size: 'XL' } }),
      row({ option_values: { Size: 'Q' } }),
    ]

    const rows = generateRows([{ name: 'Size', values: 'M, L' }, { name: 'Colour', values: 'Red, নীল' }], existing, 'polo')

    expect(rows.map((r) => r.option_values)).toEqual([
      { Size: 'M', Colour: 'Red' }, { Size: 'M', Colour: 'নীল' }, { Size: 'L', Colour: 'Red' }, { Size: 'L', Colour: 'নীল' }, { Size: 'XL' },
    ])
    // M gained a colour: the saved variant is reused for M / Red (keeps its id and SKU).
    expect(rows[0]).toMatchObject({ id: 'v-m', sku: 'POLO-M' })
    // New rows: automatic SKU (Bangla values fall back to their position) and the first row's prices.
    expect(rows[1]).toMatchObject({ sku: 'POLO-M-2', selling_price: '450' })
    expect(rows[1]?.id).toBeUndefined()
    expect(rows[2]?.sku).toBe('POLO-L-RED')
    // The unsaved Q row is dropped; saved XL is kept, removed and inactive.
    expect(rows[4]).toMatchObject({ id: 'v-xl', removed: true, is_active: false })
  })

  it('is idempotent and refuses more than the limit', () => {
    const once = generateRows([{ name: 'Size', values: 'S, M' }], [row({ id: 'v-1', option_values: {} })], 'X')
    const twice = generateRows([{ name: 'Size', values: 'S, M' }], once, 'X')
    expect(twice).toEqual(once)

    const many = Array.from({ length: 15 }, (_, i) => `V${i}`).join(',')
    expect(() => generateRows([{ name: 'A', values: many }, { name: 'B', values: many }], [], 'X')).toThrow(TooManyVariantsError)
    expect(225).toBeGreaterThan(MAX_VARIANTS)
  })

  it('builds SKUs as <base>-<VAL1>-<VAL2>', () => {
    expect(skuFor('tee', { Colour: 'Navy Blue', Size: 'X-Large' }, [{ name: 'Size', values: ['X-Large'] }, { name: 'Colour', values: ['Navy Blue'] }])).toBe('TEE-XLARGE-NAVYBLUE')
  })

  it('applies bulk edits with exact decimal arithmetic', () => {
    expect(addPercent('450', '10')).toBe('495.00')
    expect(addPercent('99.99', '-15')).toBe('84.99')
    expect(addPercent('0.05', '10')).toBe('0.06')
    expect(addPercent('10', '-150')).toBe('0.00')

    const rows = [row({ option_values: { Colour: 'Red' } }), row({ option_values: { Colour: 'Blue' } }), row({ option_values: { Colour: 'red' }, selling_price: '' })]
    const reds = rowsWithValue(rows, 'colour', 'RED')
    expect(reds).toEqual([0, 2])

    const raised = applyBulk(rows, reds, { kind: 'percent', field: 'selling_price', percent: '10' })
    expect(raised.map((r) => r.selling_price)).toEqual(['495.00', '450', ''])
    expect(applyBulk(rows, [1], { kind: 'set', field: 'compare_at_price', value: ' 520 ' })[1]?.compare_at_price).toBe('520')
    expect(applyBulk(rows, [0, 1], { kind: 'active', value: false }).map((r) => r.is_active)).toEqual([false, false, true])

    expect(bulkValueError({ kind: 'percent' }, '12.5')).toBeNull()
    expect(bulkValueError({ kind: 'percent' }, 'ten')).toMatch(/percentage/)
    expect(bulkValueError({ kind: 'set', field: 'compare_at_price' }, '')).toBeNull()
    expect(bulkValueError({ kind: 'set', field: 'selling_price' }, '1.234')).toMatch(/2 decimals/)
  })

  it('validates duplicates, compare-at and the opening stock store', () => {
    const result = variantGridSchema.safeParse({
      options: [{ name: 'Size', values: 'S, M' }],
      stock_store_id: '',
      variants: [
        row({ sku: 'A-1', barcodes: '111', compare_at_price: '400' }),
        row({ sku: 'a-1', barcodes: '111' }),
        row({ opening_stock: '5' }),
      ],
    })

    expect(result.success).toBe(false)
    const issues = Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))
    expect(issues['variants.1.sku']).toBe('Same SKU as row 1.')
    expect(issues['variants.1.barcodes']).toMatch(/also on row 1/)
    expect(issues['variants.0.compare_at_price']).toBe('Must be higher than the selling price.')
    expect(issues.stock_store_id).toBe('Choose where the opening stock goes.')
  })

  it('builds the save body without removed rows and maps server errors back to grid rows', () => {
    const { input, rowOf } = toGridInput({
      options: [{ name: 'Size', values: 'M, L' }],
      stock_store_id: 's-1',
      variants: [
        row({ id: 'v-old', option_values: { Size: 'S' }, removed: true }),
        row({ id: 'v-m', option_values: { Size: 'M' }, sku: ' POLO-M ', barcodes: '1, 2 1', wholesale_price: '', compare_at_price: '520', reorder_level: '', opening_stock: '9' }),
        row({ option_values: { Size: 'L' }, sku: '', opening_stock: '4' }),
      ],
    })

    expect(input).toEqual({
      options: [{ name: 'Size', values: ['M', 'L'] }],
      stock_store_id: 's-1',
      variants: [
        { id: 'v-m', option_values: { Size: 'M' }, sku: 'POLO-M', barcodes: ['1', '2'], purchase_price: '300', selling_price: '450', wholesale_price: null, compare_at_price: '520', reorder_level: '0', weight_grams: null, is_active: true, price_tiers: [], branch_prices: [] },
        { option_values: { Size: 'L' }, sku: null, barcodes: [], purchase_price: '300', selling_price: '450', wholesale_price: null, compare_at_price: null, reorder_level: '0', weight_grams: null, is_active: true, price_tiers: [], branch_prices: [], opening_stock: '4' },
      ],
    })
    expect(gridErrorKey('variants.1.barcodes.0', rowOf)).toBe('variants.2.barcodes.0')
    expect(gridErrorKey('stock_store_id', rowOf)).toBe('stock_store_id')
  })

  it('parses blocks pasted from a spreadsheet', () => {
    expect(parseClipboard('450\t500\r\n460\t510\r\n')).toEqual([['450', '500'], ['460', '510']])
  })
})

describe('BD2a variant weight', () => {
  it('loads, validates, copies to new rows and sends the weight in grams', () => {
    const values = toGridValues(product({ variants: [{ ...product().variants[0]!, weight_grams: 750 }] }))
    expect(values.variants[0]!.weight_grams).toBe('750')
    const generated = generateRows([{ name: 'Size', values: 'M, L, XL' }], values.variants, 'POLO')
    expect(generated.find((r) => r.option_values.Size === 'XL')!.weight_grams).toBe('750')
    expect(variantGridSchema.safeParse({ ...values, variants: [row({ weight_grams: '0' })] }).success).toBe(false)
    expect(variantGridSchema.safeParse({ ...values, variants: [row({ weight_grams: '1.5' })] }).success).toBe(false)
    expect(variantGridSchema.safeParse({ ...values, variants: [row({ weight_grams: '1000001' })] }).success).toBe(false)
    expect(variantGridSchema.safeParse({ ...values, variants: [row({ weight_grams: '1000000' })] }).success).toBe(true)
    const { input } = toGridInput({ options: [], stock_store_id: '', variants: [row({ weight_grams: ' 1200 ' }), row({ sku: 'B', weight_grams: '' })] })
    expect(input.variants.map((v) => v.weight_grams)).toEqual([1200, null])
  })
})

describe('photos by colour', () => {
  const withPhotos = product({
    options: [{ name: 'Colour', values: ['Red', 'Blue'] }, { name: 'Size', values: ['M'] }],
    images: [{ id: 'i-1', url: '/1.png', original_name: '1.png' }, { id: 'i-2', url: '/2.png', original_name: '2.png' }],
    photo_option: 'Colour',
    option_styles: { Colour: 'image' },
    option_images: { Red: ['i-2', 'gone', 'i-1'] },
  })

  it('reads the saved state, dropping photos that no longer exist', () => {
    expect(toOptionPhotosState(withPhotos)).toEqual({ photoOption: 'Colour', styles: { Colour: 'image', Size: '' }, photos: { Red: ['i-2', 'i-1'], Blue: [] } })
  })

  it('toggles, reorders and builds the save body (automatic style = null)', () => {
    expect(togglePhoto(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePhoto(['a', 'b'], 'a')).toEqual(['b'])
    const full = Array.from({ length: MAX_PHOTOS_PER_VALUE }, (_, i) => `x${i}`)
    expect(togglePhoto(full, 'y')).toBe(full)
    expect(movePhoto(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(movePhoto(['a', 'b'], 0, -1)).toEqual(['a', 'b'])

    expect(toOptionImagesInput(toOptionPhotosState(withPhotos), withPhotos)).toEqual({
      photo_option: 'Colour',
      styles: { Colour: 'image', Size: null },
      values: [{ value: 'Red', image_ids: ['i-2', 'i-1'] }, { value: 'Blue', image_ids: [] }],
    })
    expect(toOptionImagesInput({ photoOption: null, styles: {}, photos: {} }, withPhotos)).toEqual({ photo_option: null, styles: { Colour: null, Size: null }, values: [] })
  })
})

describe('ST2c packs and prices in the grid', () => {
  const withPacks = product({
    options: null,
    variants: [{
      id: 'v-1', sku: 'JUICE', name: null, option_values: {}, purchase_price: '18.00', selling_price: '25.00', wholesale_price: '22.00', reorder_level: '0.000',
      barcodes: ['111', '999'], is_active: true,
      packs: [{ barcode: '999', units: '24.000', pack_name: 'Carton' }],
      price_tiers: [{ min_quantity: '12.000', price: '23.00' }],
      branch_prices: [{ branch_id: 'b-1', price: '24.00' }],
    }],
  })

  it('splits unit barcodes from packs and sends packs as objects after the unit codes', () => {
    const values = toGridValues(withPacks)
    expect(values.variants[0]).toMatchObject({
      barcodes: '111',
      packs: [{ barcode: '999', units: '24', pack_name: 'Carton' }],
      price_tiers: [{ min_quantity: '12', price: '23.00' }],
      branch_prices: [{ branch_id: 'b-1', price: '24.00' }],
    })
    expect(toGridInput(values).input.variants[0]).toMatchObject({
      barcodes: ['111', { barcode: '999', units: '24', pack_name: 'Carton' }],
      price_tiers: [{ min_quantity: '12', price: '23.00' }],
      branch_prices: [{ branch_id: 'b-1', price: '24.00' }],
    })
    expect(barcodesInput(withPacks.variants[0]!)).toEqual(['111', { barcode: '999', units: '24.000', pack_name: 'Carton' }])
  })

  it('validates packs, breaks and branch prices', () => {
    const issues = (r: Partial<GridRow>) =>
      variantGridSchema.safeParse({ options: [], stock_store_id: '', variants: [row({ barcodes: '111', ...r })] }).error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? []
    expect(issues({ packs: [{ barcode: '111', units: '1', pack_name: '' }] })).toEqual([
      'variants.0.packs.0.units: More than 1 unit.',
      'variants.0.packs.0.pack_name: Name it, e.g. Carton.',
      'variants.0.packs.0.barcode: Already a barcode of this variant.',
    ])
    expect(issues({ price_tiers: [{ min_quantity: '1', price: '5' }, { min_quantity: '10', price: '4' }, { min_quantity: '10.0', price: '3' }] })).toEqual([
      'variants.0.price_tiers.0.min_quantity: More than 1.',
      'variants.0.price_tiers.2.min_quantity: Each break needs its own quantity.',
    ])
    expect(issues({ branch_prices: [{ branch_id: 'b-1', price: '5' }, { branch_id: 'b-1', price: '1.234' }] })).toEqual([
      'variants.0.branch_prices.1.price: Amount with up to 2 decimals.',
      'variants.0.branch_prices.1.branch_id: This branch already has a price.',
    ])
    expect(issues({ packs: [{ barcode: '999', units: '24', pack_name: 'Carton' }], price_tiers: [{ min_quantity: '12', price: '23' }] })).toEqual([])
  })

  it('puts server barcode errors on the unit barcodes or the pack row', () => {
    expect(barcodeErrorKey('variants.0.barcodes.0', 1)).toBe('variants.0.barcodes')
    expect(barcodeErrorKey('variants.0.barcodes.1.units', 1)).toBe('variants.0.packs.0.units')
    expect(barcodeErrorKey('variants.0.barcodes.2', 1)).toBe('variants.0.packs.1.barcode')
    expect(barcodeErrorKey('variants.0.sku', 1)).toBe('variants.0.sku')
  })
})
