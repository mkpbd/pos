import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { paged, SMS_VIEWER, smsMessage, smsSettings } from '@/features/sms/test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

describe('SMS → Message log', () => {
  it('lists messages with status badges, filters and pages through them', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(SMS_VIEWER()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': (_init, url) => {
        queries.push(url.searchParams)
        const page = Number(url.searchParams.get('page') ?? '1')
        if (url.searchParams.get('status') === 'failed') return ok([smsMessage({ id: 'm-9', status: 'failed', error: 'Provider answered 500', attempts: 3 })], paged(1))
        return ok(
          page === 1
            ? [
                smsMessage(),
                smsMessage({ id: 'm-2', purpose: 'otp', body: 'Corner Shop: your code is ••••••. Valid 5 minutes.', driver: 'log', status: 'queued', sent_at: null }),
                smsMessage({ id: 'm-3', purpose: 'order_shipped', status: 'skipped', error: 'monthly_limit', segments: 2, encoding: 'unicode' }),
              ]
            : [smsMessage({ id: 'm-21', purpose: 'test', to_phone: '01811111111' })],
          paged(21, page),
        )
      },
    })
    renderRoutes(routes, '/settings/sms')

    const table = await screen.findByRole('table', { name: 'SMS messages' })
    const rows = within(table).getAllByRole('row') as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    expect(rows).toHaveLength(4)
    expect(rows[1]).toHaveTextContent('01712345678')
    expect(rows[1]).toHaveTextContent('Order placed')
    expect(within(rows[1]).getByText('Sent')).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent('Sign-in / checkout code')
    expect(rows[2]).toHaveTextContent('Test mode')
    expect(rows[2]).toHaveTextContent('••••••')
    expect(within(rows[2]).getByText('Queued')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Skipped')).toBeInTheDocument()
    expect(rows[3]).toHaveTextContent('Monthly limit reached')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('01811111111')).toBeInTheDocument()
    expect(queries.at(-1)?.get('page')).toBe('2')

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Failed' }))
    expect(await screen.findByText('Provider answered 500')).toBeInTheDocument()
    expect(screen.getByText('3 tries')).toBeInTheDocument()
    expect(queries.at(-1)?.get('status')).toBe('failed')
    expect(queries.at(-1)?.get('page')).toBe('1')

    await user.click(screen.getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByRole('option', { name: 'Order shipped' }))
    await user.type(screen.getByLabelText('Mobile number'), '0171-2')
    await user.type(screen.getByLabelText('From'), '2026-11-01')
    await user.type(screen.getByLabelText('To'), '2026-11-24')
    await waitFor(() => {
      const last = queries.at(-1)
      expect(last?.get('purpose')).toBe('order_shipped')
      expect(last?.get('search')).toBe('01712')
      expect(last?.get('from')).toBe('2026-11-01')
      expect(last?.get('to')).toBe('2026-11-24')
    })
  })

  it('says when there is nothing yet', async () => {
    mockApi({
      'GET /auth/me': ok(SMS_VIEWER()),
      'GET /sms/settings': ok(smsSettings()),
      'GET /sms/messages': ok([], paged(0)),
    })
    renderRoutes(routes, '/settings/sms')
    expect(await screen.findByText('Messages appear here once the shop sends its first SMS.')).toBeInTheDocument()
  })
})
