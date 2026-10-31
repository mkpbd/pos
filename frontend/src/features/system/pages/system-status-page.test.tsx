import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SystemStatusPage } from '@/features/system/pages/system-status-page'
import { mockFetchJson, renderWithQuery } from '@/test/utils'

const healthy = {
  success: true,
  data: { status: 'ok', checks: { database: 'ok', cache: 'ok' }, app: 'Enterprise POS', environment: 'local', time: '2026-10-31T00:00:00+00:00' },
  meta: { request_id: 'r-1' },
}

describe('SystemStatusPage', () => {
  it('shows each dependency as operational', async () => {
    mockFetchJson(healthy)

    renderWithQuery(<SystemStatusPage />)

    expect(await screen.findByText('Operational')).toBeInTheDocument()
    expect(screen.getByText('Database (PostgreSQL)')).toBeInTheDocument()
    expect(screen.getAllByText('OK')).toHaveLength(2)
  })

  it('shows degraded status when a dependency fails', async () => {
    mockFetchJson(
      { ...healthy, data: { ...healthy.data, status: 'degraded', checks: { database: 'fail', cache: 'ok' } } },
      { status: 503 },
    )

    renderWithQuery(<SystemStatusPage />)

    expect(await screen.findByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Failing')).toBeInTheDocument()
  })

  it('shows an error with retry when the backend is unreachable, and recovers', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchJson(healthy)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderWithQuery(<SystemStatusPage />)

    expect(await screen.findByText('Backend unreachable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Operational')).toBeInTheDocument()
  })
})
