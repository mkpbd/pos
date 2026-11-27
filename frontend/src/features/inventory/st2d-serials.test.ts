import { describe, expect, it } from 'vitest'
import { emptyLine, type LineValue } from '@/components/common/line-values'
import type { VariantOption } from '@/components/common/variant-options'
import { serialReferencePath } from '@/features/inventory/api'
import { linesSchema, serialErrors, serialsMode, serialsNeeded, toApiLine } from '@/features/inventory/lines'
import { ApiError } from '@/lib/api/client'

/** ST2d: serial numbers on stock and purchase document lines. */

const phone = (overrides: Partial<VariantOption> = {}): VariantOption => ({
  id: 'v-9', label: 'Phone X', sku: 'PHONE-X', unit_code: 'pcs', allow_decimal: false, track_stock: true, track_batches: false, track_serials: true, tax_rate: null, ...overrides,
})
const line = (overrides: Partial<LineValue> = {}): LineValue => ({ ...emptyLine(), variant: phone(), quantity: '2', ...overrides })

function issues(schema: ReturnType<typeof linesSchema>, lines: LineValue[]) {
  const result = schema.safeParse(lines)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]))
}

describe('serial lines', () => {
  it('needs one serial per unit (free units included on receipts), only for serial-tracked products', () => {
    expect(serialsNeeded(line(), { serials: 'in' })).toBe(2)
    expect(serialsNeeded(line({ quantity: '-3' }), { serials: 'signed' })).toBe(3)
    expect(serialsNeeded(line({ bonus_quantity: '1' }), { serials: 'in', discount: true })).toBe(3)
    expect(serialsNeeded(line({ quantity: '1.5' }), { serials: 'in' })).toBeNull()
    expect(serialsNeeded(line(), {})).toBeNull()
    expect(serialsNeeded(line({ variant: phone({ track_serials: false }) }), { serials: 'in' })).toBeNull()
    expect(serialsMode({ serials: 'signed' }, '-1')).toBe('out')
    expect(serialsMode({ serials: 'signed' }, '4')).toBe('in')
    expect(serialsMode({}, '4')).toBeNull()
  })

  it('checks the count against the quantity', () => {
    const schema = linesSchema({ serials: 'in', discount: true })
    expect(issues(schema, [line({ serials: ['A1'] })])).toEqual({ '0.serials': 'Enter 2 serial numbers (1 entered).' })
    expect(issues(schema, [line({ bonus_quantity: '1', serials: ['A1', 'A2'] })])).toEqual({ '0.serials': 'Enter 3 serial numbers (2 entered).' })
    expect(issues(schema, [line({ serials: ['A1', 'A2'] })])).toEqual({})
    expect(issues(linesSchema({}), [line()])).toEqual({})
  })

  it('sends the serials of serial-tracked lines only', () => {
    expect(toApiLine(line({ serials: ['A1', 'A2'] }), { serials: 'out' })).toEqual({ variant_id: 'v-9', quantity: '2', serials: ['A1', 'A2'] })
    expect(toApiLine(line({ variant: phone({ track_serials: false }), serials: [] }), { serials: 'out' })).toEqual({ variant_id: 'v-9', quantity: '2' })
    expect(toApiLine(line({ serials: ['A1', 'A2'] }), {})).toEqual({ variant_id: 'v-9', quantity: '2' })
  })

  it('places SERIAL_NOT_IN_STOCK / SERIAL_IN_STOCK at the lines holding those serials', () => {
    const lines = [{ serials: ['a1', 'B2'] }, {}, { serials: ['C3'] }]
    expect(serialErrors(new ApiError(422, 'SERIAL_NOT_IN_STOCK', 'Not in stock.', { serials: ['A1', 'C3'] }), lines)).toEqual([
      { path: 'lines.0.serials', message: 'Not in stock at this store: a1' },
      { path: 'lines.2.serials', message: 'Not in stock at this store: C3' },
    ])
    expect(serialErrors(new ApiError(422, 'SERIAL_IN_STOCK', 'In stock.', { serials: ['b2'] }), lines)).toEqual([{ path: 'lines.0.serials', message: 'Already in stock: B2' }])
    expect(serialErrors(new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', { serials: ['A1'] }), lines)).toEqual([])
  })

  it('links history events to their documents', () => {
    expect(serialReferencePath('goods_receipt', 'gr-1')).toBe('/purchasing/receipts/gr-1')
    expect(serialReferencePath('stock_transfer', 't-1')).toBe('/inventory/transfers/t-1')
    expect(serialReferencePath('sale', 'sa-1')).toBe('/sales/sa-1')
    expect(serialReferencePath('something_else', 'x')).toBeNull()
    expect(serialReferencePath(null, null)).toBeNull()
  })
})
