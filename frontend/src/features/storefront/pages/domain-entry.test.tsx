import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import type { StorefrontDomain } from '@/features/storefront/api'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

/** P2a "Opens on": the page a store domain shows at its home address. */

const settings = ok({ is_enabled: true, site_name: 'Berry Kids', meta_description: null, fulfilment_store_id: null, updated_at: null })
const doc = (id: string, key: string, title: string, published = true) => ({
  id, kind: 'page', key, title, schema_version: 1, draft_revision: 1, has_unpublished_changes: false, draft_updated_at: null,
  published: published ? { version_id: `v-${id}`, number: 1, published_at: null } : null, path: key === 'home' ? '/' : `/p/${key.slice(8)}`,
})
const documents = ok([doc('d-home', 'home', 'Home'), doc('d-eid', 'landing:eid-sale', 'Eid offer'), doc('d-new', 'landing:new-arrival', 'New arrival', false)])

describe('domains: opens on', () => {
  it('lets managers pick a campaign page or the home page per domain', async () => {
    const user = userEvent.setup()
    let domains: StorefrontDomain[] = [
      { id: 'dm-1', host: 'berry.example.com', is_primary: true, entry_path: null, created_at: null },
      { id: 'dm-2', host: 'eid-offer.example.com', is_primary: false, entry_path: '/p/old-offer', created_at: null },
    ]
    const patches: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })),
      'GET /storefront/settings': settings,
      'GET /storefront/domains': () => ok(domains),
      'GET /storefront/builder/documents': documents,
      'PATCH /storefront/domains/dm-1': (init) => {
        const input = JSON.parse(String(init.body)) as { entry_path: string | null }
        patches.push(input)
        domains = domains.map((d) => (d.id === 'dm-1' ? { ...d, entry_path: input.entry_path } : d))
        return ok(domains[0])
      },
    })
    renderRoutes(routes, '/storefront')

    const first = await screen.findByRole('combobox', { name: 'Page berry.example.com opens on' })
    expect(first).toHaveTextContent('Home page')
    // A page that is no longer a campaign page still shows as its address.
    expect(screen.getByRole('combobox', { name: 'Page eid-offer.example.com opens on' })).toHaveTextContent('/p/old-offer')

    await user.click(first)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['Home page', 'Eid offer (/p/eid-sale)', 'New arrival — not published (/p/new-arrival)'])
    await user.click(within(listbox).getByRole('option', { name: 'Eid offer (/p/eid-sale)' }))

    await waitFor(() => expect(patches).toEqual([{ entry_path: '/p/eid-sale' }]))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Page berry.example.com opens on' })).toHaveTextContent('Eid offer'))
  })

  it('shows the page as text to viewers', async () => {
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view'] })),
      'GET /storefront/settings': settings,
      'GET /storefront/domains': ok([{ id: 'dm-1', host: 'berry.example.com', is_primary: true, entry_path: '/p/eid-sale', created_at: null }]),
      'GET /storefront/builder/documents': documents,
    })
    renderRoutes(routes, '/storefront')

    expect(await screen.findByRole('columnheader', { name: 'Opens on' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Eid offer')).toBeInTheDocument())
    expect(screen.queryByRole('combobox', { name: /opens on/ })).not.toBeInTheDocument()
  })
})
