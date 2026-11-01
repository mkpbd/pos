import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { BlogCategory, BlogPost } from '@/features/content/api'
import { toBlogDraft, toBlogInput, validateBlogDraft } from '@/features/content/blog'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  toastSuccess.mockReset()
  toastError.mockReset()
})

const editor = () => makeCurrentUser({ permissions: ['cms.manage', 'media.manage'] })
const paged = (items: unknown[], meta: Record<string, unknown> = {}) => ok(items, { pagination: { current_page: 1, per_page: 25, total: items.length, last_page: 1 }, ...meta })
const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } })

const categories: BlogCategory[] = [
  { id: 'bc-1', name: 'Recipes', slug: 'recipes', description: null, sort_order: 0, post_count: 3 },
  { id: 'bc-2', name: 'Store news', slug: 'store-news', description: 'What is new', sort_order: 1, post_count: 1 },
]

const post = (overrides: Partial<BlogPost> = {}): BlogPost => ({
  id: 'bp-1',
  slug: 'five-eid-desserts',
  title: 'Five Eid desserts',
  excerpt: 'Sweet ideas',
  status: 'published',
  state: 'published',
  published_at: '2026-10-20T04:00:00+00:00',
  category: { id: 'bc-1', name: 'Recipes', slug: 'recipes' },
  category_id: 'bc-1',
  author: { id: 'u-1', name: 'Nadia Admin' },
  cover_media_id: null,
  cover: null,
  reading_minutes: 3,
  updated_at: '2026-10-20T04:00:00+00:00',
  body_html: '<p>Hello</p>',
  seo_title: null,
  seo_description: null,
  ...overrides,
})

describe('blog editor rules', () => {
  const tz = 'Asia/Dhaka'

  it('keeps the date of a published post and converts a schedule in the organization timezone', () => {
    const published = post()
    expect(toBlogInput(toBlogDraft(published, tz), published, tz)).toMatchObject({ status: 'published', published_at: '2026-10-20T04:00:00+00:00' })

    const scheduled = post({ state: 'scheduled', published_at: '2026-12-01T03:00:00Z' })
    const draft = toBlogDraft(scheduled, tz)
    expect(draft).toMatchObject({ mode: 'schedule', publishAt: '2026-12-01T09:00' })
    expect(toBlogInput(draft, scheduled, tz).published_at).toBe('2026-12-01T09:00:00+06:00')

    const fresh = { ...toBlogDraft(undefined, tz), title: 'Hi', slug: 'hi', mode: 'now' as const }
    expect(toBlogInput(fresh, undefined, tz)).toMatchObject({ status: 'published', published_at: null, category_id: null, excerpt: null })
    expect(toBlogInput({ ...fresh, mode: 'draft' }, undefined, tz)).toMatchObject({ status: 'draft', published_at: null })
  })

  it('needs a future time to schedule', () => {
    const base = { ...toBlogDraft(undefined, tz), title: 'Hi', slug: 'hi', mode: 'schedule' as const }
    const now = new Date('2026-11-01T00:00:00Z')
    expect(validateBlogDraft({ ...base, publishAt: '' }, tz, now)).toEqual({ published_at: 'Choose when the post goes live.' })
    expect(validateBlogDraft({ ...base, publishAt: '2026-11-01T05:00' }, tz, now)).toEqual({ published_at: 'Choose a time in the future, or publish now.' })
    expect(validateBlogDraft({ ...base, publishAt: '2026-11-01T07:00' }, tz, now)).toEqual({})
  })
})

describe('blog posts list', () => {
  it('lists posts by state and filters by tab, category and search', async () => {
    const user = userEvent.setup()
    const queries: URLSearchParams[] = []
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/blog-categories': ok(categories),
      'GET /cms/blog-posts': (_init, url) => {
        queries.push(url.searchParams)
        return paged(
          [post(), post({ id: 'bp-2', slug: 'winter', title: 'Winter menu', state: 'scheduled', published_at: '2026-12-01T03:00:00Z' }), post({ id: 'bp-3', slug: 'notes', title: 'Notes', status: 'draft', state: 'draft', category: null, category_id: null, published_at: null })],
          { status_counts: { all: 3, published: 1, scheduled: 1, draft: 1 } },
        )
      },
    })
    renderRoutes(routes, '/content/blog')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Published')
    expect(rows[0]).toHaveTextContent('/blog/five-eid-desserts')
    expect(rows[1]).toHaveTextContent('Scheduled')
    expect(rows[2]).toHaveTextContent('Draft')
    expect(rows[2]).toHaveTextContent('Uncategorised')
    expect(within(rows[0]!).getByRole('link', { name: 'Five Eid desserts' })).toHaveAttribute('href', '/content/blog/bp-1')
    expect(within(screen.getByRole('navigation', { name: 'Content sections' })).getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/content/blog')

    await user.click(screen.getByRole('tab', { name: 'Scheduled (1)' }))
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('scheduled'))

    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Store news' }))
    await waitFor(() => expect(queries.at(-1)?.get('category_id')).toBe('bc-2'))

    await user.type(screen.getByRole('textbox', { name: 'Search posts' }), 'eid')
    await waitFor(() => expect(queries.at(-1)?.get('search')).toBe('eid'))
    expect(queries.at(-1)?.get('status')).toBe('scheduled')
  })

  it('manages categories: adds one with an automatic address, reorders and explains IN_USE', async () => {
    const user = userEvent.setup()
    let list = [...categories]
    let created: unknown
    let order: unknown
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/blog-categories': () => ok(list),
      'GET /cms/blog-posts': paged([]),
      'POST /cms/blog-categories': (init) => {
        created = JSON.parse(String(init.body))
        list = [...list, { id: 'bc-3', name: 'Kids & Toys', slug: 'kids-toys', description: null, sort_order: 2, post_count: 0 }]
        return { status: 201, body: { success: true, data: list[2], meta: {} } }
      },
      'PUT /cms/blog-categories/order': (init) => {
        order = JSON.parse(String(init.body))
        list = [list[1]!, list[0]!, ...list.slice(2)]
        return ok(list)
      },
      'DELETE /cms/blog-categories/bc-1': fail(422, 'IN_USE', 'In use.'),
    })
    renderRoutes(routes, '/content/blog')

    expect(await screen.findByText('No posts yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    const dialog = await screen.findByRole('dialog', { name: 'Blog categories' })
    const ol = within(dialog).getByRole('list', { name: 'Blog categories' })
    expect(within(ol).getAllByRole('listitem')[0]).toHaveTextContent('/blog/category/recipes · 3 posts')

    await user.click(within(dialog).getByRole('button', { name: 'New category' }))
    await user.type(within(dialog).getByLabelText('Category name'), 'Kids & Toys')
    expect(within(dialog).getByLabelText('Category address')).toHaveValue('kids-toys')
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(created).toEqual({ name: 'Kids & Toys', slug: 'kids-toys', description: null }))
    expect(await within(ol).findByText('Kids & Toys')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Move Store news up' }))
    await waitFor(() => expect(within(ol).getAllByRole('listitem')[0]).toHaveTextContent('Store news'))
    expect(order).toEqual({ ids: ['bc-2', 'bc-1', 'bc-3'] })

    await user.click(within(dialog).getByRole('button', { name: 'Delete Recipes' }))
    await user.click(await screen.findByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('A menu links to this category.')))
  })
})

