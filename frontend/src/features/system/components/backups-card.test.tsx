import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupsCard } from '@/features/system/components/backups-card'
import { makeBackup, makeStatus } from '@/features/system/testing'
import { fail, mockApi, ok, renderWithQuery } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastInfo = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: toastError, info: toastInfo }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  toastInfo.mockReset()
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 15, total: items.length, last_page: 1 } })
const check = makeStatus().checks.backups
const NOW = Date.now()

describe('BackupsCard', () => {
  it('lists recent backups with size, checksum, off-site copy and verification', async () => {
    mockApi({
      'GET /platform/system/backups': paged([
        makeBackup({ verified_at: new Date(NOW - 60_000).toISOString(), verify_status: 'passed', verify_mode: 'restore', offsite_status: 'succeeded' }),
        makeBackup({ id: 'bk-0', status: 'failed', size_bytes: null, sha256: null, error: 'pg_dump: connection refused', triggered_by: 'user' }),
      ]),
    })
    renderWithQuery(<BackupsCard check={check} now={NOW} />)

    const rows = within(await screen.findByRole('table', { name: 'Recent backups' })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Succeeded')
    expect(rows[1]).toHaveTextContent('50 MB')
    expect(rows[1]).toHaveTextContent('a3f1c2d4e5b6')
    expect(rows[1]).toHaveTextContent('Copied')
    expect(rows[1]).toHaveTextContent('Restore passed')
    expect(rows[2]).toHaveTextContent('Failed')
    expect(rows[2]).toHaveTextContent('pg_dump: connection refused')
    expect(rows[2]).toHaveTextContent('started by hand')
    expect(within(rows[2]!).queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
    expect(screen.getByText(/every day at 02:00, kept for 14 days/)).toBeInTheDocument()
  })

  it('explains how to switch automatic backups on', async () => {
    mockApi({ 'GET /platform/system/backups': paged([]) })
    renderWithQuery(<BackupsCard check={{ ...check, status: 'disabled', enabled: false }} now={NOW} />)

    expect(screen.getByText('Automatic backups off')).toBeInTheDocument()
    expect(screen.getByText('POS_BACKUP_ENABLED=true')).toBeInTheDocument()
    expect(await screen.findByText('No backups yet')).toBeInTheDocument()
  })

  it('backs up now after confirming, then polls until the new backup finishes', async () => {
    const user = userEvent.setup()
    let phase: 'before' | 'running' | 'done' = 'before'
    let listCalls = 0
    const posts: string[] = []
    mockApi({
      'GET /platform/system/backups': () => {
        listCalls += 1
        if (phase === 'before') return paged([makeBackup()])
        if (phase === 'running') {
          phase = 'done'
          return paged([makeBackup({ id: 'bk-2', status: 'running', finished_at: null, size_bytes: null, sha256: null, triggered_by: 'user' }), makeBackup()])
        }
        return paged([makeBackup({ id: 'bk-2', triggered_by: 'user', file_name: 'pos-pos-20261124-101500.dump' }), makeBackup()])
      },
      'POST /platform/system/backups': () => {
        posts.push('backup')
        phase = 'running'
        return { status: 202, body: { success: true, data: { queued: true }, meta: { request_id: 't' } } }
      },
    })
    renderWithQuery(<BackupsCard check={check} now={NOW} />)
    await screen.findByRole('table', { name: 'Recent backups' })

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Back up the database now?' })
    await user.click(within(dialog).getByRole('button', { name: 'Back up now' }))

    expect(posts).toEqual(['backup'])
    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled()

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Backup finished: pos-pos-20261124-101500.dump (50 MB).'), { timeout: 8000 })
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled()

    // No more polling once it is done.
    const callsWhenDone = listCalls
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(listCalls).toBe(callsWhenDone)
  }, 20_000)

  it('reports a backup that is already running', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /platform/system/backups': paged([makeBackup()]),
      'POST /platform/system/backups': fail(409, 'BACKUP_RUNNING', 'A backup is already running.'),
    })
    renderWithQuery(<BackupsCard check={check} now={NOW} />)
    await screen.findByRole('table', { name: 'Recent backups' })

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Back up now' }))

    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('A backup is already running.'))
  })

  it('verifies a backup and announces the result', async () => {
    const user = userEvent.setup()
    let verified = false
    mockApi({
      'GET /platform/system/backups': () =>
        paged([verified ? makeBackup({ verified_at: new Date().toISOString(), verify_status: 'passed', verify_mode: 'list' }) : makeBackup()]),
      'POST /platform/system/backups/bk-1/verify': () => {
        verified = true
        return { status: 202, body: { success: true, data: null, meta: { request_id: 't' } } }
      },
    })
    renderWithQuery(<BackupsCard check={check} now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Verify backup pos-pos-20261124-020000.dump' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Verify this backup?' })
    expect(dialog).toHaveTextContent('The live database is not touched.')
    await user.click(within(dialog).getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Backup verified: the file is complete and readable.'))
    expect(within(screen.getByRole('table', { name: 'Recent backups' })).getAllByRole('row')[1]).toHaveTextContent('Passed')
  })
})
