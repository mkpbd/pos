import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { TrackingSettings } from '@/features/marketing/tracking-api'
import { trackingChanges, toTrackingDraft, validateTracking } from '@/features/marketing/tracking'
import { marketingManager, marketingViewer } from '@/features/marketing/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const tracking = (overrides: Partial<TrackingSettings> = {}): TrackingSettings => ({
  meta_pixel_id: null,
  meta_capi_enabled: false,
  meta_capi_token_set: false,
  meta_test_event_code: null,
  ga4_measurement_id: null,
  tiktok_pixel_id: null,
  head_code: null,
  body_code: null,
  capi_last_status: null,
  capi_last_error: null,
  capi_last_sent_at: null,
  can_edit_code: true,
  ...overrides,
})

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

describe('BD1c Marketing → Tracking & pixels', () => {
  it('saves the pixel IDs, a write-only token and the pasted code', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = tracking()
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/tracking': () => ok(current),
      'PATCH /marketing/tracking': (init) => {
        const body = bodyOf(init)
        patches.push(body)
        const { meta_capi_token: token, ...rest } = body
        current = { ...current, ...(rest as Partial<TrackingSettings>), ...(token === undefined ? {} : { meta_capi_token_set: typeof token === 'string' && token !== '' }) }
        return ok(current)
      },
    })
    renderRoutes(routes, '/marketing/tracking')

    const form = await screen.findByRole('form', { name: 'Tracking settings' })
    expect(screen.getByRole('navigation', { name: 'Marketing sections' })).toHaveTextContent('Tracking & pixels')
    expect(screen.getByTestId('capi-last')).toHaveTextContent('No server events sent yet.')
    expect(within(form).getByRole('button', { name: 'Send test event' })).toBeDisabled()

    await user.type(within(form).getByLabelText('Pixel ID'), '12345')
    await user.type(within(form).getByLabelText('Measurement ID'), 'UA-123')
    await user.type(within(form).getByLabelText('TikTok pixel ID'), 'short')
    await user.click(within(form).getByRole('switch', { name: 'Send purchases through the Conversions API' }))
    await user.click(within(form).getByRole('button', { name: 'Save tracking settings' }))
    expect(within(form).getByLabelText('Pixel ID')).toHaveAccessibleDescription('The pixel ID is 10 to 20 digits, e.g. 1234567890123456.')
    expect(within(form).getByLabelText('Measurement ID')).toHaveAccessibleDescription('Starts with G-, e.g. G-AB12CD34EF.')
    expect(within(form).getByLabelText('TikTok pixel ID')).toHaveAccessibleDescription('10 to 30 letters and digits, e.g. C4ABCDEFGHIJ1234KLMN.')
    expect(within(form).getByText('Add the pixel ID and an access token to use the Conversions API.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    const pixel = within(form).getByLabelText('Pixel ID')
    await user.clear(pixel)
    await user.type(pixel, '1234567890123456')
    const ga4 = within(form).getByLabelText('Measurement ID')
    await user.clear(ga4)
    await user.type(ga4, 'g-ab12cd34ef')
    const tiktok = within(form).getByLabelText('TikTok pixel ID')
    await user.clear(tiktok)
    await user.type(tiktok, 'C4ABCDEFGHIJ1234KLMN')
    await user.type(within(form).getByLabelText('Conversions API access token'), 'EAAB-secret')
    await user.type(within(form).getByLabelText('Test event code (optional)'), 'TEST123')
    await user.type(within(form).getByLabelText('Code in <head>'), '<meta name="x" content="y">')
    await user.click(within(form).getByRole('button', { name: 'Save tracking settings' }))

    await waitFor(() => expect(patches).toEqual([{
      meta_pixel_id: '1234567890123456',
      meta_capi_enabled: true,
      meta_test_event_code: 'TEST123',
      ga4_measurement_id: 'G-AB12CD34EF',
      tiktok_pixel_id: 'C4ABCDEFGHIJ1234KLMN',
      head_code: '<meta name="x" content="y">',
      meta_capi_token: 'EAAB-secret',
    }]))
    const token = within(form).getByLabelText('Conversions API access token')
    await waitFor(() => expect(token).toHaveValue(''))
    expect(token).toHaveAttribute('placeholder', 'Saved — enter a new one to replace')
    expect(within(form).getByText('Saved')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Save tracking settings' })).toBeDisabled()
    expect(within(form).getByRole('button', { name: 'Send test event' })).toBeEnabled()
  })

  it('sends a test event and shows the result', async () => {
    const user = userEvent.setup()
    let current = tracking({ meta_pixel_id: '1234567890123456', meta_capi_enabled: true, meta_capi_token_set: true, meta_test_event_code: 'TEST123' })
    let tests = 0
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/tracking': () => ok(current),
      'POST /marketing/tracking/test': () => {
        tests += 1
        if (tests === 1) {
          current = { ...current, capi_last_status: 'failed', capi_last_error: 'Invalid OAuth access token.', capi_last_sent_at: '2026-11-24T06:00:00Z' }
          return ok({ status: 'failed', error: 'Invalid OAuth access token.' })
        }
        return fail(429, 'TOO_MANY_REQUESTS', 'Slow down')
      },
    })
    renderRoutes(routes, '/marketing/tracking')

    const panel = await screen.findByTestId('capi-test')
    await user.click(within(panel).getByRole('button', { name: 'Send test event' }))
    expect(await within(panel).findByTestId('capi-test-result')).toHaveTextContent('Meta refused the test event: Invalid OAuth access token.')
    await waitFor(() => expect(screen.getByTestId('capi-last')).toHaveTextContent('Failed'))
    expect(screen.getByTestId('capi-last')).toHaveTextContent('Invalid OAuth access token.')

    await user.click(within(panel).getByRole('button', { name: 'Send test event' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Too many test events. Wait a minute and try again.')
  })

  it('removes the saved token after confirmation', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    let current = tracking({ meta_pixel_id: '1234567890123456', meta_capi_token_set: true })
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/tracking': () => ok(current),
      'PATCH /marketing/tracking': (init) => {
        patches.push(bodyOf(init))
        current = { ...current, meta_capi_token_set: false }
        return ok(current)
      },
    })
    renderRoutes(routes, '/marketing/tracking')

    const form = await screen.findByRole('form', { name: 'Tracking settings' })
    await user.click(within(form).getByRole('button', { name: 'Remove' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Remove the access token?' })).getByRole('button', { name: 'Remove token' }))
    await waitFor(() => expect(patches).toEqual([{ meta_capi_token: null }]))
    await waitFor(() => expect(within(form).queryByText('Saved')).not.toBeInTheDocument())
  })

  it('keeps the pasted code read-only without storefront.custom_html', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/tracking': ok(tracking({ head_code: '<script>/* clarity */</script>', can_edit_code: false })),
      'PATCH /marketing/tracking': (init) => {
        patches.push(bodyOf(init))
        return ok(tracking({ ga4_measurement_id: 'G-AB12CD34EF', head_code: '<script>/* clarity */</script>', can_edit_code: false }))
      },
    })
    renderRoutes(routes, '/marketing/tracking')

    const form = await screen.findByRole('form', { name: 'Tracking settings' })
    expect(within(form).getByTestId('code-read-only')).toHaveTextContent('Only people allowed to add custom HTML')
    const head = within(form).getByLabelText('Code in <head>')
    expect(head).toHaveAttribute('readonly')
    expect(head).toHaveValue('<script>/* clarity */</script>')
    expect(form).toHaveTextContent('Pasted code runs on every page of your shop')
    await user.type(within(form).getByLabelText('Measurement ID'), 'G-AB12CD34EF')
    await user.click(within(form).getByRole('button', { name: 'Save tracking settings' }))
    await waitFor(() => expect(patches).toEqual([{ ga4_measurement_id: 'G-AB12CD34EF' }]))
  })

  it('is read-only for marketing viewers and hidden without marketing.view', async () => {
    mockApi({ 'GET /auth/me': ok(marketingViewer()), 'GET /marketing/tracking': ok(tracking({ meta_pixel_id: '1234567890123456' })) })
    const { unmount } = renderRoutes(routes, '/marketing/tracking')
    const form = await screen.findByRole('form', { name: 'Tracking settings' })
    expect(within(form).getByLabelText('Pixel ID')).toBeDisabled()
    expect(within(form).queryByRole('button', { name: 'Save tracking settings' })).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: ['social.view'] })) })
    renderRoutes(routes, '/marketing/tracking')
    expect(await screen.findByText(/permission/i)).toBeInTheDocument()
  })

  it('shows server validation next to the field', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(marketingManager()),
      'GET /marketing/tracking': ok(tracking()),
      'PATCH /marketing/tracking': fail(422, 'VALIDATION_FAILED', 'Invalid', { meta_pixel_id: ['This pixel ID is not valid.'] }),
    })
    renderRoutes(routes, '/marketing/tracking')
    const form = await screen.findByRole('form', { name: 'Tracking settings' })
    await user.type(within(form).getByLabelText('Pixel ID'), '1234567890')
    await user.click(within(form).getByRole('button', { name: 'Save tracking settings' }))
    await waitFor(() => expect(within(form).getByLabelText('Pixel ID')).toHaveAccessibleDescription('This pixel ID is not valid.'))
  })
})

