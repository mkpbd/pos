import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { blogPostDetail, blogPostRow, bootstrapFixture } from './test-fixtures'
import type { StoreSection } from './types'

const categories = [
  { slug: 'recipes', name: 'Recipes', description: 'Cooking with our produce.', post_count: 3 },
  { slug: 'store-news', name: 'Store news', description: null, post_count: 1 },
]

const pageMeta = (page: number, total: number) => ({ current_page: page, per_page: 9, total, last_page: Math.max(1, Math.ceil(total / 9)) })

describe('storefront blog index', () => {
  it('lists posts as cards with category chips and paginates in the URL', async () => {
    const queries: string[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok(categories),
      'GET /store/blog': (_init, url) => {
        queries.push(url.search)
        const page = Number(url.searchParams.get('page') ?? 1)
        const posts = page === 1 ? [blogPostRow('mango-lassi'), blogPostRow('new-branch', { category: { name: 'Store news', slug: 'store-news' }, cover: null, excerpt: null })] : [blogPostRow('older-post', { reading_minutes: 0 })]
        return ok(posts, pageMeta(page, 11))
      },
    })
    const { router } = renderRoutes(storefrontRoutes, '/blog')
    const user = userEvent.setup()

    expect(await screen.findByRole('heading', { level: 1, name: 'Blog' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Blog | Berry Kids'))
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(within(crumbs).getByText('Blog')).toHaveAttribute('aria-current', 'page')

    const chips = screen.getByRole('navigation', { name: 'Blog categories' })
    expect(within(chips).getByRole('link', { name: 'All posts' })).toHaveAttribute('aria-current', 'page')
    expect(within(chips).getByRole('link', { name: 'Recipes (3)' })).toHaveAttribute('href', '/blog/category/recipes')

    const cards = screen.getAllByTestId('blog-card')
    const [firstCard, secondCard] = cards as [HTMLElement, HTMLElement]
    expect(cards).toHaveLength(2)
    const first = within(firstCard)
    expect(first.getByRole('heading', { level: 2, name: 'Mango Lassi' })).toBeInTheDocument()
    expect(first.getByRole('link', { name: 'Mango Lassi' })).toHaveAttribute('href', '/blog/mango-lassi')
    expect(first.getByRole('link', { name: 'Recipes' })).toHaveAttribute('href', '/blog/category/recipes')
    expect(first.getByText('October 12, 2026').closest('time')).toHaveAttribute('dateTime', '2026-10-12T18:00:00+06:00')
    expect(first.getByText('4 min read')).toBeInTheDocument()
    expect(firstCard.querySelector('img')).toHaveAttribute('src', '/storage/media/o/cover.jpg')
    // No cover: no image (and no empty frame).
    expect(secondCard.querySelector('img')).toBeNull()

    const pagination = screen.getByRole('navigation', { name: 'Pagination' })
    await user.click(within(pagination).getByRole('link', { name: 'Page 2' }))
    expect(await screen.findByRole('heading', { name: 'Older Post' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?page=2')
    expect(screen.getByText('1 min read')).toBeInTheDocument()
    expect(queries).toEqual(['?page=1', '?page=2'])
  })

  it('filters by category on its own page', async () => {
    const queries: string[] = []
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok(categories),
      'GET /store/blog': (_init, url) => {
        queries.push(url.search)
        return ok([blogPostRow('mango-lassi')], pageMeta(1, 1))
      },
    })
    renderRoutes(storefrontRoutes, '/blog/category/recipes')

    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument()
    expect(screen.getByText('Cooking with our produce.')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Blog categories' })).getByRole('link', { name: 'Recipes (3)' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Recipes | Berry Kids'))
    expect(queries).toEqual(['?page=1&category=recipes'])
  })

  it('shows a category a menu links to before it has published posts, and not found for an unknown one', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok(categories),
      'GET /store/blog': ok([], { ...pageMeta(1, 0), category: { slug: 'events', name: 'Events', description: null } }),
    })
    const { unmount } = renderRoutes(storefrontRoutes, '/blog/category/events')
    expect(await screen.findByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No posts have been published yet' })).toBeInTheDocument()
    unmount()

    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok(categories),
      'GET /store/blog': fail(404, 'NOT_FOUND'),
    })
    renderRoutes(storefrontRoutes, '/blog/category/unknown')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('says so when nothing is published yet, and offers a retry when loading fails', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok([]),
      'GET /store/blog': ok([], pageMeta(1, 0)),
    })
    renderRoutes(storefrontRoutes, '/blog')
    expect(await screen.findByRole('heading', { name: 'No posts have been published yet' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Blog categories' })).not.toBeInTheDocument()
  })

  it('offers a retry when the list cannot be loaded', async () => {
    let calls = 0
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/categories': ok(categories),
      'GET /store/blog': () => {
        calls += 1
        return calls === 1 ? fail(429, 'TOO_MANY_REQUESTS') : ok([blogPostRow('mango-lassi')], pageMeta(1, 1))
      },
    })
    renderRoutes(storefrontRoutes, '/blog')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Mango Lassi' })).toBeInTheDocument()
  })
})

