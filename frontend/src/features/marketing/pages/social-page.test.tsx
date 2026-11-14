import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import {
  mangoProduct,
  notConnected,
  result,
  socialAccounts,
  socialManager,
  socialPost,
  socialSettings,
  socialViewer,
} from '@/features/marketing/social-test-data'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastWarning = vi.hoisted(() => vi.fn())
const toastMessage = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess, warning: toastWarning, message: toastMessage }) }
})

const paged = (items: unknown[]) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body ?? 'null')) as Record<string, unknown>

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
  toastWarning.mockReset()
  toastMessage.mockReset()
})

const scheduled = socialPost({
  id: 'sp-2',
  caption: 'Eid offer next week',
  status: 'scheduled',
  scheduled_at: '2026-11-20T04:00:00Z',
  published_at: null,
  results: [result({ target: 'facebook' }), result({ target: 'instagram' })],
  allowed_actions: ['edit', 'publish', 'cancel', 'delete'],
})
const partial = socialPost({
  id: 'sp-3',
  caption: 'Winter shawls are here',
  status: 'partially_published',
  results: [
    result({ target: 'facebook', status: 'published', permalink: 'https://facebook.com/demo/posts/3' }),
    result({ target: 'instagram', status: 'failed', error: { code: 'TOKEN_EXPIRED', message: 'Reconnect Facebook' } }),
  ],
  allowed_actions: ['retry'],
})

