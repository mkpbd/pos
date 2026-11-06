import { describe, expect, it } from 'vitest'
import { makeCurrentUser } from '@/test/fixtures'
import { normalizeApprovals, normalizeComparison, type Requisition } from '@/features/procurement/api'
import {
  defaultAward,
  defaultAwardQuantity,
  mayApprove,
  mayCancelRequisition,
  mayEditRequisition,
  costSourceLabel,
  remainingQuantity,
  requisitionTimeline,
} from '@/features/procurement/procurement'

const userWith = (permissions: string[]) => {
  const me = makeCurrentUser({ permissions })
  return { me, can: (p: string) => permissions.includes(p) }
}

const someoneElse = { id: 'u-7', name: 'Shila Staff' }

describe('mayApprove', () => {
  it('lets a manager approve manager-level documents but not high-value ones', () => {
    const { me, can } = userWith(['purchases.approve'])
    expect(mayApprove({ approval_level: 'manager', owner: someoneElse }, me, can)).toBe(true)
    expect(mayApprove({ approval_level: 'high', owner: someoneElse }, me, can)).toBe(false)
  })

  it('lets a high-value approver approve both tiers', () => {
    const { me, can } = userWith(['purchases.approve_high'])
    expect(mayApprove({ approval_level: 'manager', owner: someoneElse }, me, can)).toBe(true)
    expect(mayApprove({ approval_level: 'high', owner: someoneElse }, me, can)).toBe(true)
  })

  it('never offers approval of your own document, whatever the API says', () => {
    const { me, can } = userWith(['purchases.approve', 'purchases.approve_high'])
    expect(mayApprove({ approval_level: 'manager', owner: { id: me.user.id, name: me.user.name }, can_approve: true }, me, can)).toBe(false)
  })

  it("follows the API's can_approve (branch access) for others' documents", () => {
    const { me, can } = userWith(['purchases.approve'])
    expect(mayApprove({ approval_level: 'manager', owner: someoneElse, can_approve: false }, me, can)).toBe(false)
  })

  it('does not let requesters approve', () => {
    const { me, can } = userWith(['purchases.request'])
    expect(mayApprove({ approval_level: 'manager', owner: someoneElse }, me, can)).toBe(false)
  })
})

const requisition = (overrides: Partial<Requisition> = {}): Requisition => ({
  id: 'pr-1', number: 'PR-000001', status: 'draft', store: null, requested_by: { id: 'u-1', name: 'Rahim Uddin' }, needed_by: null, notes: null,
  estimated_total: '1500.00', approval_level: null, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null,
  submitted_at: null, converted_at: null, created_at: '2026-11-01T04:00:00Z', lines: [], ...overrides,
})

describe('requisition rules', () => {
  it('lets the requester edit and cancel own drafts, but not others', () => {
    const { me, can } = userWith(['purchases.request'])
    expect(mayEditRequisition(requisition(), me, can)).toBe(true)
    expect(mayEditRequisition(requisition({ requested_by: someoneElse }), me, can)).toBe(false)
    expect(mayEditRequisition(requisition({ status: 'submitted' }), me, can)).toBe(false)
    expect(mayCancelRequisition(requisition({ status: 'submitted' }), me, can)).toBe(true)
    expect(mayCancelRequisition(requisition({ status: 'approved' }), me, can)).toBe(false)
  })

  it('lets purchasing managers cancel approved requisitions until something is converted', () => {
    const { me, can } = userWith(['purchases.manage'])
    const line = { id: 'l-1', variant: null, quantity: '10.000', estimated_unit_cost: null, suggested_supplier: null, notes: null, converted_quantity: '0.000' }
    expect(mayCancelRequisition(requisition({ status: 'approved', requested_by: someoneElse, lines: [line] }), me, can)).toBe(true)
    expect(mayCancelRequisition(requisition({ status: 'approved', requested_by: someoneElse, lines: [{ ...line, converted_quantity: '4.000' }] }), me, can)).toBe(false)
  })

  it('computes the open quantity of a line exactly', () => {
    expect(remainingQuantity({ quantity: '10.500', converted_quantity: '4.250' })).toBe('6.25')
    expect(remainingQuantity({ quantity: '3.000', converted_quantity: '3.000' })).toBe('0')
  })

  it('builds a timeline from timestamps when no history is sent', () => {
    const entries = requisitionTimeline(requisition({ status: 'approved', submitted_at: '2026-11-01T05:00:00Z', approved_at: '2026-11-01T05:00:00Z', approval_level: 'none' }))
    expect(entries.map((e) => e.label)).toEqual(['Created', 'Submitted for approval', 'Approved automatically'])
    expect(entries[2]?.who).toBe('System')
  })
})

