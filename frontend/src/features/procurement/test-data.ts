/**
 * Fixtures for procurement (SC2) page tests. Imported by tests only.
 */
import { makeCurrentUser } from '@/test/fixtures'

export const store = { id: 's-1', code: 'FLOOR', name: 'Shop floor', branch_id: 'b-1', branch_name: 'Main Branch' }
export const mills = { id: 'sup-1', code: 'SUP-000001', name: 'Local Mills', email: 'sales@mills.test' }
export const fresh = { id: 'sup-2', code: 'SUP-000002', name: 'Fresh Foods', email: null }
export const supplierRows = [
  { ...mills, contact_person: null, phone: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null },
  { ...fresh, contact_person: null, phone: null, address: null, tax_number: null, payment_terms_days: 0, opening_balance: '0.00', notes: null, is_active: true, archived_at: null },
]

export const riceVariant = { id: 'v-2', product_name: 'Miniket Rice', variant_name: null, sku: 'RICE-KG', unit_code: 'kg', allow_decimal: true }
export const juiceVariant = { id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', unit_code: 'pcs', allow_decimal: false }

export const staff = { id: 'u-7', name: 'Shila Staff' }
export const managerRef = { id: 'u-8', name: 'Babul Manager' }

/** Branch staff who may only raise requisitions. */
export const requester = () =>
  makeCurrentUser({
    user: { id: 'u-7', name: 'Shila Staff', email: 'shila@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }],
    permissions: ['branches.view', 'products.view', 'purchases.request'],
    branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  })

/** Branch manager: sees and approves manager-level documents, runs purchasing. */
export const manager = () =>
  makeCurrentUser({
    user: { id: 'u-8', name: 'Babul Manager', email: 'babul@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    roles: [{ id: 'r-2', name: 'Branch Manager', system_key: 'branch_manager' }],
    permissions: ['branches.view', 'products.view', 'products.view_cost', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.request', 'purchases.approve'],
  })

/** Owner: high-value approver and purchasing settings. */
export const owner = () =>
  makeCurrentUser({
    user: { id: 'u-9', name: 'Owner Person', email: 'owner@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    permissions: ['branches.view', 'products.view', 'suppliers.view', 'purchases.view', 'purchases.manage', 'purchases.approve', 'purchases.approve_high', 'purchases.settings'],
  })

export const requisitionLine = (overrides: Record<string, unknown> = {}) => ({
  id: 'prl-1', variant: riceVariant, quantity: '100.000', estimated_unit_cost: '60.0000', estimated_total: '6000.00', suggested_supplier: { id: mills.id, name: mills.name },
  notes: null, converted_quantity: '0.000', ...overrides,
})

export const requisition = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1', number: 'PR-000004', status: 'submitted', branch: { id: 'b-1', name: 'Main Branch' }, store, requested_by: staff, needed_by: '2026-11-20', notes: 'Weekend promotion',
  currency: 'BDT', estimated_total: '25000.00', approval_level: 'manager', approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, rejection_reason: null,
  submitted_at: '2026-11-06T04:00:00Z', converted_at: null, created_at: '2026-11-06T03:30:00Z',
  lines: [requisitionLine(), requisitionLine({ id: 'prl-2', variant: juiceVariant, quantity: '48.000', estimated_unit_cost: '18.0000', suggested_supplier: null })],
  history: [
    { status: 'draft', at: '2026-11-06T03:30:00Z', user: staff, note: null },
    { status: 'submitted', at: '2026-11-06T04:00:00Z', user: staff, note: null },
  ],
  purchase_orders: [],
  rfqs: [],
  ...overrides,
})

export const purchaseOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'po-7', number: 'PO-000007', status: 'pending_approval', supplier: { id: mills.id, code: mills.code, name: mills.name }, store, currency: 'BDT',
  subtotal: '150000.00', tax_total: '0.00', total: '150000.00', notes: null, created_at: '2026-11-06T05:00:00Z', order_date: '2026-11-06', expected_date: null, ordered_at: null,
  approval_level: 'high', pre_approved: false, requisition: null, rfq: null, created_by: managerRef, submitted_by: managerRef, submitted_at: '2026-11-06T05:10:00Z',
  lines: [{ id: 'pol-1', variant: { ...riceVariant, track_batches: false }, quantity: '2500.000', received_quantity: '0.000', unit_cost: '60.0000', tax_rate: '0.0000', line_subtotal: '150000.00', line_tax: '0.00', line_total: '150000.00' }],
  ...overrides,
})

export const rfqLines = [
  { id: 'rl-1', variant: riceVariant, quantity: '100.000', requisition_line_id: null },
  { id: 'rl-2', variant: juiceVariant, quantity: '48.000', requisition_line_id: null },
]

export const rfq = (overrides: Record<string, unknown> = {}) => ({
  id: 'rfq-1', number: 'RFQ-000002', status: 'sent', title: 'Rice and juice for November', store, requisition: null, needed_by: '2026-11-25', reply_by: '2026-11-12',
  notes: null, currency: 'BDT', sent_at: '2026-11-06T06:00:00Z', closed_at: null, awarded_at: null, created_by: managerRef, created_at: '2026-11-06T05:30:00Z',
  lines: rfqLines,
  suppliers: [
    { id: 'rs-1', supplier: mills, invited_at: '2026-11-06T05:30:00Z', emailed_at: '2026-11-06T06:00:00Z', quote: { id: 'q-1', status: 'received', received_at: '2026-11-07T06:00:00Z', valid_until: '2026-11-30', notes: null, lines: [
      { rfq_line_id: 'rl-1', unit_price: '60.0000', quantity_offered: '100.000', lead_time_days: 5, notes: null },
      { rfq_line_id: 'rl-2', unit_price: '19.0000', quantity_offered: '48.000', lead_time_days: 5, notes: null },
    ] } },
    { id: 'rs-2', supplier: fresh, invited_at: '2026-11-06T05:30:00Z', emailed_at: null, quote: null },
  ],
  purchase_orders: [],
  ...overrides,
})

export const comparison = {
  lines: [
    { rfq_line_id: 'rl-1', quantity: '100.000', quotes: [
      { supplier_id: 'sup-1', unit_price: '60.0000', quantity_offered: '100.000', line_total: '6000.00', lead_time_days: 5, valid_until: '2026-11-30', lowest_price: false, fastest: false, expired: false, partial: false },
      { supplier_id: 'sup-2', unit_price: '57.5000', quantity_offered: '100.000', line_total: '5750.00', lead_time_days: 2, valid_until: null, lowest_price: true, fastest: true, expired: false, partial: false },
    ] },
    { rfq_line_id: 'rl-2', quantity: '48.000', quotes: [
      { supplier_id: 'sup-1', unit_price: '19.0000', quantity_offered: '48.000', line_total: '912.00', lead_time_days: 5, valid_until: '2026-11-30', lowest_price: true, fastest: true, expired: false, partial: false },
    ] },
  ],
  suppliers: [
    { supplier_id: 'sup-1', status: 'received', valid_until: '2026-11-30', expired: false, lines_quoted: 2, lines_total: 2, coverage_percent: 100, complete: true, total: '6912.00' },
    { supplier_id: 'sup-2', status: 'received', valid_until: null, expired: false, lines_quoted: 1, lines_total: 2, coverage_percent: 50, complete: false, total: '5750.00' },
  ],
}
