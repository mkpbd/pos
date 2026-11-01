import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { Banner, HomepageSection, LinkTargets, SectionTypeInfo } from '@/features/storefront/api'
import { blogPostsSummary, normalizeBlogPosts, validateBlogPosts } from '@/features/storefront/blog-posts-section'
import { emptyNode, toApi, validateTree, type EditorNode } from '@/features/storefront/menu-tree'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: vi.fn() }) }
})

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'media.manage'] })
const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })

const targets: LinkTargets = {
  pages: [],
  blog_categories: [{ id: 'bc-1', name: 'Recipes', slug: 'recipes' }, { id: 'bc-2', name: 'Store news', slug: 'store-news' }],
  blog_posts: [
    { id: 'bp-1', title: 'Five Eid desserts', slug: 'five-eid-desserts', status: 'published', state: 'published' },
    { id: 'bp-2', title: 'Winter menu', slug: 'winter-menu', status: 'published', state: 'scheduled' },
    { id: 'bp-3', title: 'Notes', slug: 'notes', status: 'draft' },
  ],
}

const blogType: SectionTypeInfo = {
  type: 'blog_posts', label: 'Blog posts', description: 'The newest blog posts.', banner_placement: null, items: null,
  defaults: { category_id: null, limit: 3, view_all_url: null },
}
const blogSection = (overrides: Partial<HomepageSection> = {}): HomepageSection => ({
  id: 's-1', type: 'blog_posts', type_label: 'Blog posts', title: 'From our blog', subtitle: null, config: { category_id: null, limit: 3, view_all_url: null },
  banner_ids: [], is_enabled: true, starts_at: null, ends_at: null, state: 'live', sort_order: 0, updated_at: null, ...overrides,
})

const banner = (id: string, overrides: Partial<Banner> = {}): Banner => ({
  id, placement: 'popup', name: `Banner ${id}`, kicker: null, title: null, subtitle: null, link_url: null, button_label: null,
  secondary_link_url: null, secondary_button_label: null, desktop_media_id: `media-${id}`, mobile_media_id: null, text_color: '#ffffff',
  text_position: 'left', starts_at: null, ends_at: null, is_active: true, is_live: true, state: 'live', sort_order: 0, updated_at: null,
  popup_delay_seconds: 5, popup_frequency: 'once_per_day', ...overrides,
})

describe('blog helpers', () => {
  it('validates, normalizes and summarises the blog_posts section config', () => {
    expect(validateBlogPosts({ category_id: null, limit: 2, view_all_url: null })).toEqual({ 'config.limit': 'Between 3 and 12.' })
    expect(validateBlogPosts({ category_id: null, limit: 3, view_all_url: 'javascript:x' })).toHaveProperty(['config.view_all_url'])
    expect(normalizeBlogPosts({ category_id: '', limit: 6, view_all_url: '  ' })).toEqual({ category_id: null, limit: 6, view_all_url: null })
    expect(blogPostsSummary({ category_id: 'bc-1', limit: 6 }, () => 'Recipes')).toBe(' · Recipes · 6 posts')
    expect(blogPostsSummary({ category_id: null }, () => undefined)).toBe(' · All categories · 3 posts')
  })

  it('sends blog menu items with or without a target', () => {
    const node = (patch: Partial<EditorNode>): EditorNode => ({ ...emptyNode(), label: 'Blog', url: '/old', ...patch })
    const tree = [node({ type: 'blog', target_id: 'stale' }), node({ type: 'blog_category', target_id: 'bc-1' }), node({ type: 'blog_post', target_id: null })]
    expect(toApi(tree).map((n) => [n.type, n.url, n.target_id])).toEqual([['blog', null, null], ['blog_category', null, 'bc-1'], ['blog_post', null, null]])
    expect(validateTree(tree, true)).toEqual({ 'items.2.target_id': 'Choose a blog post.' })
  })
})

