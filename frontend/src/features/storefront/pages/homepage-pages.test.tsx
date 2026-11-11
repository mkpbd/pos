import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Banner, HomepageSection, SectionTypeInfo } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: vi.fn() }) }
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })
const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

const types: SectionTypeInfo[] = [
  { type: 'hero_slider', label: 'Hero slider', description: 'Full-width slides.', banner_placement: 'hero_slider', items: { min: 1, max: 10 }, defaults: { autoplay_seconds: 6, height: 'large' } },
  { type: 'banner_grid', label: 'Banner grid', description: 'Promo tiles.', banner_placement: 'home_promo', items: { min: 2, max: 8 }, defaults: { layout: '3-col' } },
  { type: 'rich_text', label: 'Text block', description: 'Formatted text.', banner_placement: null, items: null, defaults: { body_html: '', alignment: 'left', width: 'narrow', background: null } },
  { type: 'features_strip', label: 'Features strip', description: 'Icons with text.', banner_placement: null, items: null, defaults: { items: [], background: null } },
  { type: 'testimonials', label: 'Testimonials', description: 'Quotes.', banner_placement: null, items: null, defaults: { items: [], background: null } },
  { type: 'newsletter', label: 'Newsletter sign-up', description: 'E-mail form.', banner_placement: null, items: null, defaults: { text: null, button_label: 'Subscribe', image_media_id: null, background: '#c2410c', foreground: '#ffffff' } },
]

const banner = (id: string, overrides: Partial<Banner> = {}): Banner => ({
  id,
  placement: 'hero_slider',
  name: `Banner ${id}`,
  kicker: null,
  title: null,
  subtitle: null,
  link_url: null,
  button_label: null,
  secondary_link_url: null,
  secondary_button_label: null,
  desktop_media_id: `media-${id}`,
  mobile_media_id: null,
  text_color: '#ffffff',
  text_position: 'left',
  starts_at: null,
  ends_at: null,
  is_active: true,
  is_live: true,
  state: 'live',
  sort_order: 0,
  updated_at: null,
  ...overrides,
})

const section = (id: string, overrides: Partial<HomepageSection> = {}): HomepageSection => ({
  id,
  type: 'newsletter',
  type_label: 'Newsletter sign-up',
  title: `Section ${id}`,
  subtitle: null,
  config: types[5]!.defaults,
  banner_ids: [],
  is_enabled: true,
  starts_at: null,
  ends_at: null,
  state: 'live',
  sort_order: 0,
  updated_at: null,
  ...overrides,
})

