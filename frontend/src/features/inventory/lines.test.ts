import { describe, expect, it } from 'vitest'
import { emptyLine, type LineValue } from '@/components/common/line-values'
import type { VariantOption } from '@/components/common/variant-options'
import { linesSchema, toApiLine } from '@/features/inventory/lines'

const variant = (overrides: Partial<VariantOption> = {}): VariantOption => ({
  id: 'v-1', label: 'Mango Juice 1L', sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_batches: false, tax_rate: null, ...overrides,
})
const line = (overrides: Partial<LineValue> = {}): LineValue => ({ ...emptyLine(), variant: variant(), quantity: '5', ...overrides })

function issues(schema: ReturnType<typeof linesSchema>, lines: LineValue[]) {
  const result = schema.safeParse(lines)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]))
}

describe('linesSchema', () => {
  it('requires a product and a non-zero quantity', () => {
    const schema = linesSchema({})
    expect(issues(schema, [line({ variant: null, quantity: '0' })])).toEqual({ '0.variant': 'Choose a product.', '0.quantity': 'Must not be zero.' })
    expect(issues(schema, [])).toEqual({ '': 'Add at least one line.' })
  })

  it('accepts negative quantities only for signed documents', () => {
    expect(issues(linesSchema({}), [line({ quantity: '-2' })])).toHaveProperty('0.quantity')
    expect(issues(linesSchema({ signed: true }), [line({ quantity: '-2' })])).toEqual({})
  })

  it('rejects fractions of whole units but allows them for weighed goods', () => {
    expect(issues(linesSchema({}), [line({ quantity: '1.5' })])).toEqual({ '0.quantity': 'Whole pcs only.' })
    expect(issues(linesSchema({}), [line({ quantity: '2.000' })])).toEqual({})
    expect(issues(linesSchema({}), [line({ quantity: '1.250', variant: variant({ allow_decimal: true, unit_code: 'kg' }) })])).toEqual({})
  })

  it('caps the quantity at the open amount without float rounding', () => {
    const schema = linesSchema({})
    const rice = variant({ allow_decimal: true, unit_code: 'kg' })
    expect(issues(schema, [line({ variant: rice, quantity: '100.001', max_quantity: '100' })])).toEqual({ '0.quantity': 'At most 100.' })
    expect(issues(schema, [line({ variant: rice, quantity: '100.000', max_quantity: '100' })])).toEqual({})
  })

  it('requires a cost on incoming lines only', () => {
    const schema = linesSchema({ signed: true, cost: 'required' })
    expect(issues(schema, [line({ unit_cost: '' })])).toEqual({ '0.unit_cost': 'Cost with up to 4 decimals.' })
    expect(issues(schema, [line({ quantity: '-1', unit_cost: '' })])).toEqual({})
    expect(issues(linesSchema({ cost: 'optional' }), [line({ unit_cost: '' })])).toEqual({})
    expect(issues(linesSchema({ cost: 'optional' }), [line({ unit_cost: '1.23456' })])).toHaveProperty('0.unit_cost')
  })

  it('asks for a batch number when stock comes in and a batch when it goes out', () => {
    const schema = linesSchema({ signed: true, batch: 'signed' })
    const batched = variant({ track_batches: true })
    expect(issues(schema, [line({ variant: batched, quantity: '3' })])).toEqual({ '0.batch_number': 'Batch number required.' })
    expect(issues(schema, [line({ variant: batched, quantity: '-3' })])).toEqual({ '0.batch_id': 'Choose a batch.' })
    expect(issues(schema, [line({ variant: batched, quantity: '-3', batch_id: 'bt-1' })])).toEqual({})
  })
})

describe('toApiLine', () => {
  it('sends only what the endpoint understands', () => {
    const batched = variant({ track_batches: true })
    const options = { signed: true, cost: 'optional', batch: 'signed' } as const

    expect(toApiLine(line({ variant: batched, quantity: ' 12 ', unit_cost: '', batch_number: ' L-7 ', expires_on: '2027-01-31' }), options)).toEqual({
      variant_id: 'v-1', quantity: '12', unit_cost: null, batch_number: 'L-7', expires_on: '2027-01-31',
    })
    expect(toApiLine(line({ variant: batched, quantity: '-2', unit_cost: '9.99', batch_id: 'bt-1' }), options)).toEqual({ variant_id: 'v-1', quantity: '-2', batch_id: 'bt-1' })
  })

  it('links lines to their source document', () => {
    const options = { cost: 'required', tax: true, sourceField: 'purchase_order_line_id' } as const
    expect(toApiLine(line({ unit_cost: '18.00', tax_rate: '', source_line_id: 'pol-1' }), options)).toEqual({
      variant_id: 'v-1', quantity: '5', unit_cost: '18.00', tax_rate: null, purchase_order_line_id: 'pol-1',
    })
  })
})
