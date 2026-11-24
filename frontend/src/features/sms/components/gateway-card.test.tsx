import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { paged, SMS_ADMIN, SMS_VIEWER, smsSettings } from '@/features/sms/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const gateway = async () => (await screen.findByRole('heading', { name: 'Gateway' })).closest('[data-slot=card]') as HTMLElement

describe('SMS → Gateway', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=t'
  })

  it('sets up an HTTP gateway and sends only the changed fields, the API key write-only', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = smsSettings()
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': () => ok(current),
      'GET /sms/messages': ok([], paged(0)),
      'PATCH /sms/settings': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        const { api_key, ...rest } = body
        current = { ...current, ...rest, api_key_set: typeof api_key === 'string', ready: true, otp_ready: true } as typeof current
        return ok(current)
      },
    })
    renderRoutes(routes, '/settings/sms')

    expect(await screen.findByTestId('sms-usage')).toHaveTextContent('This month: 1,234 sent, 5 failed, 1,502 SMS parts')
    const card = await gateway()
    expect(within(card).getByTestId('sms-ready')).toHaveTextContent('Not sending')
    expect(within(card).getByTestId('sms-ready')).toHaveTextContent('SMS is switched off')
    const save = within(card).getByRole('button', { name: 'Save gateway settings' })
    expect(save).toBeDisabled()
    // Test mode hides the HTTP fields.
    expect(within(card).queryByLabelText('Gateway address')).not.toBeInTheDocument()

    await user.click(within(card).getByRole('switch', { name: 'Send SMS' }))
    await user.click(within(card).getByRole('radio', { name: 'HTTP SMS gateway' }))
    await user.click(save)
    expect(within(card).getByText('Enter your SMS provider’s address to use the HTTP gateway.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.type(within(card).getByLabelText('Gateway address'), 'https://sms.example.com.bd/api/send')
    await user.clear(within(card).getByLabelText('Phone number parameter'))
    await user.type(within(card).getByLabelText('Phone number parameter'), 'msisdn')
    await user.type(within(card).getByLabelText('API key parameter'), 'api key')
    expect(within(card).getByLabelText('API key')).toHaveAttribute('type', 'password')
    await user.type(within(card).getByLabelText('API key'), 'secret-123')
    await user.type(within(card).getByLabelText('Sender ID'), 'CORNER')
    await user.click(within(card).getByRole('radio', { name: /Local 01712345678/ }))
    expect(within(card).getByText('+8801712345678')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Add parameter' }))
    await user.type(within(card).getByLabelText('Extra parameter 1 name'), 'type')
    await user.type(within(card).getByLabelText('Extra parameter 1 value'), 'text')
    await user.type(within(card).getByLabelText('Monthly limit (messages)'), '5000')
    await user.click(save)
    expect(within(card).getByLabelText('API key parameter')).toHaveAccessibleDescription(/Letters, digits/)
    expect(patches).toHaveLength(0)

    await user.clear(within(card).getByLabelText('API key parameter'))
    await user.type(within(card).getByLabelText('API key parameter'), 'api_key')
    await user.click(save)
    await waitFor(() =>
      expect(patches).toEqual([
        {
          is_enabled: true,
          driver: 'http',
          http_url: 'https://sms.example.com.bd/api/send',
          param_to: 'msisdn',
          param_api_key: 'api_key',
          sender_id: 'CORNER',
          extra_params: { type: 'text' },
          phone_format: 'local',
          monthly_limit: 5000,
          api_key: 'secret-123',
        },
      ]),
    )
    // Saved: the key field is empty again, with a "Saved" badge; the state says it is sending.
    await waitFor(() => expect(within(card).getByTestId('sms-ready')).toHaveTextContent('Sending'))
    expect(within(card).getByText('Saved')).toBeInTheDocument()
    expect(within(card).getByLabelText('API key')).toHaveValue('')
    expect(within(card).getByLabelText('API key')).toHaveAttribute('placeholder', 'Type a new key to replace it')
    expect(save).toBeDisabled()
  })

  it('removes the saved API key after asking, and shows server field errors', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    let current = smsSettings({ is_enabled: true, driver: 'http', http_url: 'https://sms.example.com/send', api_key_set: true, param_api_key: 'api_key', ready: true, otp_ready: true })
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': () => ok(current),
      'GET /sms/messages': ok([], paged(0)),
      'PATCH /sms/settings': (init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push(body)
        if ('http_url' in body) return fail(422, 'VALIDATION_FAILED', 'Invalid', { http_url: ['The gateway address must use https.'] })
        current = { ...current, api_key_set: false }
        return ok(current)
      },
    })
    renderRoutes(routes, '/settings/sms')

    const card = await gateway()
    expect(within(card).getByLabelText('API key')).toHaveValue('')
    await user.click(within(card).getByRole('button', { name: 'Remove' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove the saved API key?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove key' }))
    await waitFor(() => expect(patches).toEqual([{ api_key: null }]))
    await waitFor(() => expect(within(card).queryByText('Saved')).not.toBeInTheDocument())

    const url = within(card).getByLabelText('Gateway address')
    await user.clear(url)
    await user.type(url, 'http://sms.example.com/send')
    await user.click(within(card).getByRole('button', { name: 'Save gateway settings' }))
    expect(await within(card).findByText('The gateway address must use https.')).toBeInTheDocument()
    expect(patches[1]).toEqual({ http_url: 'http://sms.example.com/send' })
  })

  it('explains that test mode cannot send codes on a live server', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_ADMIN()),
      'GET /sms/settings': ok(smsSettings({ is_enabled: true, ready: true, otp_ready: false })),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    const state = within(await gateway()).getByTestId('sms-ready')
    expect(state).toHaveTextContent('Test mode')
    expect(state).toHaveTextContent('Codes cannot be sent')
    expect(state).toHaveTextContent('cannot be sent in test mode on a live server')
  })

  it('is read-only for sms.view, listed in the menu, and missing without sms.view', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_VIEWER()),
      'GET /sms/settings': ok(smsSettings({ is_enabled: true, driver: 'http', http_url: 'https://sms.example.com/send', api_key_set: true, ready: true, otp_ready: true })),
      'GET /sms/messages': ok([], paged(0)),
    })
    const { unmount } = renderRoutes(routes, '/settings/sms')
    const card = await gateway()
    expect(screen.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', '/settings/sms')
    expect(within(card).getByLabelText('Gateway address')).toBeDisabled()
    expect(within(card).getByRole('switch', { name: 'Send SMS' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: 'Save gateway settings' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(within(card).getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Send a test SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save templates' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Message log' })).toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(makeCurrentUser()) })
    renderRoutes(routes, '/settings/sms')
    expect(await screen.findByText(/“sms.view” permission/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SMS' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Gateway' })).not.toBeInTheDocument()
  })
})
