import { describe, expect, it } from 'vitest'
import type { District, Division, ShippingZone } from '@/features/shipping/api'
import { adjustmentLabel, areaSchema, districtOwners, feeSummary, groupDistricts, methodSchema, sortAreas, toAreaInput, toAreaValues, toggleDivision, toMethodInput, toMethodValues, weightSummary, zoneSaveError } from '@/features/shipping/shipping'
import { ApiError } from '@/lib/api/client'

const divisions: Division[] = [{ id: 3, name: 'Dhaka' }, { id: 2, name: 'Chattogram' }, { id: 9, name: 'Empty' }]
const districts: District[] = [
  { id: 47, division_id: 3, name: 'Gazipur' },
  { id: 26, division_id: 3, name: 'Dhaka' },
  { id: 12, division_id: 2, name: 'Cumilla' },
]
const zone = (id: string, name: string, ids: number[]): ShippingZone => ({
  id, name, is_active: true, sort_order: 0, methods: [], districts: ids.map((d) => ({ id: d, name: districts.find((x) => x.id === d)?.name ?? '' })),
})

describe('shipping zone helpers', () => {
  it('groups districts by division, both by name', () => {
    const groups = groupDistricts(divisions, districts)
    expect(groups.map((g) => g.division.name)).toEqual(['Chattogram', 'Dhaka'])
    expect(groups[1]?.districts.map((d) => d.name)).toEqual(['Dhaka', 'Gazipur'])
  })

  it('maps districts to the other zone that owns them', () => {
    const zones = [zone('z-1', 'Inside Dhaka', [26]), zone('z-2', 'Outside Dhaka', [47, 12])]
    expect([...districtOwners(zones, 'z-2')]).toEqual([[26, 'Inside Dhaka']])
    expect(districtOwners(zones).get(12)).toBe('Outside Dhaka')
  })

  it('toggles a division without touching districts of other zones', () => {
    const [, dhaka] = groupDistricts(divisions, districts)
    const owners = new Map([[26, 'Inside Dhaka']])
    expect(toggleDivision([12], dhaka!, owners, true)).toEqual([12, 47])
    expect(toggleDivision([12, 47], dhaka!, owners, false)).toEqual([12])
  })

  it('names the conflicting districts of DISTRICT_IN_OTHER_ZONE', () => {
    const error = new ApiError(422, 'DISTRICT_IN_OTHER_ZONE', 'raw', { district_ids: [47] })
    expect(zoneSaveError(error, districts)).toMatch(/Remove Gazipur/)
    expect(zoneSaveError(new ApiError(422, 'DISTRICT_IN_OTHER_ZONE', 'raw', { districts: [{ id: 12, zone: 'X' }] }), districts)).toMatch(/Remove Cumilla/)
    expect(zoneSaveError(new ApiError(422, 'DISTRICT_IN_OTHER_ZONE', 'raw'), districts)).toMatch(/already belong to another zone/)
    expect(zoneSaveError(new ApiError(500, 'SERVER_ERROR', 'Boom'), districts)).toBe('Boom')
  })
})