describe('BD1c tracking helpers', () => {
  it('sends only changed fields, never unchanged code', () => {
    const s = tracking({ meta_pixel_id: '1234567890', head_code: '<b>x</b>' })
    const draft = toTrackingDraft(s)
    expect(trackingChanges(draft, s, '')).toEqual({})
    expect(trackingChanges({ ...draft, meta_pixel_id: '' }, s, '')).toEqual({ meta_pixel_id: null })
    expect(trackingChanges({ ...draft, head_code: '  ' }, s, '')).toEqual({ head_code: null })
    expect(trackingChanges({ ...draft, head_code: 'new' }, { ...s, can_edit_code: false }, '')).toEqual({})
  })

  it('needs a pixel and a token for the Conversions API', () => {
    const s = tracking({ meta_pixel_id: '1234567890' })
    const draft = { ...toTrackingDraft(s), meta_capi_enabled: true }
    expect(validateTracking(draft, s, '')).toHaveProperty('meta_capi_enabled')
    expect(validateTracking(draft, s, 'token')).toEqual({})
    expect(validateTracking(draft, { ...s, meta_capi_token_set: true }, '')).toEqual({})
    expect(validateTracking({ ...draft, head_code: 'x'.repeat(20_001) }, s, 'token')).toHaveProperty('head_code')
  })
})