describe('storefront blog post', () => {
  it('shows the post with its meta line, body, category, neighbours and related posts', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/mango-lassi': ok(
        blogPostDetail('mango-lassi', {
          seo_title: 'How to make mango lassi',
          prev: { slug: 'older-post', title: 'Older post' },
          next: { slug: 'newer-post', title: 'Newer post' },
          related: [blogPostRow('lychee-cooler'), blogPostRow('jackfruit-chips'), blogPostRow('tea-time'), blogPostRow('extra-one')],
        }),
      ),
      'GET /store/pages/about': ok({ slug: 'about', title: 'About us', template: 'default', body_html: '<p>Since 2020.</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null }),
    })
    const { router } = renderRoutes(storefrontRoutes, '/blog/mango-lassi')
    const user = userEvent.setup()

    const article = (await screen.findByRole('heading', { level: 1, name: 'Mango Lassi' })).closest('article')!
    await waitFor(() => expect(document.title).toBe('How to make mango lassi | Berry Kids'))
    expect(within(article).getByText('October 12, 2026')).toBeInTheDocument()
    expect(within(article).getByText('4 min read')).toBeInTheDocument()
    expect(within(article).getByText('By Rina')).toBeInTheDocument()

    const crumbs = within(article).getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog')
    expect(within(crumbs).getByRole('link', { name: 'Recipes' })).toHaveAttribute('href', '/blog/category/recipes')
    expect(within(crumbs).getByText('Mango Lassi')).toHaveAttribute('aria-current', 'page')
    expect(within(article).getByText('Filed under').querySelector('a')).toHaveAttribute('href', '/blog/category/recipes')

    const more = within(article).getByRole('navigation', { name: 'More posts' })
    expect(within(more).getByRole('link', { name: /Previous post Older post/ })).toHaveAttribute('href', '/blog/older-post')
    expect(within(more).getByRole('link', { name: /Next post Newer post/ })).toHaveAttribute('href', '/blog/newer-post')

    const related = screen.getByRole('region', { name: 'Related posts' })
    expect(within(related).getAllByTestId('blog-card')).toHaveLength(3)
    expect(within(related).getByRole('heading', { level: 3, name: 'Lychee Cooler' })).toBeInTheDocument()

    // Links in the body navigate inside the app.
    await user.click(within(article).getByRole('link', { name: 'our story' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'About us' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/pages/about')
  })

  it('shows not found for drafts and unknown slugs, and passes the staff preview flag', async () => {
    const fetchMock = mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/draft-post': fail(404, 'NOT_FOUND', 'This post does not exist.'),
    })
    renderRoutes(storefrontRoutes, '/blog/draft-post?preview=1')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContainEqual(expect.stringContaining('/store/blog/draft-post?preview=1'))
  })

  it('leaves out what an uncategorised post without neighbours does not have', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/blog/plain': ok(blogPostDetail('plain', { category: null, cover: null, author: null })),
    })
    renderRoutes(storefrontRoutes, '/blog/plain')

    const article = (await screen.findByRole('heading', { level: 1, name: 'Plain' })).closest('article')!
    expect(within(article).queryByText('Filed under')).not.toBeInTheDocument()
    expect(within(article).queryByRole('navigation', { name: 'More posts' })).not.toBeInTheDocument()
    expect(within(article).queryByText(/^By /)).not.toBeInTheDocument()
    expect(article.querySelector('img')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Related posts' })).not.toBeInTheDocument()
  })
})

describe('homepage blog teaser', () => {
  const section = (overrides: Partial<Extract<StoreSection, { type: 'blog_posts' }>> = {}): StoreSection => ({
    id: 'bp-1',
    type: 'blog_posts',
    title: 'From our kitchen',
    subtitle: null,
    config: { category_id: null, limit: 3 },
    posts: [blogPostRow('mango-lassi'), blogPostRow('lychee-cooler')],
    ...overrides,
  })

  it('shows the latest posts and links to the blog', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [section()], preview: false }) })
    renderRoutes(storefrontRoutes, '/')

    const teaser = await screen.findByRole('region', { name: 'From our kitchen' })
    expect(within(teaser).getByRole('heading', { level: 2, name: 'From our kitchen' })).toBeInTheDocument()
    expect(within(teaser).getAllByTestId('blog-card')).toHaveLength(2)
    expect(within(teaser).getByRole('heading', { level: 3, name: 'Mango Lassi' })).toBeInTheDocument()
    expect(within(teaser).getByRole('link', { name: 'View all posts' })).toHaveAttribute('href', '/blog')
  })

  it('uses the configured view-all link and marks an empty teaser in previews only', async () => {
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/homepage': ok({
        sections: [section({ id: 'bp-2', config: { category_id: 'c-1', limit: 3, view_all_url: '/blog/category/recipes' } }), section({ id: 'bp-3', posts: [], state: 'empty' })],
        preview: true,
      }),
    })
    renderRoutes(storefrontRoutes, '/?preview=1')

    expect(await screen.findByText('No published posts — visitors do not see this section')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all posts' })).toHaveAttribute('href', '/blog/category/recipes')
    expect(screen.getAllByTestId('blog-card')).toHaveLength(2)
  })

  it('never draws an empty teaser for visitors', async () => {
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [section({ posts: [] })], preview: false }) })
    renderRoutes(storefrontRoutes, '/')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Berry Kids' })).toBeInTheDocument())
    expect(screen.queryByTestId('homepage-section')).not.toBeInTheDocument()
  })
})
