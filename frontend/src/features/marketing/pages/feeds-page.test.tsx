import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { feed, socialManager, socialViewer } from '@/features/marketing/social-test-data'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, message: vi.fn() }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const feeds = () => [feed('meta'), feed('tiktok', { enabled: false, item_count: null, last_generated_at: null }), feed('pinterest', { item_count: 1 })]

describe('product feeds page', () => {
  it('shows one card per channel with its address, figures and where to paste it', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(socialManager()), 'GET /social/feeds': ok(feeds()) })
    renderRoutes(routes, '/marketing/feeds')

    const meta = await screen.findByTestId('feed-meta')
    expect(within(meta).getByRole('heading', { name: 'Facebook & Instagram Shop (Meta)' })).toBeInTheDocument()
    expect(within(meta).getByLabelText('Feed address')).toHaveValue(feed('meta').xml_url)
    expect(within(meta).getByTestId('feed-meta-count')).toHaveTextContent('128')
    expect(within(meta).getByRole('heading', { name: 'Where to paste this: Meta Commerce Manager' })).toBeInTheDocument()
    expect(within(meta).getByText(/Catalog → Data sources/)).toBeInTheDocument()
    expect(within(meta).getByRole('switch', { name: 'Send my products to Meta' })).toBeChecked()

    const tiktok = screen.getByTestId('feed-tiktok')
    expect(within(tiktok).getByText('Off')).toBeInTheDocument()
    expect(within(tiktok).getByText('Not made yet')).toBeInTheDocument()
    expect(within(tiktok).getByRole('heading', { name: 'Where to paste this: TikTok Ads Manager' })).toBeInTheDocument()
    expect(within(screen.getByTestId('feed-pinterest')).getByRole('heading', { name: 'Where to paste this: Pinterest catalogs' })).toBeInTheDocument()

    await user.click(within(meta).getByRole('button', { name: 'Copy the Meta feed address' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Feed address copied.'))
    expect(await navigator.clipboard.readText()).toBe(feed('meta').xml_url)
    await user.click(within(meta).getByText('Other versions of this address'))
    await user.click(within(meta).getByRole('button', { name: 'Copy Bangla address' }))
    await waitFor(() => expect(navigator.clipboard.readText()).resolves.toBe(`${feed('meta').xml_url}?lang=bn`))
  })

  it('turns a feed on and makes a new address after asking', async () => {
    const user = userEvent.setup()
    const calls: { path: string; body: unknown }[] = []
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/feeds': ok(feeds()),
      'PATCH /social/feeds/tiktok': (init) => {
        calls.push({ path: 'tiktok', body: JSON.parse(String(init.body)) })
        return ok(feed('tiktok', { item_count: 42 }))
      },
      'POST /social/feeds/meta/rotate': () => {
        calls.push({ path: 'meta/rotate', body: null })
        return ok(feed('meta', { xml_url: 'https://berry.example.com/feeds/meta/n3wtoken.xml' }))
      },
    })
    renderRoutes(routes, '/marketing/feeds')

    const tiktok = await screen.findByTestId('feed-tiktok')
    await user.click(within(tiktok).getByRole('switch', { name: 'Send my products to TikTok' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('The TikTok feed is on with 42 products.'))
    await waitFor(() => expect(within(screen.getByTestId('feed-tiktok')).getByTestId('feed-tiktok-count')).toHaveTextContent('42'))

    await user.click(within(screen.getByTestId('feed-meta')).getByRole('button', { name: 'Make a new address' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Make a new Meta feed address?' })
    expect(confirm).toHaveTextContent('The current address stops working at once.')
    await user.click(within(confirm).getByRole('button', { name: 'Make new address' }))
    await waitFor(() => expect(within(screen.getByTestId('feed-meta')).getByLabelText('Feed address')).toHaveValue('https://berry.example.com/feeds/meta/n3wtoken.xml'))
    expect(calls).toEqual([{ path: 'tiktok', body: { enabled: true } }, { path: 'meta/rotate', body: null }])
  })

  it('is read-only for viewers', async () => {
    mockApi({ 'GET /auth/me': ok(socialViewer()), 'GET /social/feeds': ok(feeds()) })
    renderRoutes(routes, '/marketing/feeds')

    const meta = await screen.findByTestId('feed-meta')
    expect(within(meta).getByRole('switch', { name: 'Send my products to Meta' })).toBeDisabled()
    expect(within(meta).queryByRole('button', { name: 'Make a new address' })).not.toBeInTheDocument()
    expect(within(meta).getByRole('button', { name: 'Copy the Meta feed address' })).toBeEnabled()
  })
})
