import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { ProductListingResponse } from '@/features/online-catalog/api'
import { listingResponse } from '@/features/online-catalog/test-data'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: toastSuccess }) }
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view', 'online_catalog.manage', 'products.view'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view', 'products.view'] })

/** P1b listing: video and badges offered by the API. */
const withMedia = (overrides: Partial<ProductListingResponse['listing']> = {}) => listingResponse({ video_url: null, badges: [], ...overrides })

type Body = Record<string, unknown>

const themeColors = { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#b91c1c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' }

function listingApi(data: ProductListingResponse, options: { me?: ReturnType<typeof makeCurrentUser>; put?: (body: Body) => ReturnType<typeof ok> } = {}) {
  const bodies: Body[] = []
  mockApi({
    'GET /auth/me': ok(options.me ?? manager()),
    'GET /notifications/unread-count': ok({ count: 0 }),
    'GET /online-catalog/products/p-1': ok(data),
    'PUT /online-catalog/products/p-1': (init) => {
      const body = JSON.parse(String(init.body)) as Body
      bodies.push(body)
      return options.put ? options.put(body) : ok({ ...data, listing: { ...data.listing, video_url: body.video_url, badges: body.badges } })
    },
    'PUT /online-catalog/products/p-1/related': ok({ related: [], frequently_bought: [] }),
    // The live theme's colours for the badge preview (storefront.view).
    'GET /storefront/theme': ok({ settings: { colors: themeColors }, custom_css: null, has_custom_css: false, updated_at: null }),
  })
  return bodies
}

const openListing = async () => {
  renderRoutes(routes, '/products/p-1/online-store')
  return screen.findByRole('form', { name: 'Online listing' })
}

describe('online listing → product video and badges (P1b)', () => {
  it('checks the video link while typing and previews it only on request', async () => {
    const user = userEvent.setup()
    const bodies = listingApi(withMedia())
    const form = await openListing()

    const video = within(form).getByLabelText('Video link (optional)')
    expect(within(form).getByText(/A YouTube or Vimeo link\. It plays as the last photo/)).toBeInTheDocument()
    await user.type(video, 'https://www.youtube.com/@mangoshop')
    expect(within(form).getByTestId('video-not-detected')).toHaveTextContent('This isn’t a video link yet.')
    expect(within(form).queryByRole('button', { name: 'Preview video' })).not.toBeInTheDocument()

    await user.clear(video)
    await user.type(video, 'https://youtu.be/dQw4w9WgXcQ?t=5')
    expect(within(form).getByTestId('video-detected')).toHaveTextContent('YouTube video found (dQw4w9WgXcQ).')
    // Nothing is loaded from YouTube until the owner asks for the preview.
    expect(form.querySelector('iframe')).toBeNull()
    await user.click(within(form).getByRole('button', { name: 'Preview video' }))
    const player = within(form).getByTitle('Product video preview')
    expect(player.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
    await user.click(within(form).getByRole('button', { name: 'Close preview' }))
    expect(form.querySelector('iframe')).toBeNull()

    // A changed link closes an open preview.
    await user.click(within(form).getByRole('button', { name: 'Preview video' }))
    await user.clear(video)
    await user.type(video, 'https://vimeo.com/76979871')
    expect(within(form).getByTestId('video-detected')).toHaveTextContent('Vimeo video found (76979871).')
    expect(form.querySelector('iframe')).toBeNull()

    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ video_url: 'https://vimeo.com/76979871', badges: [] })
    expect(toastSuccess).toHaveBeenCalledWith('Online listing saved.')
  })

  it('adds up to two badges with a colour and Bangla text, reorders them and saves', async () => {
    const user = userEvent.setup()
    const bodies = listingApi(withMedia())
    const form = await openListing()

    expect(within(form).getByText('No badges.')).toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Add badge' }))
    await user.type(within(form).getByLabelText('Badge 1 text'), 'Free gift')
    expect(within(form).getByText('9/24')).toBeInTheDocument()
    // A new badge takes a colour the automatic badges don't use: info = the theme's secondary colour.
    expect(within(form).getByRole('combobox', { name: 'Badge 1 colour' })).toHaveTextContent('Secondary colour')
    // The preview uses the live theme's colours with readable text.
    await waitFor(() => expect(within(form).getByTestId('badge-preview')).toHaveStyle({ backgroundColor: '#6f55c2', color: '#ffffff' }))
    expect(within(form).getByTestId('badge-preview')).toHaveTextContent('Free gift')
    await user.type(within(form).getByRole('textbox', { name: 'Badge 1 text in Bangla' }), 'ফ্রি উপহার')

    await user.click(within(form).getByRole('button', { name: 'Add badge' }))
    expect(within(form).getByRole('combobox', { name: 'Badge 2 colour' })).toHaveTextContent('Heading colour (dark)')
    await user.type(within(form).getByLabelText('Badge 2 text'), 'Eid deal')
    await user.click(within(form).getByRole('combobox', { name: 'Badge 2 colour' }))
    await user.click(await screen.findByRole('option', { name: 'Sale colour' }))
    // Two is the limit.
    expect(within(form).queryByRole('button', { name: 'Add badge' })).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Move badge 2 up' }))
    expect(within(form).getByLabelText('Badge 1 text')).toHaveValue('Eid deal')
    expect(within(form).getByRole('textbox', { name: 'Badge 2 text in Bangla' })).toHaveValue('ফ্রি উপহার')

    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]?.badges).toEqual([
      { text: 'Eid deal', tone: 'sale', translations: { bn: { text: '' } } },
      { text: 'Free gift', tone: 'info', translations: { bn: { text: 'ফ্রি উপহার' } } },
    ])
    expect(bodies[0]?.video_url).toBeNull()
  })

  it('checks the link and the badge text before saving and puts server errors on the right fields', async () => {
    const user = userEvent.setup()
    let failNext = true
    const bodies = listingApi(withMedia(), {
      put: () => {
        if (!failNext) return ok(withMedia())
        failNext = false
        return fail(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
          video_url: ['This video is not available.'],
          'badges.0.translations.bn.text': ['The Bangla text may not be greater than 24 characters.'],
        })
      },
    })
    const form = await openListing()

    await user.type(within(form).getByLabelText('Video link (optional)'), 'https://example.com/clip.mp4')
    await user.click(within(form).getByRole('button', { name: 'Add badge' }))
    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    expect(await within(form).findByText(/^Use a YouTube link/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Video link (optional)')).toHaveAttribute('aria-invalid', 'true')
    expect(within(form).getByText('Enter the badge text.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)

    await user.clear(within(form).getByLabelText('Video link (optional)'))
    await user.type(within(form).getByLabelText('Video link (optional)'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await user.type(within(form).getByLabelText('Badge 1 text'), 'Handmade')
    await user.type(within(form).getByRole('textbox', { name: 'Badge 1 text in Bangla' }), 'হাতে তৈরি')
    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    expect(await within(form).findByText('This video is not available.')).toBeInTheDocument()
    expect(within(form).getByText('The Bangla text may not be greater than 24 characters.')).toBeInTheDocument()
    expect(within(form).getByRole('textbox', { name: 'Badge 1 text in Bangla' })).toHaveAttribute('aria-invalid', 'true')
    expect(bodies).toHaveLength(1)
  })

  it('loads the saved video and badges and clears them', async () => {
    const user = userEvent.setup()
    const bodies = listingApi(withMedia({ video_url: 'https://vimeo.com/123456', badges: [{ text: 'Handmade', tone: 'dark', translations: { bn: { text: 'হাতে তৈরি' } } }] }))
    const form = await openListing()

    expect(within(form).getByLabelText('Video link (optional)')).toHaveValue('https://vimeo.com/123456')
    expect(within(form).getByTestId('video-detected')).toHaveTextContent('Vimeo video found (123456).')
    expect(within(form).getByLabelText('Badge 1 text')).toHaveValue('Handmade')
    expect(within(form).getByRole('combobox', { name: 'Badge 1 colour' })).toHaveTextContent('Heading colour (dark)')
    expect(within(form).getByRole('textbox', { name: 'Badge 1 text in Bangla' })).toHaveValue('হাতে তৈরি')

    await user.clear(within(form).getByLabelText('Video link (optional)'))
    await user.click(within(form).getByRole('button', { name: 'Remove badge 1' }))
    await user.click(within(form).getByRole('button', { name: 'Save online listing' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ video_url: null, badges: [] })
  })

  it('leaves both out while the API does not offer them', async () => {
    const bodies = listingApi(listingResponse())
    const form = await openListing()
    expect(within(form).queryByLabelText('Video link (optional)')).not.toBeInTheDocument()
    expect(within(form).queryByRole('heading', { name: 'Badges' })).not.toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('shows the video and badges read-only with online_catalog.view', async () => {
    listingApi(withMedia({ video_url: 'https://youtu.be/dQw4w9WgXcQ', badges: [{ text: 'Handmade', tone: 'dark', translations: { bn: {} } }] }), { me: viewer() })
    const form = await openListing()

    expect(within(form).getByLabelText('Video link (optional)')).toBeDisabled()
    expect(within(form).getByLabelText('Badge 1 text')).toBeDisabled()
    expect(within(form).getByRole('textbox', { name: 'Badge 1 text in Bangla' })).toHaveValue('')
    expect(within(form).queryByRole('button', { name: 'Add badge' })).not.toBeInTheDocument()
    expect(within(form).queryByRole('button', { name: 'Remove badge 1' })).not.toBeInTheDocument()
  })
})