describe('shipping method form', () => {
  it('validates amounts and the delivery window', () => {
    const base = toMethodValues(null)
    expect(methodSchema.safeParse({ ...base, name: 'Home delivery' }).success).toBe(true)
    const bad = methodSchema.safeParse({ ...base, name: 'X', fee: '-1', eta_min_days: 5, eta_max_days: 2 })
    expect(bad.success).toBe(false)
    expect(methodSchema.safeParse({ ...base, name: 'X', eta_min_days: 5, eta_max_days: 2 }).error?.issues[0]?.path).toEqual(['eta_max_days'])
    expect(methodSchema.safeParse({ ...base, name: 'X', eta_max_days: 31 }).success).toBe(false)
    // A COD fee only matters while COD is allowed.
    expect(methodSchema.safeParse({ ...base, name: 'X', cod_allowed: false, cod_fee: '' }).success).toBe(true)
    expect(methodSchema.safeParse({ ...base, name: 'X', cod_allowed: true, cod_fee: '' }).success).toBe(false)
  })

  it('maps empty optional fields to null', () => {
    const v = methodSchema.parse({ ...toMethodValues(null, 2), name: ' Courier ', fee: '120', cod_allowed: false, cod_fee: '' })
    expect(toMethodInput(v)).toEqual({
      name: 'Courier', description: null, fee: '120', free_over: null, cod_allowed: false, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 3, is_active: true, sort_order: 2,
      weight_included_kg: null, fee_per_extra_kg: '0.00', translations: undefined,
    })
    expect(toMethodInput(v, { bn: { name: 'হোম' } }).translations).toEqual({ bn: { name: '', description: '' } })
  })

  it('summarises fees', () => {
    expect(feeSummary({ fee: '60.00', free_over: '2000.00' }, 'BDT')).toBe('BDT 60.00 · free over BDT 2,000.00')
    expect(feeSummary({ fee: '0.00', free_over: null })).toBe('Free')
  })
})

describe('BD2a weight pricing and delivery areas', () => {
  it('turns weight pricing on and off', () => {
    const off = toMethodValues(null)
    expect(off).toMatchObject({ weight_pricing: false, weight_included_kg: '1', fee_per_extra_kg: '0.00' })
    const on = methodSchema.parse({ ...off, name: 'Home', weight_pricing: true, weight_included_kg: '2.5', fee_per_extra_kg: '20' })
    expect(toMethodInput(on)).toMatchObject({ weight_included_kg: '2.5', fee_per_extra_kg: '20' })
    // Off sends null whatever was typed.
    expect(toMethodInput({ ...on, weight_pricing: false })).toMatchObject({ weight_included_kg: null, fee_per_extra_kg: '0.00' })
    expect(methodSchema.safeParse({ ...off, name: 'Home', weight_pricing: true, weight_included_kg: '-1' }).success).toBe(false)
    expect(methodSchema.safeParse({ ...off, name: 'Home', weight_pricing: true, fee_per_extra_kg: 'x' }).success).toBe(false)
    // A saved method with weight pricing opens with it on.
    const saved = { id: 'sm-1', name: 'Home', description: null, fee: '60.00', free_over: null, cod_allowed: true, cod_fee: '0.00', eta_min_days: 1, eta_max_days: 2, is_active: true, sort_order: 0, weight_included_kg: '1.000', fee_per_extra_kg: '20.00' }
    expect(toMethodValues(saved)).toMatchObject({ weight_pricing: true, weight_included_kg: '1', fee_per_extra_kg: '20.00' })
    expect(weightSummary(saved, 'BDT')).toBe('+ BDT 20.00 per kg over 1 kg')
    expect(weightSummary({ weight_included_kg: null })).toBeNull()
  })

  it('checks areas and allows negative fee changes', () => {
    const values = areaSchema.parse({ ...toAreaValues(null, 3), name: ' Mirpur ', fee_adjustment: '-10' })
    expect(toAreaInput(values, 26)).toEqual({ district_id: 26, name: 'Mirpur', fee_adjustment: '-10', is_active: true, sort_order: 3 })
    expect(areaSchema.safeParse({ ...values, fee_adjustment: '1.234' }).success).toBe(false)
    expect(areaSchema.safeParse({ ...values, name: '' }).success).toBe(false)
    expect(adjustmentLabel('20.00', 'BDT')).toBe('+ BDT 20.00')
    expect(adjustmentLabel('-10.00', 'BDT')).toBe('− BDT 10.00')
    expect(adjustmentLabel('0.00')).toBe('No change')
    const area = (id: string, name: string, sort_order: number) => ({ id, district_id: 26, name, fee_adjustment: '0.00', is_active: true, sort_order })
    expect(sortAreas([area('a', 'Uttara', 1), area('b', 'Mirpur', 1), area('c', 'Banani', 0)]).map((a) => a.name)).toEqual(['Banani', 'Mirpur', 'Uttara'])
  })
})
