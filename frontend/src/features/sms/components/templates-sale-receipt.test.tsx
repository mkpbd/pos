import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { SmsTemplates } from '@/features/sms/api'
import { defaultTemplates, paged, SMS_ADMIN, smsMessage, smsSettings } from '@/features/sms/test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/* POS1d §4: Settings → SMS lists the "Sale receipt" template (when the server has it) with its own placeholders. */

const saleReceipt = { enabled: true, en: '{shop}: Receipt {invoice}, total Tk {total}. {link}', bn: '{shop}: রসিদ {invoice}, মোট ৳{total}। {link}' }
const withReceipt = (): SmsTemplates => ({ ...defaultTemplates(), sale_receipt: saleReceipt })
const PLACEHOLDERS = ['shop', 'name', 'order', 'invoice', 'total', 'link', 'courier', 'tracking', 'tracking_link']

const templatesCard = async () => (await screen.findByRole('heading', { name: 'Message templates' })).closest('[data-slot=card]') as HTMLElement

describe('SMS → Sale receipt template', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('shows the sale receipt with {invoice}, previews it and saves it with the others', async () => {
    const user = userEvent.setup()
    const patches: { templates: SmsTemplates }[] = []
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ templates: withReceipt(), default_templates: withReceipt(), placeholders: PLACEHOLDERS })),
      'GET /sms/messages': ok([smsMessage({ purpose: 'sale_receipt', related: { type: 'sale', id: 'sa-1' } })], paged(1)),
      'PATCH /sms/settings': (init) => {
        const body = JSON.parse(String(init.body)) as { templates: SmsTemplates }
        patches.push(body)
        return ok(smsSettings({ templates: body.templates, default_templates: withReceipt(), placeholders: PLACEHOLDERS }))
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await templatesCard()
    const receipt = within(card).getByTestId('template-sale_receipt')
    expect(within(receipt).getByRole('heading', { name: 'Sale receipt' })).toBeInTheDocument()
    expect(within(receipt).getByRole('switch', { name: 'Send “Sale receipt”' })).toBeChecked()
    // Its chips: shop, name, invoice, total, link — no order or courier.
    const chips = within(receipt).getAllByRole('button', { name: /^Insert \{/ }).map((b) => b.textContent)
    expect(chips).toEqual(['{shop}', '{name}', '{invoice}', '{total}', '{link}'])
    // The order templates do not offer {invoice}.
    expect(within(within(card).getByTestId('template-order_placed')).queryByRole('button', { name: /Insert \{invoice\}/ })).not.toBeInTheDocument()
    // "Corner Shop: Receipt INV-MAIN-000123, total Tk 1,250.00. https://shop.example.com/receipt/k3Jx9QaZ"
    expect(within(receipt).getByTestId('template-sale_receipt-en-count')).toHaveTextContent('98 characters · 1 SMS · GSM with example values')

    await user.click(within(receipt).getByRole('switch', { name: 'Send “Sale receipt”' }))
    await user.click(within(card).getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]?.templates.sale_receipt).toEqual({ ...saleReceipt, enabled: false })
    expect(patches[0]?.templates.order_placed).toEqual(defaultTemplates().order_placed)
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Save templates' })).toBeDisabled())

    // The message log names the purpose.
    expect(await screen.findByText('Sale receipt', { selector: 'td *, td' })).toBeInTheDocument()
  })

  it('shows only the order templates when the server has no sale receipt template', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    const card = await templatesCard()
    expect(within(card).getByTestId('template-order_cancelled')).toBeInTheDocument()
    expect(within(card).queryByTestId('template-sale_receipt')).not.toBeInTheDocument()
  })
})
