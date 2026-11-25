import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { Sale, SaleLine } from '@/features/sales/api'
import { promotionKindLabel } from '@/features/sales/promotion-kind'
import { salesManager } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const line = (overrides: Partial<SaleLine> = {}): SaleLine => ({
  id: 'sl-1', variant_id: 'v-1', product_name: 'Mango Juice', variant_name: null, sku: 'JUICE', unit_code: 'pcs', quantity: '1.000', unit_price: '90.00', discount: null,
  line_subtotal: '90.00', discount_amount: '0.00', invoice_discount_share: '0.00', net_amount: '90.00', tax_rate: '0.0000', tax_amount: '0.00', line_total: '90.00',
  unit_cost: null, batches: [], serials: [], returned_serials: [], returned_quantity: '0.000', pending_return_quantity: '0.000',
  list_price: '90.00', price_source: 'catalog', price_approved_by: null, promotion: null, promotion_discount: '0.00',
  ...overrides,
})

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 'sa-1', number: 'INV-MAIN-000042', status: 'completed', sold_at: '2026-11-25T06:00:00Z',
  store: { id: 's-1', code: 'FLOOR', name: 'Shop floor' }, branch: { id: 'b-1', name: 'Main Branch' }, customer: null, cashier: { id: 'u-4', name: 'Pos Cashier' },
  tax_mode: 'exclusive', currency: 'BDT', subtotal: '400.00', item_discount_total: '20.00', invoice_discount_total: '30.00', tax_total: '0.00', total: '350.00',
  paid_total: '350.00', change_total: '0.00', due_total: '0.00', cancelled_at: null, cancelled_by: null, cancellation_reason: null,
  notes: null, invoice_discount: null, cost_total: null, payments: [], returns: [],
  lines: [
    line({ id: 'sl-1', product_name: 'Mango Juice', unit_price: '80.00', list_price: '100.00', price_source: 'override', price_approved_by: { id: 'u-9', name: 'Nadia Manager' } }),
    line({ id: 'sl-2', product_name: 'Repair', unit_price: '150.00', list_price: null, price_source: 'open' }),
    line({ id: 'sl-3', product_name: 'Soap', unit_price: '45.00', list_price: '50.00', price_source: 'override' }),
    line({ id: 'sl-4', product_name: 'Pran juice', unit_price: '100.00', list_price: '100.00', promotion: { name: 'Juice week', amount: '20.00' }, promotion_discount: '20.00' }),
  ],
  promotions: [{ name: 'Juice week', kind: 'product', amount: '20.00' }, { name: 'WELCOME50', kind: 'order', amount: '30.00' }],
  coupon_code: 'WELCOME50',
  savings_total: '75.00',
  discount_approved_by: { id: 'u-9', name: 'Nadia Manager' },
  receipt: { organization_name: 'Corner Shop', header: null, footer: null, branch: null, timezone: 'Asia/Dhaka' },
  ...overrides,
})

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('sale detail prices, promotions and approvals (POS1a)', () => {
  it('shows list → charged prices with who changed or approved them, and the sale’s offers', async () => {
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-1': ok(sale()) })
    renderRoutes(routes, '/sales/sa-1')

    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000042' })).toBeInTheDocument()
    const mango = row('Mango Juice')
    expect(within(mango).getByLabelText('List price 100.00')).toHaveTextContent('100.00')
    expect(within(mango).getByText('80.00')).toBeInTheDocument()
    expect(within(mango).getByText('Approved by Nadia Manager')).toBeInTheDocument()
    expect(within(row('Soap')).getByText('Changed by Pos Cashier')).toBeInTheDocument()
    expect(within(row('Repair')).getByText('Open price')).toBeInTheDocument()
    expect(within(row('Pran juice')).getByText('Juice week −20.00')).toBeInTheDocument()
    expect(within(row('Pran juice')).queryByTestId('line-price-override')).not.toBeInTheDocument()

    const promotions = screen.getByRole('list', { name: 'Promotions' })
    expect(within(promotions).getByText('Item offer')).toBeInTheDocument()
    expect(within(promotions).getByText('Order offer')).toBeInTheDocument()
    expect(screen.getByTestId('sale-coupon')).toHaveTextContent('Coupon WELCOME50')
    expect(screen.getByText('Discount approved by Nadia Manager')).toBeInTheDocument()
    expect(screen.getByTestId('sale-savings')).toHaveTextContent('Customer savedBDT 75.00')
  })

  it('renders sales from before POS1a as before', async () => {
    const old = sale({ promotions: undefined, coupon_code: undefined, savings_total: undefined, discount_approved_by: undefined, lines: [line({ list_price: undefined, price_source: undefined, price_approved_by: undefined, promotion: undefined })] })
    mockApi({ 'GET /auth/me': ok(salesManager()), 'GET /sales/sa-1': ok(old) })
    renderRoutes(routes, '/sales/sa-1')

    expect(await screen.findByRole('heading', { name: 'INV-MAIN-000042' })).toBeInTheDocument()
    expect(within(row('Mango Juice')).queryByTestId('line-price-override')).not.toBeInTheDocument()
    expect(within(row('Mango Juice')).queryByText('Open price')).not.toBeInTheDocument()
    expect(screen.queryByText('Offers & approvals')).not.toBeInTheDocument()
  })

  it('labels promotion kinds', () => {
    expect(promotionKindLabel('coupon')).toBe('Coupon')
    expect(promotionKindLabel('customer_group')).toBe('Customer group')
  })
})
