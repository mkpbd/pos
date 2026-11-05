import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorefrontBootstrap } from './types'

const origin = window.location.origin

/** A store whose bootstrap answers in the language asked for (`locale` = the resolved one, as the backend does). */
function serve(store: Parameters<typeof bilingualBootstrap>[0] = {}, base: (lang: string | null) => StorefrontBootstrap = () => bilingualBootstrap(store)) {
  return mockApi({
    'GET /store/bootstrap': (_init, url) => {
      const payload = base(url.searchParams.get('lang'))
      const requested = url.searchParams.get('lang')
      const offered = payload.store.locales ?? ['en']
      return ok({ ...payload, locale: requested && offered.includes(requested) ? requested : (payload.store.default_locale ?? 'en') })
    },
    'GET /store/homepage': ok({ sections: [], preview: false }),
    'GET /store/account/me': ok(null),
    'GET /store/cart': ok(cartFixture([], { item_count: '3' })),
  })
}

const langOf = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((url) => url.pathname === `/api/v1${path}`).map((url) => url.searchParams.get('lang'))

const cookieLang = () => document.cookie.split('; ').find((row) => row.startsWith('lang='))?.slice(5) ?? null

const link = (rel: string, hreflang?: string) =>
  document.head.querySelector(`link[rel="${rel}"]${hreflang ? `[hreflang="${hreflang}"]` : ''}`)?.getAttribute('href') ?? null

beforeEach(() => {
  document.head.querySelectorAll('meta[name], meta[property], link[rel="canonical"], link[rel="alternate"]').forEach((el) => el.remove())
})

afterEach(() => resetLocale())

describe('language switcher', () => {
  it('is not shown for a store in English only', async () => {
    const fetchMock = mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()), 'GET /store/homepage': ok({ sections: [], preview: false }) })
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('heading', { level: 1, name: 'Berry Kids' })).toBeInTheDocument()
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    expect(link('alternate', 'bn')).toBeNull()
    // The bootstrap is asked for without a language (the store default); later requests carry the resolved one.
    expect(langOf(fetchMock, '/store/bootstrap')).toEqual([null])
    await waitFor(() => expect(langOf(fetchMock, '/store/homepage')).toEqual(['en']))
  })

  it('switches to Bangla and back: cookie, ?lang=, <html lang>, texts and a refetch in the new language', async () => {
    const fetchMock = serve()
    const { router } = renderRoutes(storefrontRoutes, '/?utm_source=mail')
    const user = userEvent.setup()

    const switcher = await screen.findByRole('group', { name: 'Language' })
    expect(within(switcher).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(langOf(fetchMock, '/store/cart')).toEqual(['en']))

    await user.click(within(switcher).getByRole('button', { name: 'বাংলা' }))

    expect(await screen.findByRole('link', { name: 'সাইন ইন' })).toHaveAttribute('href', '/account/login')
    expect(screen.getByText('মূল অংশে যান')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'ভাষা' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'বাংলা' })).toHaveAttribute('aria-pressed', 'true')
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('?utm_source=mail&lang=bn')
    expect(cookieLang()).toBe('bn')
    expect(document.documentElement.lang).toBe('bn')
    await waitFor(() => expect(langOf(fetchMock, '/store/cart')).toEqual(['en', 'bn']))
    expect(langOf(fetchMock, '/store/homepage')).toContain('bn')
    expect(langOf(fetchMock, '/store/bootstrap')).toContain('bn')
    // Cart count in the header, in Bangla (Latin digits: the store did not turn Bengali digits on).
    expect(screen.getByRole('button', { name: 'কার্ট, 3টি পণ্য' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    // English is the default: the parameter goes, the cookie remembers the choice.
    expect(router.state.location.search).toBe('?utm_source=mail')
    expect(cookieLang()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    await waitFor(() => expect(langOf(fetchMock, '/store/cart').at(-1)).toBe('en'))
  })

  it('is in the mobile menu too', async () => {
    serve()
    renderRoutes(storefrontRoutes, '/?lang=bn')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'মেনু খুলুন' }))
    const drawer = await screen.findByRole('dialog')
    await user.click(within(within(drawer).getByRole('group', { name: 'ভাষা' })).getByRole('button', { name: 'English' }))

    expect(await within(drawer).findByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(cookieLang()).toBe('en')
  })
})

describe('language resolution', () => {
  it('takes the cookie when the address has no ?lang=', async () => {
    document.cookie = 'lang=bn; path=/'
    const fetchMock = serve()
    renderRoutes(storefrontRoutes)

    expect(await screen.findByRole('link', { name: 'সাইন ইন' })).toBeInTheDocument()
    expect(langOf(fetchMock, '/store/bootstrap')).toEqual(['bn'])
  })

  it('prefers ?lang= over the cookie and remembers it', async () => {
    document.cookie = 'lang=bn; path=/'
    serve()
    renderRoutes(storefrontRoutes, '/?lang=en')

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(cookieLang()).toBe('en'))
  })

  it('stays in English when the store does not offer Bangla', async () => {
    const fetchMock = serve({ locales: ['en'] })
    renderRoutes(storefrontRoutes, '/?lang=bn')

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    await waitFor(() => expect(langOf(fetchMock, '/store/homepage')).toEqual(['en']))
  })

  it('opens a Bangla-default store in Bangla and puts ?lang=en in the address for English', async () => {
    const fetchMock = serve({ default_locale: 'bn' })
    const { router } = renderRoutes(storefrontRoutes)
    const user = userEvent.setup()

    expect(await screen.findByRole('link', { name: 'সাইন ইন' })).toBeInTheDocument()
    expect(langOf(fetchMock, '/store/bootstrap')).toEqual([null])
    await waitFor(() => expect(link('canonical')).toBe(`${origin}/`))

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?lang=en')
    await waitFor(() => expect(link('canonical')).toBe(`${origin}/?lang=en`))
    expect(link('alternate', 'x-default')).toBe(`${origin}/`)
  })
})

describe('Bangla page head and digits', () => {
  it('gives the canonical URL of the language, hreflang alternates and og:locale', async () => {
    serve()
    renderRoutes(storefrontRoutes, '/?lang=bn')

    await screen.findByRole('link', { name: 'সাইন ইন' })
    await waitFor(() => expect(link('canonical')).toBe(`${origin}/?lang=bn`))
    expect(link('alternate', 'en')).toBe(`${origin}/`)
    expect(link('alternate', 'bn')).toBe(`${origin}/?lang=bn`)
    expect(link('alternate', 'x-default')).toBe(`${origin}/`)
    expect(document.head.querySelector('meta[property="og:locale"]')?.getAttribute('content')).toBe('bn_BD')
  })

  it('shows Bengali digits when the store turned them on', async () => {
    serve({ bangla_digits: true })
    renderRoutes(storefrontRoutes, '/?lang=bn')

    expect(await screen.findByRole('button', { name: 'কার্ট, ৩টি পণ্য' })).toBeInTheDocument()
    expect(screen.getByTestId('cart-count')).toHaveTextContent('৩')
  })
})
