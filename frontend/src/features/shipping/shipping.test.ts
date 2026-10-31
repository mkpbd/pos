import { describe, expect, it } from 'vitest'
import type { District, Division, ShippingZone } from '@/features/shipping/api'
import { districtOwners, feeSummary, groupDistricts, methodSchema, toggleDivision, toMethodInput, toMethodValues, zoneSaveError } from '@/features/shipping/shipping'
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
    })
  })

  it('summarises fees', () => {
    expect(feeSummary({ fee: '60.00', free_over: '2000.00' }, 'BDT')).toBe('BDT 60.00 · free over BDT 2,000.00')
    expect(feeSummary({ fee: '0.00', free_over: null })).toBe('Free')
  })
})