describe('costSourceLabel', () => {
  it('names where the estimated cost came from', () => {
    expect(costSourceLabel({ source: 'preferred_catalog', preferred_supplier: { id: 'sup-2', name: 'Fresh' } })).toBe('Preferred supplier Fresh')
    expect(costSourceLabel({ source: 'supplier_catalog', preferred_supplier: null }, 'Local Mills')).toBe('Local Mills catalog cost')
    expect(costSourceLabel({ source: 'last_cost', preferred_supplier: null })).toBe('Last purchase cost')
    expect(costSourceLabel({ source: 'variant_cost', preferred_supplier: null })).toBe('Product cost')
  })
})

describe('normalizeApprovals', () => {
  it('merges requisitions and purchase orders into one inbox', () => {
    const items = normalizeApprovals({
      requisitions: [{ id: 'pr-1', number: 'PR-000001', estimated_total: '25000.00', approval_level: 'manager', requested_by: someoneElse, submitted_at: '2026-11-01T05:00:00Z' }],
      purchase_orders: [{ id: 'po-1', number: 'PO-000003', total: '150000.00', approval_level: 'high', submitted_by: someoneElse, supplier: { id: 'sup-1', name: 'Local Mills' } }],
    })
    expect(items).toMatchObject([
      { kind: 'requisition', number: 'PR-000001', amount: '25000.00', level: 'manager', requested_by: someoneElse },
      { kind: 'purchase_order', number: 'PO-000003', amount: '150000.00', level: 'high', requested_by: someoneElse, supplier: { name: 'Local Mills' } },
    ])
  })

  it('reads a typed list as well', () => {
    expect(normalizeApprovals([{ type: 'purchase_order', id: 'po-1', number: 'PO-1', amount: '1.00' }])[0]?.kind).toBe('purchase_order')
  })
})

describe('comparison and award', () => {
  const rfq = {
    currency: 'BDT',
    lines: [
      { id: 'rl-1', variant: { id: 'v-1', sku: 'RICE', product_name: 'Rice', variant_name: null }, quantity: '100.000', requisition_line_id: null },
      { id: 'rl-2', variant: { id: 'v-2', sku: 'OIL', product_name: 'Oil', variant_name: null }, quantity: '20.000', requisition_line_id: null },
    ],
    suppliers: [
      { id: 'rs-1', supplier: { id: 'sup-1', name: 'Local Mills' }, invited_at: null, emailed_at: null, quote: null },
      { id: 'rs-2', supplier: { id: 'sup-2', name: 'Fresh Foods' }, invited_at: null, emailed_at: null, quote: null },
    ],
  }
  const raw = {
    lines: [
      { rfq_line_id: 'rl-1', quantity: '100.000', quotes: [
        { supplier_id: 'sup-1', unit_price: '60.0000', quantity_offered: '80.000', line_total: '6000.00', lead_time_days: 5, lowest_price: false, fastest: false, partial: true },
        { supplier_id: 'sup-2', unit_price: '58.0000', quantity_offered: null, line_total: '5800.00', lead_time_days: 2, lowest_price: true, fastest: true },
      ] },
      { rfq_line_id: 'rl-2', quantity: '20.000', quotes: [] },
    ],
    suppliers: [
      { supplier_id: 'sup-1', status: 'received', valid_until: '2026-11-30', lines_quoted: 1, lines_total: 2, total: '6000.00' },
      { supplier_id: 'sup-2', status: 'received', valid_until: null, lines_quoted: 1, lines_total: 2, total: '5800.00' },
    ],
  }

  it('fills products and supplier names from the RFQ', () => {
    const c = normalizeComparison(raw as never, rfq)
    expect(c.line_count).toBe(2)
    expect(c.lines[0]?.line.variant?.product_name).toBe('Rice')
    expect(c.suppliers.map((s) => s.supplier.name)).toEqual(['Local Mills', 'Fresh Foods'])
    expect(c.lines[0]?.quotes[0]?.partial).toBe(true)
  })

  it('awards each line to its lowest price by default, capped at the quantity offered', () => {
    const c = normalizeComparison(raw as never, rfq)
    expect(defaultAward(c)).toEqual({ 'rl-1': { supplierId: 'sup-2', quantity: '100' }, 'rl-2': { supplierId: null, quantity: '20' } })
    expect(defaultAwardQuantity('100.000', '80.000')).toBe('80')
    expect(defaultAwardQuantity('100.000', null)).toBe('100')
  })
})
