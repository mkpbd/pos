import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { flattenCategoryTree, type Category } from '@/features/catalog/api'
import { catalogManager, counterCashier } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'

const cat = (id: string, name: string, parent_id: string | null = null, sort_order = 0): Category => ({ id, name, parent_id, sort_order, description: null, is_active: true })
const categories = [cat('c-2', 'Snacks', 'c-1'), cat('c-1', 'Food'), cat('c-3', 'Apparel'), cat('c-4', 'Chips', 'c-2')]

describe('catalog', () => {
  it('flattens the category tree depth-first with paths', () => {
    expect(flattenCategoryTree(categories).map((c) => [c.path, c.depth])).toEqual([
      ['Apparel', 0],
      ['Food', 0],
      ['Food › Snacks', 1],
      ['Food › Snacks › Chips', 2],
    ])
  })

  it('creates a subcategory from the categories tab', async () => {
    const user = userEvent.setup()
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(catalogManager()),
      'GET /categories': ok(categories),
      'GET /brands': ok([]),
      'GET /units': ok([]),
      'GET /tax-rates': ok([]),
      'POST /categories': (init) => {
        posted = JSON.parse(String(init.body))
        return ok(cat('c-5', 'Crisps', 'c-2'))
      },
    })
    renderRoutes(routes, '/catalog')

    await user.click(await screen.findByRole('button', { name: 'New category' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Crisps')
    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Food › Snacks' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() => expect(posted).toEqual({ name: 'Crisps', parent_id: 'c-2', description: null, is_active: true }))
  })

  it('is read-only for users without manage permissions', async () => {
    mockApi({
      'GET /auth/me': ok(counterCashier()),
      'GET /categories': ok(categories),
      'GET /brands': ok([]),
      'GET /units': ok([]),
      'GET /tax-rates': ok([]),
    })
    renderRoutes(routes, '/catalog')

    expect(await screen.findByText(/Chips$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })
})
