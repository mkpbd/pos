import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { SmsTemplates } from '@/features/sms/api'
import { defaultTemplates, paged, SMS_ADMIN, SMS_VIEWER, smsSettings } from '@/features/sms/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const templatesCard = async () => (await screen.findByRole('heading', { name: 'Message templates' })).closest('[data-slot=card]') as HTMLElement

describe('SMS → Message templates', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('counts SMS parts live, inserts placeholders at the cursor, resets and saves', async () => {
    const user = userEvent.setup()
    const patches: { templates: SmsTemplates }[] = []
    const saved = { ...defaultTemplates(), order_cancelled: { enabled: true, en: 'Cancelled {order}', bn: '' } }
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ templates: saved })),
      'GET /sms/messages': ok([], paged(0)),
      'PATCH /sms/settings': (init) => {
        const body = JSON.parse(String(init.body)) as { templates: SmsTemplates }
        patches.push(body)
        return ok(smsSettings({ templates: body.templates }))
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await templatesCard()
    const placed = within(card).getByTestId('template-order_placed')
    // Filled with example values: "Corner Shop: Order W-10025 received. Total Tk 1,250.00. Track: https://shop.example.com/track-order?number=W-10025"
    expect(within(placed).getByTestId('template-order_placed-en-count')).toHaveTextContent('114 characters · 1 SMS · GSM with example values')
    expect(within(placed).getByTestId('template-order_placed-bn-count')).toHaveTextContent(/· 2 SMS · Unicode/)
    expect(within(card).getByRole('switch', { name: 'Send “Payment received”' })).not.toBeChecked()

    const cancelled = within(card).getByTestId('template-order_cancelled')
    const en = within(cancelled).getByRole('textbox', { name: 'English text for “Order cancelled”' })
    expect(en).toHaveValue('Cancelled {order}')
    expect(within(cancelled).getByTestId('template-order_cancelled-bn-count')).toHaveTextContent('Uses the English text.')
    // Put the caret after "Cancelled " and insert {shop}.
    await user.click(en)
    ;(en as HTMLTextAreaElement).setSelectionRange(10, 10)
    await user.click(within(cancelled).getByRole('button', { name: 'Insert {shop} into the English text of “Order cancelled”' }))
    expect(en).toHaveValue('Cancelled {shop}{order}')

    // The chips follow the last focused text area.
    const bn = within(cancelled).getByRole('textbox', { name: 'Bangla text for “Order cancelled”' })
    fireEvent.focus(bn)
    await user.click(within(cancelled).getByRole('button', { name: 'Insert {order} into the Bangla text of “Order cancelled”' }))
    expect(bn).toHaveValue('{order}')

    await user.click(within(cancelled).getByRole('button', { name: 'Reset “Order cancelled” to default' }))
    expect(en).toHaveValue(defaultTemplates().order_cancelled.en)
    expect(bn).toHaveValue(defaultTemplates().order_cancelled.bn)
    expect(within(cancelled).getByRole('button', { name: 'Reset “Order cancelled” to default' })).toBeDisabled()

    await user.click(within(card).getByRole('switch', { name: 'Send “Payment received”' }))
    await user.click(within(card).getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ templates: { ...defaultTemplates(), order_confirmed: { ...defaultTemplates().order_confirmed, enabled: true } } })
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Save templates' })).toBeDisabled())
  })

  it('needs English text for a switched-on message and shows server errors per text area', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
      'PATCH /sms/settings': (init) => {
        patches.push(JSON.parse(String(init.body)))
        return fail(422, 'VALIDATION_FAILED', 'Invalid', { 'templates.order_shipped.bn': ['The text may not be longer than 480 characters.'] })
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await templatesCard()
    const shipped = within(card).getByTestId('template-order_shipped')
    await user.clear(within(shipped).getByRole('textbox', { name: 'English text for “Order shipped”' }))
    await user.click(within(card).getByRole('button', { name: 'Save templates' }))
    expect(within(shipped).getByText('Write the English text, or switch this message off.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.type(within(shipped).getByRole('textbox', { name: 'English text for “Order shipped”' }), 'Shipped {order}')
    await user.click(within(card).getByRole('button', { name: 'Save templates' }))
    expect(await within(shipped).findByText('The text may not be longer than 480 characters.')).toBeInTheDocument()
    expect(within(shipped).getByRole('textbox', { name: 'Bangla text for “Order shipped”' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('is read-only for sms.view', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_VIEWER()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    const card = await templatesCard()
    expect(within(card).getByRole('textbox', { name: 'English text for “Order placed”' })).toHaveAttribute('readonly')
    expect(within(card).getByRole('switch', { name: 'Send “Order placed”' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: /Insert/ })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
  })
})