describe('social page', () => {
  it('shows practice mode, the connected Page and Instagram, and posts with per-network results', async () => {
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([socialPost(), scheduled, partial]),
    })
    renderRoutes(routes, '/marketing/social')

    expect(await screen.findByRole('heading', { name: 'Facebook & Instagram' })).toBeInTheDocument()
    expect(screen.getByTestId('social-mode')).toHaveTextContent('Practice mode (sandbox)')
    expect(screen.getByRole('note')).toHaveTextContent('nothing is sent to Facebook or Instagram')
    expect(screen.getByTestId('social-page-name')).toHaveTextContent('Demo Page')
    expect(screen.getByTestId('social-instagram')).toHaveTextContent('@demo_shop')
    expect(screen.getByRole('link', { name: /Social posts/ })).toHaveAttribute('href', '/marketing/social')
    expect(screen.getByRole('link', { name: /Product feeds/ })).toBeInTheDocument()

    const published = await screen.findByTestId('social-post-sp-1')
    expect(published).toHaveTextContent('Posted')
    expect(published).toHaveTextContent('Practice')
    // Practice permalinks never open: shown as text, not as links.
    expect(within(published).getByTestId('practice-facebook')).toHaveTextContent('Practice post — not on Facebook (https://sandbox.invalid/facebook/fb_1)')
    expect(within(published).queryByRole('link')).not.toBeInTheDocument()
    expect(within(published).getByTestId('result-instagram')).toHaveTextContent('/go/igmango')
    expect(within(published).queryByRole('button')).not.toBeInTheDocument()

    const waiting = screen.getByTestId('social-post-sp-2')
    expect(waiting).toHaveTextContent('Scheduled')
    expect(waiting).toHaveTextContent('Waiting for its time')
    expect(within(waiting).getByRole('button', { name: 'Post now' })).toBeInTheDocument()
    expect(within(waiting).getByRole('button', { name: 'Cancel schedule' })).toBeInTheDocument()
    expect(within(waiting).getByRole('button', { name: 'Delete' })).toBeInTheDocument()

    const part = screen.getByTestId('social-post-sp-3')
    expect(part).toHaveTextContent('Partly posted')
    expect(within(part).getByTestId('result-instagram')).toHaveTextContent('Not posted — Facebook wants you to log in again. Reconnect Facebook, then retry.')
    expect(within(part).getByRole('button', { name: 'Retry Instagram' })).toBeInTheDocument()
    expect(within(within(part).getByTestId('result-facebook')).getByRole('link', { name: /View on Facebook/ })).toHaveAttribute('href', 'https://facebook.com/demo/posts/3')
    expect(within(part).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    expect(screen.getByRole('form', { name: 'Meta app settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New post/ })).toBeInTheDocument()
  })

  it('is read-only for viewers, and /marketing opens it for them', async () => {
    mockApi({
      'GET /auth/me': ok(socialViewer()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([scheduled]),
    })
    const { router } = renderRoutes(routes, '/marketing')

    await waitFor(() => expect(router.state.location.pathname).toBe('/marketing/social'))
    const post = await screen.findByTestId('social-post-sp-2')
    expect(within(post).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New post/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Meta app settings' })).not.toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Marketing sections' })
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Social posts', 'Product feeds'])
  })

  it('needs social.view', async () => {
    mockApi({ 'GET /auth/me': ok({ ...socialViewer(), permissions: ['marketing.view'] }) })
    renderRoutes(routes, '/marketing/feeds')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })

  it('connects through the browser and explains a failed connection', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(notConnected()),
      'GET /social/posts': paged([]),
    })
    const { router } = renderRoutes(routes, '/marketing/social?error=no_pages')

    expect(await screen.findByRole('alert')).toHaveTextContent('This Facebook account does not manage any Page.')
    expect(screen.getByRole('link', { name: 'Connect the demo Page' })).toHaveAttribute('href', '/api/v1/social/meta/connect')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('button', { name: /New post/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss the message' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when the connection worked; live mode needs the app keys first', async () => {
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings({ mode: 'live' })),
      'GET /social/accounts': ok(notConnected({ mode: 'live', sandbox: false })),
      'GET /social/posts': paged([]),
    })
    renderRoutes(routes, '/marketing/social?connected=1')

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Facebook is connected. You can post now.'))
    expect(await screen.findByTestId('social-mode')).toHaveTextContent('Live')
    expect(screen.getByRole('button', { name: /Connect Facebook/ })).toBeDisabled()
    expect(screen.getByText(/Enter your Meta app ID and app secret under “Meta app” below first/)).toBeInTheDocument()
  })

  it('switches the Page and disconnects', async () => {
    const user = userEvent.setup()
    const selected: unknown[] = []
    let deleted = 0
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([]),
      'POST /social/accounts/select': (init) => {
        selected.push(body(init))
        return ok(socialAccounts({ page: { id: 'pg-2', name: 'Demo Page 2', picture_url: null }, instagram: null }))
      },
      'DELETE /social/accounts': () => {
        deleted += 1
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/marketing/social')

    await user.click(await screen.findByRole('combobox', { name: 'Post to Page' }))
    await user.click(await screen.findByRole('option', { name: 'Demo Page 2 (no Instagram)' }))
    await waitFor(() => expect(selected).toEqual([{ page_id: 'pg-2' }]))
    expect(toastSuccess).toHaveBeenCalledWith('Posts now go to Demo Page 2.')
    expect(await screen.findByTestId('social-instagram')).toHaveTextContent('No Instagram business account is linked')

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Disconnect Facebook?' })
    await user.click(within(confirm).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(deleted).toBe(1))
  })

  it('cancels a schedule, retries a failed network and deletes a draft', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const draft = socialPost({ id: 'sp-4', caption: 'Draft idea', status: 'draft', published_at: null, results: [result({ target: 'facebook' })], targets: ['facebook'], allowed_actions: ['edit', 'publish', 'delete'] })
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([scheduled, partial, draft]),
      'POST /social/posts/sp-2/cancel': () => {
        calls.push('cancel sp-2')
        return ok({ ...scheduled, status: 'draft', scheduled_at: null })
      },
      'POST /social/posts/sp-3/retry': () => {
        calls.push('retry sp-3')
        return ok({ ...partial, status: 'published', results: partial.results.map((r) => ({ ...r, status: 'published', error: null })) })
      },
      'DELETE /social/posts/sp-4': () => {
        calls.push('delete sp-4')
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/marketing/social')

    await user.click(within(await screen.findByTestId('social-post-sp-2')).getByRole('button', { name: 'Cancel schedule' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('The schedule is cancelled. The post is a draft again.'))
    await user.click(within(screen.getByTestId('social-post-sp-3')).getByRole('button', { name: 'Retry Instagram' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Posted to Facebook and Instagram.'))
    await user.click(within(screen.getByTestId('social-post-sp-4')).getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete this post?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toEqual(['cancel sp-2', 'retry sp-3', 'delete sp-4']))
  })
})

describe('composer', () => {
  it('builds a post from a product: photos, a suggested caption, the Instagram rules, then posts and follows it until it settles', async () => {
    const user = userEvent.setup()
    const created: Record<string, unknown>[] = []
    let polls = 0
    const posting = socialPost({ id: 'sp-9', status: 'publishing', published_at: null, results: [result({ target: 'facebook', status: 'publishing' }), result({ target: 'instagram', status: 'publishing' })] })
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([]),
      'GET /products': paged([mangoProduct]),
      'GET /products/p-1': ok(mangoProduct),
      'GET /marketing/campaigns': paged([]),
      'GET /marketing/landing-pages': ok([]),
      'POST /social/caption-suggestions': (init) => {
        expect(body(init)).toEqual({ product_id: 'p-1', language: 'bn', tone: 'festive' })
        return ok({ captions: ['ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ', 'Second idea', 'Third idea'], source: 'template', reason: 'disabled' })
      },
      'POST /social/posts': (init) => {
        created.push(body(init))
        return { status: 201, body: { success: true, data: socialPost({ id: 'sp-9', status: 'draft', allowed_actions: ['edit', 'publish', 'delete'] }), meta: { request_id: 't' } } }
      },
      'POST /social/posts/sp-9/publish': ok(posting),
      'GET /social/posts/sp-9': () => {
        polls += 1
        return ok(polls < 2 ? posting : socialPost({ id: 'sp-9' }))
      },
    })
    renderRoutes(routes, '/marketing/social')

    await user.click(await screen.findByRole('button', { name: /New post/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New post' })
    expect(within(dialog).getByRole('checkbox', { name: /Facebook Page “Demo Page”/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Instagram @demo_shop/ })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Suggest captions' })).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Choose a product' }))
    await user.click(await screen.findByRole('option', { name: /Mango juice/ }))
    expect(within(dialog).getByTestId('composer-product')).toHaveTextContent('Mango juice')
    // The first photo is chosen; the second can be added.
    expect(await within(dialog).findByRole('button', { name: 'mango-front.jpg, photo 1 of the post' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(await within(dialog).findByRole('button', { name: 'mango-glass.jpg' }))
    expect(within(dialog).getByTestId('photo-count')).toHaveTextContent('2 of 10 chosen')

    await user.click(within(dialog).getByRole('button', { name: 'Suggest captions' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Language' }))
    await user.click(await screen.findByRole('option', { name: 'বাংলা (Bangla)' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Tone' }))
    await user.click(await screen.findByRole('option', { name: /Festive/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    expect(await within(dialog).findByTestId('caption-source')).toHaveTextContent('AI is off for your shop')
    await user.click(within(dialog).getByRole('button', { name: 'Use this caption 1' }))
    expect(within(dialog).getByLabelText('Caption')).toHaveValue('ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ')
    expect(within(dialog).getByTestId('caption-counter')).toHaveTextContent('32 / 2,200 characters · 1 hashtag')
    expect(within(dialog).getByTestId('instagram-rules')).toHaveTextContent('Up to 30 hashtags (now 1)')

    await user.click(within(dialog).getByRole('button', { name: 'Post now' }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({
      caption: 'ঈদ অফার! আমের জুস মাত্র ৳১২০ #ঈদ',
      targets: ['facebook', 'instagram'],
      image_ids: ['img-1', 'img-2'],
      media_ids: [],
      link_url: null,
      product_id: 'p-1',
      campaign_id: null,
      scheduled_at: null,
    })
    await waitFor(() => expect(toastMessage).toHaveBeenCalledWith('Posting to Facebook and Instagram…'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Posted to Facebook and Instagram (practice mode: nothing was really posted).'), { timeout: 8000 })
    expect(screen.queryByRole('dialog', { name: 'New post' })).not.toBeInTheDocument()
  })

  it('checks the post before sending and schedules it in the organization’s time', async () => {
    const user = userEvent.setup()
    const created: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([]),
      'GET /marketing/campaigns': paged([]),
      'GET /marketing/landing-pages': ok([]),
      'POST /social/posts': (init) => {
        created.push(body(init))
        return { status: 201, body: { success: true, data: scheduled, meta: { request_id: 't' } } }
      },
    })
    renderRoutes(routes, '/marketing/social')

    await user.click(await screen.findByRole('button', { name: /New post/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New post' })
    await user.click(within(dialog).getByRole('button', { name: 'Post now' }))
    expect(await within(dialog).findByText('Write a caption.')).toBeInTheDocument()
    expect(within(dialog).getByText('Instagram needs at least one photo.')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Check the highlighted parts of the post.')

    await user.type(within(dialog).getByLabelText('Caption'), 'Eid offer next week')
    await user.click(within(dialog).getByRole('checkbox', { name: /Instagram/ }))
    await user.click(within(dialog).getByRole('radio', { name: 'Schedule for later' }))
    fireEvent.change(within(dialog).getByLabelText('Post on'), { target: { value: '2030-11-20T10:00' } })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule post' }))
    expect(await within(dialog).findByText('Pick a time within the next year.')).toBeInTheDocument()

    const soon = new Date(Date.now() + 3 * 24 * 3600_000)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(soon)
    fireEvent.change(within(dialog).getByLabelText('Post on'), { target: { value: `${day}T10:00` } })
    await user.click(within(dialog).getByRole('button', { name: 'Schedule post' }))
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toMatchObject({ caption: 'Eid offer next week', targets: ['facebook'], image_ids: [], media_ids: [], scheduled_at: `${day}T10:00:00+06:00` })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Scheduled for /)))
  })

  it('shows a refusal in plain words and keeps the saved draft for the next try', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const draft = socialPost({ id: 'sp-4', caption: 'Draft idea', status: 'draft', published_at: null, results: [result({ target: 'facebook' }), result({ target: 'instagram' })], allowed_actions: ['edit', 'publish', 'delete'] })
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings({ mode: 'live', live_ready: true, meta_app_id: '1234567890', secret_set: true })),
      'GET /social/accounts': ok(socialAccounts({ mode: 'live', sandbox: false })),
      'GET /social/posts': paged([draft]),
      'GET /products/p-1': ok(mangoProduct),
      'GET /marketing/campaigns': paged([]),
      'GET /marketing/landing-pages': ok([]),
      'PATCH /social/posts/sp-4': (init) => {
        calls.push(`patch ${String(body(init).caption)}`)
        return ok(draft)
      },
      'POST /social/posts/sp-4/publish': () => {
        calls.push('publish')
        return fail(422, 'INSTAGRAM_JPEG_ONLY', 'Instagram accepts JPEG only.')
      },
    })
    renderRoutes(routes, '/marketing/social')

    await user.click(within(await screen.findByTestId('social-post-sp-4')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit post' })
    expect(within(dialog).getByLabelText('Caption')).toHaveValue('Draft idea')
    expect(within(dialog).getByLabelText('Link to (optional)')).toHaveAttribute('placeholder', 'The product’s page')
    await user.click(within(dialog).getByRole('button', { name: 'Post now' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Instagram only takes JPEG photos. Choose JPEG photos, or upload JPEG copies to the media library. The post is saved as a draft.')
    expect(calls).toEqual(['patch Draft idea', 'publish'])
  })
})

describe('deleted photos', () => {
  it('shows the server’s photo error at the photo picker, and from the list as a message', async () => {
    const user = userEvent.setup()
    const missing = fail(422, 'VALIDATION_FAILED', 'Invalid', { 'image_ids.0': ['A photo of this post was deleted — pick another photo and try again.'] })
    const draft = socialPost({ id: 'sp-4', caption: 'Draft idea', status: 'draft', published_at: null, results: [result({ target: 'facebook' }), result({ target: 'instagram' })], allowed_actions: ['edit', 'publish', 'delete'] })
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([draft]),
      'GET /products/p-1': ok(mangoProduct),
      'GET /marketing/campaigns': paged([]),
      'GET /marketing/landing-pages': ok([]),
      'PATCH /social/posts/sp-4': ok(draft),
      'POST /social/posts/sp-4/publish': missing,
    })
    renderRoutes(routes, '/marketing/social')

    const row = await screen.findByTestId('social-post-sp-4')
    await user.click(within(row).getByRole('button', { name: 'Post now' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Post this now?' })).getByRole('button', { name: 'Post now' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('A photo of this post was deleted — pick another photo and try again.'))

    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit post' })
    await user.click(within(dialog).getByRole('button', { name: 'Post now' }))
    expect(await within(dialog).findByText('A photo of this post was deleted — pick another photo and try again.')).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Photos' })).toHaveAccessibleDescription('A photo of this post was deleted — pick another photo and try again.')
  })
})

describe('Meta app settings', () => {
  it('asks for the keys before live mode, warns that the Page is disconnected, and never shows the secret', async () => {
    const user = userEvent.setup()
    const patches: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings({ meta_app_id: '1234567890', secret_set: true, live_ready: true })),
      'GET /social/accounts': ok(socialAccounts()),
      'GET /social/posts': paged([]),
      'PATCH /social/settings': (init) => {
        patches.push(body(init))
        return ok(socialSettings({ mode: 'live', meta_app_id: '1234567890', secret_set: true, live_ready: true }))
      },
    })
    renderRoutes(routes, '/marketing/social')

    const form = await screen.findByRole('form', { name: 'Meta app settings' })
    expect(within(form).getByLabelText('App secret')).toHaveValue('')
    expect(within(form).getByText('Saved')).toBeInTheDocument()
    expect(within(form).getByTestId('social-redirect-uri')).toHaveTextContent('https://pos.example.com/api/v1/social/meta/callback')

    await user.click(within(form).getByRole('radio', { name: 'Live' }))
    await user.clear(within(form).getByLabelText('App ID'))
    await user.click(within(form).getByRole('button', { name: 'Save Meta app settings' }))
    expect(await within(form).findByText('Live mode needs the app ID.')).toBeInTheDocument()
    expect(patches).toHaveLength(0)

    await user.type(within(form).getByLabelText('App ID'), '1234567890')
    await user.type(within(form).getByLabelText('App secret'), 'new-secret-value')
    await user.click(within(form).getByRole('button', { name: 'Save Meta app settings' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Switch to live mode?' })
    expect(confirm).toHaveTextContent('Changing the mode disconnects Demo Page.')
    await user.click(within(confirm).getByRole('button', { name: 'Switch to live' }))
    await waitFor(() => expect(patches).toEqual([{ mode: 'live', meta_app_secret: 'new-secret-value' }]))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Live mode is on. Connect your Facebook Page to post for real.'))
  })

  it('shows the server’s field errors', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(socialManager()),
      'GET /social/settings': ok(socialSettings()),
      'GET /social/accounts': ok(notConnected()),
      'GET /social/posts': paged([]),
      'PATCH /social/settings': fail(422, 'VALIDATION_FAILED', 'Invalid', { meta_app_secret: ['The app secret is required for live mode.'] }),
    })
    renderRoutes(routes, '/marketing/social')

    const form = await screen.findByRole('form', { name: 'Meta app settings' })
    await user.type(within(form).getByLabelText('App ID'), '1234567890')
    await user.click(within(form).getByRole('button', { name: 'Save Meta app settings' }))
    expect(await within(form).findByText('The app secret is required for live mode.')).toBeInTheDocument()
  })
})
