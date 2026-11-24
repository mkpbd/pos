import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { mergeItems, labelCount } from '@/features/labels/items'
import { expandLabels, labelLayout, LABEL_TEMPLATES, DEFAULT_FIELDS, paginate, perPage, templateById } from '@/features/labels/templates'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, info: vi.fn() }) }
})

const juice = {
  variant_id: 'v-1', product_name: 'Mango Juice 1L', variant_name: null, sku: 'JUICE-1L', barcode: '4006381333931', barcode_format: 'ean13',
  price: '120.00', currency: 'BDT', unit: 'pcs', quantity: '3.000', batch_number: 'MJ-2611', expires_on: '2027-01-31',
}
const rice = { variant_id: 'v-2', product_name: 'Miniket Rice', variant_name: '5 kg', sku: 'RICE-5', barcode: null, barcode_format: null, price: '450.00', currency: 'BDT', unit: 'kg', quantity: '40.500' }

const labelsUser = (extra: string[] = []) => makeCurrentUser({ permissions: ['branches.view', 'products.view', ...extra] })

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  window.localStorage.clear()
})

describe('label templates', () => {
  it('fits every sheet on its page', () => {
    for (const t of LABEL_TEMPLATES) {
      const width = t.margin.left + t.columns * t.label.width + (t.columns - 1) * t.gap.x
      const height = t.margin.top + t.rows * t.label.height + (t.rows - 1) * t.gap.y
      expect(width, t.id).toBeLessThanOrEqual(t.page.width)
      expect(height, t.id).toBeLessThanOrEqual(t.page.height)
    }
    expect(perPage(templateById('a4-3x8'))).toBe(24)
    expect(perPage(templateById('a4-4x10'))).toBe(40)
    expect(perPage(templateById('a4-5x13'))).toBe(65)
    expect(perPage(templateById('shelf-3x7'))).toBe(21)
    expect(perPage(templateById('roll-50x30'))).toBe(1)
    expect(templateById('nope').id).toBe('a4-3x8')
  })

  it('leaves a usable barcode box on the smallest label and a big price on shelf labels', () => {
    const small = labelLayout(templateById('a4-5x13'), { ...DEFAULT_FIELDS, sku: true })
    expect(small.barcodeHeight).toBeGreaterThanOrEqual(6)
    expect(small.barcodeWidth).toBeCloseTo(38.1 - 2.4)
    const shelf = labelLayout(templateById('shelf-3x7'), DEFAULT_FIELDS)
    expect(shelf.price).toBeGreaterThanOrEqual(8)
    expect(labelLayout(templateById('a4-3x8'), { ...DEFAULT_FIELDS, price: false }).price).toBe(0)
    // Every field on: the shelf price gives way so the barcode keeps 8 mm.
    const full = labelLayout(templateById('shelf-3x7'), { shop: true, product: true, variant: true, price: true, sku: true, digits: true, batch: true })
    expect(full.barcodeHeight).toBeGreaterThanOrEqual(7.5)
    expect(full.price).toBeGreaterThanOrEqual(5)
    expect(full.price).toBeLessThan(9)
  })

  it('expands quantities into labels, caps the total and pages them', () => {
    const labels = expandLabels([{ quantity: 30 }, { quantity: 0 }, { quantity: 5 }])
    expect(labels).toHaveLength(35)
    expect(paginate(labels, templateById('a4-3x8')).map((p) => p.length)).toEqual([24, 11])
    expect(expandLabels([{ quantity: 999 }, { quantity: 999 }, { quantity: 999 }])).toHaveLength(2000)
  })

  it('counts whole labels and merges repeated items', () => {
    expect(labelCount('3.000')).toBe(3)
    expect(labelCount('40.500')).toBe(1)
    expect(labelCount('0')).toBe(1)
    const items = mergeItems([], [juice as never, rice as never])
    expect(items.map((i) => i.quantity)).toEqual([3, 1])
    expect(mergeItems(items, [juice as never])[0]!.quantity).toBe(6)
  })
})