describe('blog post editor', () => {
  it('creates a published post with an address from its title and a category', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    const saved = post({ id: 'bp-9', slug: 'eid-sweets-guide', title: 'Eid Sweets: Guide' })
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/blog-categories': ok(categories),
      'GET /media': emptyMedia,
      'POST /cms/blog-posts': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, body: { success: true, data: saved, meta: {} } }
      },
      'GET /cms/blog-posts/bp-9': ok(saved),
    })
    const { router } = renderRoutes(routes, '/content/blog/new')

    await user.type(await screen.findByLabelText('Title'), 'Eid Sweets: Guide')
    expect(screen.getByLabelText('Address')).toHaveValue('eid-sweets-guide')
    expect(screen.getByText('/blog/eid-sweets-guide', { exact: false })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Excerpt'), 'Short')
    expect(screen.getByText(/5\/300/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Post text' })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.click(await screen.findByRole('option', { name: 'Recipes' }))
    await user.type(screen.getByLabelText('SEO title'), 'Eid sweets')
    expect(screen.getByText('10/70')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose' })).toBeInTheDocument()

    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Publish now' }))
    await user.click(screen.getByRole('button', { name: 'Publish post' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/content/blog/bp-9'))
    expect(created).toEqual({
      title: 'Eid Sweets: Guide',
      slug: 'eid-sweets-guide',
      category_id: 'bc-1',
      excerpt: 'Short',
      body_html: null,
      cover_media_id: null,
      status: 'published',
      published_at: null,
      seo_title: 'Eid sweets',
      seo_description: null,
    })
    expect(toastSuccess).toHaveBeenCalledWith('Post published.')
  })

  it('schedules a post in the organization timezone', async () => {
    const user = userEvent.setup()
    let created: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/blog-categories': ok([]),
      'POST /cms/blog-posts': (init) => {
        created = JSON.parse(String(init.body)) as Record<string, unknown>
        return { status: 201, body: { success: true, data: post({ id: 'bp-9', state: 'scheduled' }), meta: {} } }
      },
      'GET /cms/blog-posts/bp-9': ok(post({ id: 'bp-9', state: 'scheduled' })),
    })
    renderRoutes(routes, '/content/blog/new')

    await user.type(await screen.findByLabelText('Title'), 'Winter menu')
    await user.click(screen.getByRole('radio', { name: 'Schedule' }))
    expect(screen.getByText('Time in Asia/Dhaka.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Schedule post' }))
    expect(screen.getByText('Choose when the post goes live.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Publish at'), { target: { value: '2099-12-01T09:00' } })
    await user.click(screen.getByRole('button', { name: 'Schedule post' }))
    await waitFor(() => expect(created).toBeDefined())
    expect(created).toMatchObject({ status: 'published', published_at: '2099-12-01T09:00:00+06:00' })
    expect(toastSuccess).toHaveBeenCalledWith('Post scheduled.')
  })

  it('previews a draft and explains why a linked post cannot be deleted', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(editor()),
      'GET /cms/blog-categories': ok(categories),
      'GET /cms/blog-posts/bp-3': ok(post({ id: 'bp-3', slug: 'notes', title: 'Notes', status: 'draft', state: 'draft', published_at: null })),
      'DELETE /cms/blog-posts/bp-3': fail(422, 'IN_USE', 'In use.'),
    })
    renderRoutes(routes, '/content/blog/bp-3')

    expect(await screen.findByRole('link', { name: 'Preview' })).toHaveAttribute('href', '/blog/notes?preview=1')
    expect(screen.queryByRole('link', { name: 'View in store' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Delete post' }))
    await user.click(await screen.findByRole('button', { name: 'Delete post' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('A menu links to this post. Remove the link under Online store → Menus first, then delete it.'))
  })
})
