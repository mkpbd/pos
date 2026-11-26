import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SendReceiptDialog } from '@/features/sales/components/send-receipt-dialog'
import { fail, mockApi, ok, renderWithQuery } from '@/test/utils'

/* POS1d §4: send a sale's receipt by SMS / e-mail and copy its public link. */

const LINK = { url: 'https://berry.example.com/receipt/AbCdEfGhIjKlMnOpQrStUvWxYz012345', token: 'AbCdEfGhIjKlMnOpQrStUvWxYz012345' }

function body(init: RequestInit) {
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('SendReceiptDialog', () => {
  it('sends by SMS to the customer’s phone, then by e-mail to a typed address, and copies the link', async () => {
    const user = userEvent.setup()
    const sent: Record<string, unknown>[] = []
    mockApi({
      'GET /sales/sa-1/receipt-link': ok(LINK),
      'POST /sales/sa-1/receipt/send': (init) => {
        const input = body(init)
        sent.push(input)
        return ok({ channel: input.channel, recipient_masked: input.channel === 'sms' ? '017••••678' : 'ra•••@gmail.com', status: 'queued' })
      },
    })
    const onOpenChange = vi.fn()
    renderWithQuery(<SendReceiptDialog saleId="sa-1" customer={{ phone: '01712345678', email: null }} open onOpenChange={onOpenChange} />)

    const dialog = await screen.findByRole('dialog', { name: 'Send receipt' })
    expect(within(dialog).getByRole('radio', { name: 'SMS' })).toBeChecked()
    expect(within(dialog).getByLabelText('Mobile number')).toHaveValue('01712345678')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent to 017••••678')
    expect(sent).toEqual([{ channel: 'sms', to: '01712345678' }])

    await user.click(within(dialog).getByRole('radio', { name: 'E-mail' }))
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    const email = within(dialog).getByLabelText('E-mail address')
    expect(email).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(within(dialog).getByText('Enter the e-mail address to send the receipt to.')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    await user.type(email, 'rahim@gmail.com')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent to ra•••@gmail.com')
    expect(sent[1]).toEqual({ channel: 'email', to: 'rahim@gmail.com' })

    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(LINK.url))

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('starts on e-mail when the customer has only an e-mail, and hides "Copy link" without a shop address', async () => {
    const fetchCalls = mockApi({ 'GET /sales/sa-1/receipt-link': ok({ url: null, token: 'tok' }) })
    renderWithQuery(<SendReceiptDialog saleId="sa-1" customer={{ phone: null, email: 'rahim@gmail.com' }} open onOpenChange={() => {}} />)

    const dialog = await screen.findByRole('dialog', { name: 'Send receipt' })
    expect(within(dialog).getByRole('radio', { name: 'E-mail' })).toBeChecked()
    expect(within(dialog).getByLabelText('E-mail address')).toHaveValue('rahim@gmail.com')
    await waitFor(() => expect(fetchCalls).toHaveBeenCalled())
    expect(within(dialog).queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it.each([
    ['SMS_NOT_READY', 422, 'SMS is not set up — Settings → SMS.'],
    ['RECEIPT_SEND_LIMIT', 422, 'This receipt has already been sent as many times as allowed.'],
    ['SMS_TEMPLATE_OFF', 422, 'The “Sale receipt” SMS is switched off — Settings → SMS.'],
    ['TOO_MANY_REQUESTS', 429, 'Too many receipts sent just now. Wait a minute and try again.'],
  ])('explains %s', async (code, status, message) => {
    const user = userEvent.setup()
    mockApi({
      'GET /sales/sa-1/receipt-link': ok(LINK),
      'POST /sales/sa-1/receipt/send': fail(status, code, 'Server text'),
    })
    renderWithQuery(<SendReceiptDialog saleId="sa-1" customer={{ phone: '01712345678', email: null }} open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Send receipt' })
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
  })

  it('shows the server’s validation message under the recipient; a walk-in sale starts empty', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /sales/sa-1/receipt-link': ok(LINK),
      'POST /sales/sa-1/receipt/send': fail(422, 'VALIDATION_FAILED', 'Invalid', { to: ['Enter a Bangladeshi mobile number, e.g. 01712345678.'] }),
    })
    renderWithQuery(<SendReceiptDialog saleId="sa-1" customer={null} open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Send receipt' })
    const phone = within(dialog).getByLabelText('Mobile number')
    expect(phone).toHaveValue('')
    await user.type(phone, '12345')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(phone).toHaveAccessibleDescription('Enter a Bangladeshi mobile number, e.g. 01712345678.'))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })
})