describe('homepage builder', () => {
  it('lists sections with their state, reorders, toggles and duplicates them', async () => {
    const user = userEvent.setup()
    let list = [section('a', { title: 'Hero', type: 'hero_slider', type_label: 'Hero slider', banner_ids: ['b-1'] }), section('b', { title: 'Join us', is_enabled: false, state: 'disabled' })]
    const calls: { key: string; body: unknown }[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': () => ok(list),
      'PUT /storefront/homepage-sections/order': (init) => {
        const body = JSON.parse(String(init.body)) as { ids: string[] }
        calls.push({ key: 'order', body })
        list = body.ids.map((id) => list.find((s) => s.id === id)!)
        return ok(list)
      },
      'PATCH /storefront/homepage-sections/b': (init) => {
        calls.push({ key: 'patch', body: JSON.parse(String(init.body)) })
        list = list.map((s) => (s.id === 'b' ? { ...s, is_enabled: true, state: 'live' } : s))
        return ok(list[1])
      },
      'POST /storefront/homepage-sections/a/duplicate': () => {
        calls.push({ key: 'duplicate', body: null })
        list = [list[0]!, section('c', { title: 'Hero (copy)', is_enabled: false, state: 'disabled' }), ...list.slice(1)]
        return { status: 201, body: { success: true, data: list[1], meta: {} } }
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    const ol = await screen.findByRole('list', { name: 'Homepage sections' })
    const rows = within(ol).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Hero')
    expect(rows[0]).toHaveTextContent('1 banner')
    expect(rows[1]).toHaveTextContent('Hidden')
    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/?preview=1')

    await user.click(screen.getByRole('button', { name: 'Move Join us up' }))
    await waitFor(() => expect(within(ol).getAllByRole('listitem')[0]).toHaveTextContent('Join us'))
    expect(calls[0]).toEqual({ key: 'order', body: { ids: ['b', 'a'] } })

    await user.click(screen.getByRole('switch', { name: 'Show Join us' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'patch')).toBe(true))
    expect(calls.find((c) => c.key === 'patch')?.body).toEqual({ is_enabled: true })

    await user.click(screen.getByRole('button', { name: 'Duplicate Hero' }))
    expect(await within(ol).findByText('Hero (copy)')).toBeInTheDocument()
  })

  it('adds a features strip, checking it first and sending the typed config', async () => {
    const user = userEvent.setup()
    let created: unknown
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': ok([]),
      'POST /storefront/homepage-sections': (init) => {
        created = JSON.parse(String(init.body))
        return { status: 201, body: { success: true, data: section('n', { type: 'features_strip' }), meta: {} } }
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    expect(await screen.findByText('The homepage has no sections yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Features strip/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New features strip' })

    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))
    expect(within(dialog).getByText('Add at least one.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add feature' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Feature 1 icon' }))
    await user.click(await screen.findByRole('option', { name: 'Delivery truck' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Feature 1 title' }), 'Fast delivery')
    await user.type(within(dialog).getByLabelText('Title'), 'Why us')
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(created).toEqual({
      type: 'features_strip',
      title: 'Why us',
      subtitle: null,
      config: { items: [{ icon: 'truck', title: 'Fast delivery', text: null }], background: null },
      is_enabled: true,
      starts_at: null,
      ends_at: null,
    })
  })

  it('picks banners for a hero slider and shows server rule errors', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': ok([]),
      'GET /storefront/banners': ok([banner('b-1', { name: 'Eid sale' }), banner('b-2', { name: 'Tile', placement: 'home_promo' })]),
      'GET /media': emptyMedia,
      'POST /storefront/homepage-sections': fail(422, 'BANNER_NOT_FOUND', 'Some selected banners do not exist or belong to another placement.'),
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Hero slider/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New hero slider' })

    await user.click(within(dialog).getByRole('combobox', { name: 'Add a banner' }))
    // Only banners of the hero placement are offered.
    expect(screen.queryByRole('option', { name: 'Tile' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'Eid sale' }))
    expect(within(within(dialog).getByRole('list', { name: 'Chosen banners' })).getByText('Eid sale')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('belong to another placement')
  })

  it('creates a banner from the hero slider dialog when there is none, and chooses it', async () => {
    const user = userEvent.setup()
    let banners: Banner[] = []
    let bannerBody: Record<string, unknown> = {}
    let sectionBody: Record<string, unknown> = {}
    const image = { id: 'img-1', url: '/img.png', srcset: '', alt: null, original_name: 'slide.png', mime_type: 'image/png', size_bytes: 1, width: 1600, height: 600, created_at: null }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': ok([]),
      'GET /storefront/banners': () => ok(banners),
      'GET /media': ok([image], { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }),
      'POST /storefront/banners': (init) => {
        bannerBody = JSON.parse(String(init.body))
        banners = [banner('new-1', { name: 'Eid slide', desktop_media_id: 'img-1' })]
        return ok(banners[0])
      },
      'POST /storefront/homepage-sections': (init) => {
        sectionBody = JSON.parse(String(init.body))
        return ok(section('s-1', { type: 'hero_slider', banner_ids: ['new-1'] }))
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Hero slider/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New hero slider' })
    expect(await within(dialog).findByText(/No hero slider banners yet/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Create banner' }))
    const form = await screen.findByRole('dialog', { name: 'New banner' })
    await user.type(within(form).getByLabelText(/^Name/), 'Eid slide')
    await user.click(within(form).getAllByRole('button', { name: 'Choose' })[0]!)
    const picker = await screen.findByRole('dialog', { name: 'Banner image' })
    await user.click(await within(picker).findByRole('button', { name: 'slide.png' }))
    await user.click(within(picker).getByRole('button', { name: 'Use image' }))
    await user.click(within(form).getByRole('button', { name: 'Add banner' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New banner' })).not.toBeInTheDocument())
    expect(bannerBody).toMatchObject({ placement: 'hero_slider', name: 'Eid slide', desktop_media_id: 'img-1' })
    // The new banner joins the section; the section itself was not submitted along the way.
    expect(sectionBody).toEqual({})
    expect(within(await within(dialog).findByRole('list', { name: 'Chosen banners' })).getByText('Eid slide')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))
    await waitFor(() => expect(sectionBody).toMatchObject({ type: 'hero_slider', banner_ids: ['new-1'] }))
  })

  it('is read-only for viewers', async () => {
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /storefront/homepage-sections/types': ok(types),
      'GET /storefront/homepage-sections': ok([section('a')]),
    })
    renderRoutes(routes, '/storefront/homepage')

    expect(await screen.findByText('Section a')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add section' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Section a' })).not.toBeInTheDocument()
  })
})

describe('banners', () => {
  it('lists banners per placement and explains why one in use cannot be deleted', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/banners': ok([
        banner('b-1', { name: 'Eid sale', title: 'Flat 20% off' }),
        banner('b-2', { name: 'Winter', state: 'scheduled', is_live: false }),
        banner('b-3', { name: 'Toys tile', placement: 'home_promo' }),
      ]),
      'GET /media': emptyMedia,
      'DELETE /storefront/banners/b-1': fail(422, 'IN_USE', 'This banner is shown by a homepage section. Remove it there first.'),
    })
    renderRoutes(routes, '/storefront/banners')

    const hero = await screen.findByRole('list', { name: 'Hero slider banners' })
    expect(within(hero).getAllByRole('listitem')).toHaveLength(2)
    expect(within(hero).getByText('Scheduled')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Homepage promo tiles banners' })).getByText('Toys tile')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Eid sale' }))
    await user.click(await screen.findByRole('button', { name: 'Delete banner' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This banner is shown by a homepage section. Remove it there first.'))
    expect(within(hero).getByText('Eid sale')).toBeInTheDocument()
  })

  it('checks a new banner before sending it', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/banners': ok([]),
      'GET /media': emptyMedia,
    })
    renderRoutes(routes, '/storefront/banners')

    const [addHero] = await screen.findAllByRole('button', { name: 'Add banner' })
    await user.click(addHero!)
    const dialog = await screen.findByRole('dialog', { name: 'New banner' })
    await user.type(within(dialog).getByLabelText('Button label'), 'Shop now')
    await user.click(within(dialog).getByRole('button', { name: 'Add banner' }))

    expect(within(dialog).getByText('Enter a name (only staff see it).')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose an image.')).toBeInTheDocument()
    expect(within(dialog).getByText('A button needs a link.')).toBeInTheDocument()
  })
})