describe('homepage blog posts section', () => {
  it('adds a blog section for one category and summarises it in the list', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    let list: HomepageSection[] = []
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/homepage-sections/types': ok([blogType]),
      'GET /storefront/homepage-sections': () => ok(list),
      'GET /storefront/link-targets': ok(targets),
      'POST /storefront/homepage-sections': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        list = [blogSection({ config: { category_id: 'bc-1', limit: 6, view_all_url: '/blog/category/recipes' } })]
        return ok(list[0])
      },
    })
    renderRoutes(routes, '/storefront/homepage')

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.click(await screen.findByRole('button', { name: /Blog posts/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New blog posts' })

    await user.click(within(dialog).getByRole('combobox', { name: 'Blog category' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['All categories', 'Recipes', 'Store news'])
    await user.click(screen.getByRole('option', { name: 'Recipes' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Number of posts' }))
    await user.click(await screen.findByRole('option', { name: '6' }))
    await user.type(within(dialog).getByLabelText('“View all” link'), '/blog/category/recipes')
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }))

    await waitFor(() => expect(created).toBeDefined())
    expect(created).toMatchObject({ type: 'blog_posts', config: { category_id: 'bc-1', limit: 6, view_all_url: '/blog/category/recipes' } })
    expect(await screen.findByText(/· Recipes · 6 posts/)).toBeInTheDocument()
  })
})

describe('menus link to the blog', () => {
  it('offers the blog index, categories and posts (unpublished posts flagged)', async () => {
    const user = userEvent.setup()
    let saved: { items: Record<string, unknown>[] } | undefined
    const menu = { id: 'm-1', name: 'Main', location: 'main', location_label: 'Main navigation', is_active: true, updated_at: null }
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/menus': ok([menu]),
      'GET /storefront/menus/m-1': ok({ ...menu, items: [] }),
      'GET /storefront/link-targets': ok(targets),
      'PUT /storefront/menus/m-1/items': (init) => {
        saved = JSON.parse(String(init.body)) as { items: Record<string, unknown>[] }
        return ok({ ...menu, items: saved.items })
      },
      'GET /media': emptyMedia,
    })
    renderRoutes(routes, '/storefront/menus?menu=m-1')

    await user.click(await screen.findByRole('button', { name: 'Add item' }))
    await user.type(screen.getByRole('textbox', { name: 'Item 1 label' }), 'Blog')
    await user.click(screen.getByRole('combobox', { name: 'Item 1 link type' }))
    expect(await screen.findByRole('option', { name: 'Blog post: Winter menu (scheduled)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Blog post: Notes (draft)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Blog post: Five Eid desserts' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Blog (all posts)' }))
    expect(screen.queryByRole('textbox', { name: 'Item 1 link' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add item' }))
    await user.type(screen.getByRole('textbox', { name: 'Item 2 label' }), 'Recipes')
    await user.click(screen.getByRole('combobox', { name: 'Item 2 link type' }))
    await user.click(await screen.findByRole('option', { name: 'Blog category: Recipes' }))

    await user.click(screen.getByRole('button', { name: 'Save items' }))
    await waitFor(() => expect(saved).toBeDefined())
    expect(saved?.items[0]).toMatchObject({ type: 'blog', label: 'Blog', url: null, target_id: null })
    expect(saved?.items[1]).toMatchObject({ type: 'blog_category', label: 'Recipes', url: null, target_id: 'bc-1' })
  })
})

describe('popup banner', () => {
  it('lists popups with their settings and marks the one visitors see', async () => {
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/banners': ok([
        banner('p-1', { name: 'Free delivery', popup_delay_seconds: 0, popup_frequency: 'once_per_session' }),
        banner('p-2', { name: 'Eid popup', popup_delay_seconds: 10, popup_frequency: 'once_per_week' }),
      ]),
      'GET /media': emptyMedia,
    })
    renderRoutes(routes, '/storefront/banners')

    const list = await screen.findByRole('list', { name: 'Popup banners' })
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Opens right away · once per visit')
    expect(first).not.toHaveTextContent('Not shown')
    expect(second).toHaveTextContent('After 10 s · once a week')
    expect(second).toHaveTextContent('Not shown (another popup comes first)')
  })

  it('adds a popup with its delay and frequency, checking the delay first', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /storefront/banners': ok([]),
      'GET /media': ok([{ id: 'img-1', url: '/img.png', srcset: '', alt: null, original_name: 'popup.png', mime_type: 'image/png', size_bytes: 1, width: 800, height: 800, created_at: null }], {
        pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 },
      }),
      'POST /storefront/banners': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return ok(banner('p-9'))
      },
    })
    renderRoutes(routes, '/storefront/banners')

    const card = (await screen.findByText('Popup', { selector: '[data-slot="card-title"]' })).closest('[data-slot="card"]') as HTMLElement
    await user.click(within(card).getByRole('button', { name: 'Add banner' }))
    const dialog = await screen.findByRole('dialog', { name: 'New banner' })
    expect(within(dialog).getByText(/Only the first live popup is shown/)).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Name'), 'Free delivery')
    await user.click(within(dialog).getAllByRole('button', { name: 'Choose' })[0]!)
    const picker = await screen.findByRole('dialog', { name: 'Banner image' })
    await user.click(await within(picker).findByRole('button', { name: /popup\.png/ }))
    await user.click(within(picker).getByRole('button', { name: 'Use image' }))

    const delay = within(dialog).getByLabelText('Delay (seconds)')
    await user.clear(delay)
    await user.type(delay, '75')
    await user.click(within(dialog).getByRole('button', { name: 'Add banner' }))
    expect(within(dialog).getByText('Whole seconds from 0 to 60.')).toBeInTheDocument()

    await user.clear(delay)
    await user.type(delay, '8')
    await user.click(within(dialog).getByRole('combobox', { name: 'Show to each visitor' }))
    await user.click(await screen.findByRole('option', { name: 'Once a week' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add banner' }))

    await waitFor(() => expect(created).toBeDefined())
    expect(created).toMatchObject({ placement: 'popup', name: 'Free delivery', desktop_media_id: 'img-1', popup_delay_seconds: 8, popup_frequency: 'once_per_week' })
    expect(created).not.toHaveProperty('popup_delay')
  })
})
