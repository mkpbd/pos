import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthCard } from '@/features/system/components/health-card'
import { makeStatus } from '@/features/system/testing'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess }) }
})

beforeEach(() => toastSuccess.mockReset())

const NOW = Date.now()
const renderCard = (report = makeStatus()) =>
  renderRoutes([{ path: '/', element: <HealthCard report={report} now={NOW} adminEmail="owner@pos.test" /> }])

const row = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement

describe('HealthCard', () => {
  it('shows every check with its details', () => {
    renderCard(
      makeStatus({
        scheduler: { status: 'stale', last_heartbeat_at: new Date(NOW - 12 * 60_000).toISOString() },
        queue: { status: 'ok', driver: 'redis', last_heartbeat_at: new Date(NOW - 60_000).toISOString(), pending_jobs: 3, failed_jobs: '2' },
        mail: { status: 'warn', mailer: 'log', from_address: null },
      }),
    )

    expect(within(row('Database')).getByText('OK')).toBeInTheDocument()
    expect(within(row('Scheduler')).getByText('Stale')).toBeInTheDocument()
    expect(row('Scheduler')).toHaveTextContent('Last heartbeat 12 min ago')
    expect(row('Queue')).toHaveTextContent('Driver redis · 3 pending · 2 failed')
    expect(row('Queue')).toHaveTextContent('Last heartbeat 1 min ago')
    expect(within(row('Mail')).getByText('Needs attention')).toBeInTheDocument()
    expect(row('Mail')).toHaveTextContent('Mailer log · from no address set')
    expect(row('Errors')).toHaveTextContent('4 open · 1 new in the last 24 hours')
    expect(within(row('Errors')).getByRole('link', { name: 'View errors' })).toHaveAttribute('href', '/system-status/errors')
    expect(row('Data clean-up')).toHaveTextContent('Last run 5 h ago')
    const removed = screen.getByRole('list', { name: 'Rows removed in the last run' })
    expect(removed).toHaveTextContent('Login activities120')
    expect(removed).toHaveTextContent('Failed jobs3')
  })

  it('draws the backup disk as a meter with numbers', () => {
    renderCard(makeStatus({ storage: { status: 'warn', path: '/srv/backups', free_bytes: 20 * 1024 ** 3, total_bytes: 500 * 1024 ** 3 } }))

    const meter = screen.getByRole('meter', { name: 'Backup disk used' })
    expect(meter).toHaveAttribute('aria-valuenow', '96')
    expect(meter).toHaveAttribute('aria-valuetext', '20 GB free of 500 GB (4 % free)')
    expect(row('Backup disk')).toHaveTextContent('/srv/backups')
  })

  it('shows a queue running inline and a clean-up that never ran', () => {
    renderCard(makeStatus({ queue: { status: 'sync', driver: 'sync', last_heartbeat_at: null, pending_jobs: null, failed_jobs: 0 } }, { retention: null }))

    expect(within(row('Queue')).getByText('Inline (sync)')).toBeInTheDocument()
    expect(row('Queue')).not.toHaveTextContent('Last heartbeat')
    expect(row('Data clean-up')).toHaveTextContent('Has not run yet')
  })

  it('sends a test e-mail', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockApi({
      'POST /platform/system/mail-test': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return ok({ sent: true })
      },
    })
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Send test e-mail' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send a test e-mail' })
    const to = within(dialog).getByLabelText('Send to')
    expect(to).toHaveValue('owner@pos.test')
    await user.clear(to)
    await user.type(to, 'not-an-address')
    await user.click(within(dialog).getByRole('button', { name: 'Send test e-mail' }))
    expect(within(dialog).getByText('Enter a valid e-mail address.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)

    await user.clear(to)
    await user.type(to, 'ops@pos.test')
    await user.click(within(dialog).getByRole('button', { name: 'Send test e-mail' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bodies).toEqual([{ to: 'ops@pos.test' }])
    expect(toastSuccess).toHaveBeenCalledWith('Test e-mail sent to ops@pos.test.')
  })

  it('keeps the dialog open with the mail server’s error', async () => {
    const user = userEvent.setup()
    mockApi({ 'POST /platform/system/mail-test': fail(422, 'MAIL_FAILED', 'The test e-mail could not be sent: Connection to smtp.example.test:587 timed out.') })
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Send test e-mail' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send test e-mail' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The test e-mail could not be sent: Connection to smtp.example.test:587 timed out.')
  })
})
