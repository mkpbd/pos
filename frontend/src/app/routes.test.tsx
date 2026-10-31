import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { setContextHeaderProvider } from '@/lib/api/client'
import { useSessionStore } from '@/stores/session-store'
import { cashier, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const emptyPage = ok([], { pagination: { current_page: 1, per_page: 25, total: 0, last_page: 1 } })

describe('app routes', () => {
  beforeEach(() => {
    useSessionStore.setState({ activeBranchId: null })
    setContextHeaderProvider(() => {
      const id = useSessionStore.getState().activeBranchId
      return id ? { 'X-Branch-Id': id } : ({} as Record<string, string>)
    })
  })

  it('redirects anonymous visitors to login, remembering the target', async () => {
    mockApi({ 'GET /auth/me': fail(401, 'UNAUTHENTICATED') })

    const { router } = renderRoutes(routes, '/users')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?redirect=%2Fusers')
  })

  it('sends signed-in users from / to their first permitted page and selects a branch', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /branches': emptyPage })

    const { router } = renderRoutes(routes, '/')

    expect(await screen.findByRole('heading', { name: 'Branches' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/branches')
    await waitFor(() => expect(useSessionStore.getState().activeBranchId).toBe('b-1'))
  })

  it('shows only navigation entries the role may use', async () => {
    mockApi({ 'GET /auth/me': ok(cashier()), 'GET /branches': emptyPage })

    renderRoutes(routes, '/')

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Branches' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'All organizations' })).not.toBeInTheDocument()
  })

  it('blocks direct navigation to pages without permission', async () => {
    mockApi({ 'GET /auth/me': ok(cashier()) })

    renderRoutes(routes, '/users')

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
  })

  it('replaces a stale active branch with one the user may access', async () => {
    useSessionStore.setState({ activeBranchId: 'b-from-another-org' })
    const fetchMock = mockApi({ 'GET /auth/me': ok(cashier()), 'GET /branches': emptyPage })

    renderRoutes(routes, '/branches')

    await waitFor(() => expect(useSessionStore.getState().activeBranchId).toBe('b-1'))
    await waitFor(() => {
      const branchCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/branches'))
      const last = branchCalls.at(-1) as unknown as [string, RequestInit] | undefined
      expect((last?.[1].headers as Record<string, string> | undefined)?.['X-Branch-Id']).toBe('b-1')
    })
  })

  it('renders not found for unknown paths inside the layout', async () => {
    mockApi({ 'GET /auth/me': ok(makeCurrentUser()) })

    renderRoutes(routes, '/nope')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })
})
