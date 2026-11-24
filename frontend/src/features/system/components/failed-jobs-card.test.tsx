import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FailedJobsCard } from '@/features/system/components/failed-jobs-card'
import { makeFailedJob } from '@/features/system/testing'
import { fail, mockApi, ok, renderWithQuery } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: toastError }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 15, total: items.length, last_page: 1 } })
const JOB = 'App\\Modules\\Media\\Infrastructure\\Jobs\\GenerateRenditions'
const NOW = Date.now()

describe('FailedJobsCard', () => {
  it('lists failed jobs and retries one', async () => {
    const user = userEvent.setup()
    let jobs = [makeFailedJob(), makeFailedJob({ id: 2, uuid: 'fj-uuid-2', job: 'App\\Mail\\OrderShipped', queue: 'mail', exception: 'Swift_TransportException: timeout' })]
    const calls: string[] = []
    mockApi({
      'GET /platform/system/failed-jobs': () => paged(jobs),
      'POST /platform/system/failed-jobs/fj-uuid-1/retry': () => {
        calls.push('retry fj-uuid-1')
        jobs = jobs.slice(1)
        return ok({ retried: true })
      },
      'GET /platform/system/status': ok({}),
    })
    renderWithQuery(<FailedJobsCard now={NOW} />)

    const table = await screen.findByRole('table', { name: 'Failed jobs' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent(JOB)
    expect(rows[1]).toHaveTextContent('default')
    expect(rows[1]).toHaveTextContent('10 min ago')
    expect(rows[1]).toHaveTextContent('RuntimeException: GD could not read the image.')
    expect(screen.getByText('2')).toBeInTheDocument()

    await user.click(within(rows[1]!).getByRole('button', { name: `Retry ${JOB}` }))

    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Failed jobs' })).getAllByRole('row')).toHaveLength(2))
    expect(calls).toEqual(['retry fj-uuid-1'])
    expect(toastSuccess).toHaveBeenCalledWith(`${JOB} is queued again.`)
  })

  it('deletes a job only after confirming', async () => {
    const user = userEvent.setup()
    let jobs = [makeFailedJob()]
    const deletes: string[] = []
    mockApi({
      'GET /platform/system/failed-jobs': () => paged(jobs),
      'DELETE /platform/system/failed-jobs/fj-uuid-1': () => {
        deletes.push('fj-uuid-1')
        jobs = []
        return { status: 204 }
      },
      'GET /platform/system/status': ok({}),
    })
    renderWithQuery(<FailedJobsCard now={NOW} />)

    await user.click(await screen.findByRole('button', { name: `Delete ${JOB}` }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this failed job?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deletes).toEqual([])

    await user.click(screen.getByRole('button', { name: `Delete ${JOB}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('No failed jobs')).toBeInTheDocument()
    expect(deletes).toEqual(['fj-uuid-1'])
    expect(screen.getByRole('button', { name: 'Retry all' })).toBeDisabled()
  })

  it('retries all after confirming, and reports an unknown job', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    mockApi({
      'GET /platform/system/failed-jobs': paged([makeFailedJob()]),
      'POST /platform/system/failed-jobs/retry-all': () => {
        calls.push('retry-all')
        return ok({ retried: 1 })
      },
      'POST /platform/system/failed-jobs/fj-uuid-1/retry': fail(404, 'NOT_FOUND', 'That failed job no longer exists.'),
      'GET /platform/system/status': ok({}),
    })
    renderWithQuery(<FailedJobsCard now={NOW} />)

    await user.click(await screen.findByRole('button', { name: 'Retry all' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Retry every failed job?' })
    expect(dialog).toHaveTextContent('All 1 failed job goes back on the queue.')
    await user.click(within(dialog).getByRole('button', { name: 'Retry all' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('All failed jobs are queued again.'))
    expect(calls).toEqual(['retry-all'])

    await user.click(screen.getByRole('button', { name: `Retry ${JOB}` }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That failed job no longer exists.'))
  })
})