describe('LabelsPage', () => {
  it('loads a goods receipt from the URL with its received quantities and draws true-size barcodes', async () => {
    let query = ''
    mockApi({
      'GET /auth/me': ok(labelsUser()),
      'GET /products/labels': (_init, url) => {
        query = url.search
        return ok({ labels: [juice, rice], shop: { name: 'Corner Shop', currency: 'BDT' } })
      },
    })
    renderRoutes(routes, '/products/labels?goods_receipt_id=gr-1')

    const list = await screen.findByRole('list', { name: 'Label items' })
    expect(query).toBe('?goods_receipt_id=gr-1')
    expect(within(list).getByText('Mango Juice 1L')).toBeInTheDocument()
    expect(within(list).getByText('Miniket Rice — 5 kg')).toBeInTheDocument()
    expect(within(list).getByText('No barcode: SKU printed')).toBeInTheDocument()
    expect(screen.getByLabelText('Labels for Mango Juice 1L')).toHaveValue(3)
    // A received weight prints one label.
    expect(screen.getByLabelText('Labels for Miniket Rice — 5 kg')).toHaveValue(1)
    expect(screen.getByRole('button', { name: 'Print 4 labels' })).toBeEnabled()

    const preview = screen.getByRole('group', { name: 'Preview page 1' })
    expect([preview.style.width, preview.style.height]).toEqual(['210mm', '297mm'])
    const ean = within(preview).getAllByRole('img', { name: 'Barcode 4006381333931' })
    expect(ean).toHaveLength(3)
    expect(ean[0]).toHaveAttribute('data-format', 'ean13')
    // The SKU of the item without a barcode is drawn as Code 128.
    expect(within(preview).getByRole('img', { name: 'Barcode RICE-5' })).toHaveAttribute('data-format', 'code128')
    expect(within(preview).getAllByText('BDT 120.00')).toHaveLength(3)
    // No barcode generation without products.manage, no receipts without purchases.view.
    expect(screen.queryByRole('button', { name: /Create barcodes/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'From receipt or order' })).not.toBeInTheDocument()
  })

  it('creates in-store barcodes for items without one after confirming', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockApi({
      'GET /auth/me': ok(labelsUser(['products.manage'])),
      'GET /products/labels': ok({ labels: [juice, rice], shop: null }),
      'POST /products/barcodes/generate': (init) => {
        body = JSON.parse(String(init.body))
        return ok([{ variant_id: 'v-2', barcode: '2000000000015', generated: true }])
      },
    })
    renderRoutes(routes, '/products/labels?variant_ids=v-1,v-2')

    await user.click(await screen.findByRole('button', { name: 'Create barcodes for 1 item' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Create barcodes?' })
    expect(dialog).toHaveTextContent('1 product has no barcode')
    await user.click(within(dialog).getByRole('button', { name: 'Create barcodes' }))

    await waitFor(() => expect(body).toEqual({ variant_ids: ['v-2'] }))
    expect(await screen.findByText('2000000000015 · EAN-13')).toBeInTheDocument()
    expect(screen.queryByText('No barcode: SKU printed')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Barcode 2000000000015' })).toHaveAttribute('data-format', 'ean13')
    expect(toastSuccess).toHaveBeenCalledWith('1 barcode created.')
    expect(screen.queryByRole('button', { name: /Create barcodes for/ })).not.toBeInTheDocument()
  })

  it('adds a searched product, remembers the field choice and prints with the template page size', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pos.labels.settings', JSON.stringify({ template: 'roll-50x25', fields: { price: false } }))
    const print = vi.fn()
    vi.stubGlobal('print', print)
    let labelsQuery = ''
    mockApi({
      'GET /auth/me': ok(labelsUser()),
      'GET /products': ok([{
        id: 'p-1', name: 'Mango Juice 1L', type: 'standard', track_stock: true, track_batches: false, is_active: true,
        unit: { id: 'u', name: 'Piece', code: 'pcs', allow_decimal: false }, tax_rate: null,
        variants: [{ id: 'v-1', name: null, sku: 'JUICE-1L', option_values: {}, is_active: true }],
      }]),
      'GET /products/labels': (_init, url) => {
        labelsQuery = decodeURIComponent(url.search)
        return ok({ labels: [{ ...juice, quantity: 1, batch_number: null, expires_on: null }], shop: { name: 'Corner Shop', currency: 'BDT' } })
      },
    })
    renderRoutes(routes, '/products/labels')

    expect(await screen.findByText(/No items yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    // The remembered template and fields.
    expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveTextContent('Thermal roll 50 × 25 mm')
    expect(screen.getByRole('checkbox', { name: 'Price' })).not.toBeChecked()

    await user.click(screen.getByRole('combobox', { name: 'Add a product' }))
    await user.type(screen.getByPlaceholderText('Name, SKU or barcode'), 'mango')
    await user.click(await screen.findByRole('option', { name: /Mango Juice 1L/ }))
    expect(await screen.findByLabelText('Labels for Mango Juice 1L')).toHaveValue(1)
    expect(labelsQuery).toBe('?variant_ids[]=v-1')

    await user.click(screen.getByRole('checkbox', { name: 'Shop name' }))
    expect(JSON.parse(window.localStorage.getItem('pos.labels.settings')!)).toEqual({
      template: 'roll-50x25',
      fields: { ...DEFAULT_FIELDS, price: false, shop: true },
    })
    const preview = screen.getByRole('group', { name: 'Preview page 1' })
    expect([preview.style.width, preview.style.height]).toEqual(['50mm', '25mm'])
    expect(within(preview).getByText('Corner Shop')).toBeInTheDocument()
    expect(within(preview).queryByText('BDT 120.00')).not.toBeInTheDocument()

    const quantity = screen.getByLabelText('Labels for Mango Juice 1L')
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: 'Print 2 labels' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    // The print-only portal is gone again after the dialog.
    await waitFor(() => expect(document.querySelector('.print-root')).toBeNull())
  })

  it('renders the print portal with the @page size and one page per roll label', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pos.labels.settings', JSON.stringify({ template: 'roll-38x25' }))
    let printed: { rule: string; pages: number } | null = null
    vi.stubGlobal('print', () => {
      const root = document.querySelector('.print-root')
      printed = { rule: root?.querySelector('style')?.textContent ?? '', pages: root?.querySelectorAll('.label-page').length ?? 0 }
    })
    mockApi({
      'GET /auth/me': ok(labelsUser()),
      'GET /products/labels': ok({ labels: [juice], shop: null }),
    })
    renderRoutes(routes, '/products/labels?variant_ids=v-1')

    await user.click(await screen.findByRole('button', { name: 'Print 3 labels' }))
    await waitFor(() => expect(printed).not.toBeNull())
    expect(printed!.rule).toContain('@page { size: 38mm 25mm; margin: 0; }')
    expect(printed!.pages).toBe(3)
  })

  it('stops more than 2000 labels', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(labelsUser()),
      'GET /products/labels': ok({ labels: [juice, rice, { ...rice, variant_id: 'v-3', product_name: 'Basmati Rice', variant_name: null, sku: 'RICE-10' }], shop: null }),
    })
    renderRoutes(routes, '/products/labels?category_id=cat-1')

    for (const name of ['Labels for Mango Juice 1L', 'Labels for Miniket Rice — 5 kg']) {
      const input = await screen.findByLabelText(name)
      await user.clear(input)
      await user.type(input, '999')
    }
    const third = screen.getByLabelText('Labels for Basmati Rice')
    await user.clear(third)
    await user.type(third, '3')
    expect(await screen.findByRole('alert')).toHaveTextContent('At most 2000 labels')
    expect(screen.getByRole('button', { name: 'Print 2001 labels' })).toBeDisabled()
  })
})
