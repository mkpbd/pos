import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { paged, SMS_ADMIN, smsSettings } from '@/features/sms/test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const testCard = async () => (await screen.findByRole('heading', { name: 'Send a test SMS' })).closest('[data-slot=card]') as HTMLElement

describe('SMS → Send a test SMS', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('checks the number, sends a normalised phone and shows the provider’s answer', async () => {
    const user = userEvent.setup()
    const sent: unknown[] = []
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ is_enabled: true, driver: 'http', http_url: 'https://sms.example.com/send', ready: true, otp_ready: true })),
      'GET /sms/messages': ok([], paged(0)),
      'POST /sms/test': (init) => {
        const body = JSON.parse(String(init.body)) as { message?: string }
        sent.push(body)
        return body.message
          ? ok({ status: 'failed', error: 'Provider answered 401', provider_status: 401, provider_response: '{"error":"invalid key"}', segments: 2, encoding: 'unicode' })
          : ok({ status: 'sent', error: null, provider_status: 200, provider_response: 'SUCCESS 1000', segments: 1, encoding: 'gsm' })
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await testCard()
    const phone = within(card).getByLabelText('Mobile number')
    await user.type(phone, '1234')
    await user.click(within(card).getByRole('button', { name: 'Send test SMS' }))
    expect(within(card).getByText('Enter a Bangladeshi mobile number, e.g. 01712345678.')).toBeInTheDocument()
    expect(sent).toHaveLength(0)

    await user.clear(phone)
    await user.type(phone, '+880 1712-345678')
    expect(within(card).getByTestId('sms-test-counter')).toHaveTextContent('Leave empty to send the default test message.')
    await user.click(within(card).getByRole('button', { name: 'Send test SMS' }))
    const result = await within(card).findByRole('region', { name: 'Test result' })
    expect(sent).toEqual([{ phone: '01712345678' }])
    expect(within(result).getByText('Sent')).toBeInTheDocument()
    expect(result).toHaveTextContent('1 SMS · GSM')
    expect(result).toHaveTextContent('200')
    expect(result).toHaveTextContent('SUCCESS 1000')

    await user.type(within(card).getByLabelText('Message'), 'আপনার কোড')
    expect(within(card).getByTestId('sms-test-counter')).toHaveTextContent('9 characters · 1 SMS · Unicode')
    await user.click(within(card).getByRole('button', { name: 'Send test SMS' }))
    await waitFor(() => expect(within(card).getByText('Failed')).toBeInTheDocument())
    expect(sent[1]).toEqual({ phone: '01712345678', message: 'আপনার কোড' })
    expect(within(card).getByText('Provider answered 401')).toBeInTheDocument()
    expect(within(card).getByRole('region', { name: 'Test result' })).toHaveTextContent('2 SMS · Unicode')
  })

  it('shows SMS_UNAVAILABLE in plain words and is disabled while SMS is not ready', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ is_enabled: true, ready: true, otp_ready: true })),
      'GET /sms/messages': ok([], paged(0)),
      'POST /sms/test': fail(422, 'SMS_UNAVAILABLE', 'SMS is not configured.'),
    })
    const { unmount } = renderRoutes(routes, '/settings/sms')
    const card = await testCard()
    await user.type(within(card).getByLabelText('Mobile number'), '01712345678')
    await user.click(within(card).getByRole('button', { name: 'Send test SMS' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('SMS is not ready: switch it on and choose a gateway, then save.')
    unmount()

    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    const offCard = await testCard()
    expect(within(offCard).getByText('Switch SMS on and choose a gateway first.')).toBeInTheDocument()
    expect(within(offCard).getByRole('button', { name: 'Send test SMS' })).toBeDisabled()
  })
})
