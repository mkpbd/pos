import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { easeKey } from './easy/ease-store'
import { detail } from './test-helpers'

/*
 * B21 (editor B) in the whole editor: the first visit (Easy mode + the tour), the switches in the
 * ⋯ menu and Ctrl+K, the Preview as / A/B tests controls, the picture tip, and returning users.
 */

function mockEditor() {
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(cloneSample(), 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number }
      return ok({ ...detail(cloneSample(), body.revision + 1) })
    },
  })
}

const stored = () => JSON.parse(window.localStorage.getItem(easeKey('u-1')) ?? 'null') as { easy: boolean; tour: boolean; tips: string[] } | null

beforeEach(() => window.localStorage.clear())

describe('store builder editor (B21, editor B): Easy building', () => {
  it('a first visit opens in Easy mode with the tour; Esc closes it; the ⋯ menu and Ctrl+K switch Easy mode', async () => {
    const user = userEvent.setup()
    mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')
    const tour = await screen.findByRole('dialog', { name: 'Editor tour' }, { timeout: 4000 })
    expect(within(tour).getByRole('heading', { name: 'Add a section' })).toHaveFocus()
    expect(document.querySelector('[data-tour="add"]')).not.toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editor tour' })).toBeNull())
    expect(stored()).toEqual({ v: 1, easy: true, tour: true, tips: [] })

    const toolbar = screen.getByRole('banner', { name: 'Editor toolbar' })
    expect(within(toolbar).queryByTestId('preview-as-button')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Easy mode' })).toBeChecked()

    await user.click(within(toolbar).getByRole('button', { name: 'More page actions' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Easy mode — fewer controls' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Easy mode' })).not.toBeChecked())
    expect(within(toolbar).getByTestId('preview-as-button')).toBeInTheDocument()
    expect(stored()?.easy).toBe(false)

    await user.keyboard('{Control>}k{/Control}')
    const box = await screen.findByTestId('command-box')
    await user.type(within(box).getByRole('combobox'), 'easy')
    await user.click(within(box).getByRole('option', { name: /Turn on Easy mode/ }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Easy mode' })).toBeChecked())
  })

  it('selecting a picture shows the drag-and-drop tip once', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(easeKey('u-1'), JSON.stringify({ v: 1, easy: true, tour: true, tips: [] }))
    mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')
    await user.click(await screen.findByRole('tab', { name: 'Layers' }))
    const tree = screen.getByRole('tree', { name: 'Page layers' })
    await user.click(within(tree).getByRole('button', { name: /^Image/ }))
    const tip = await screen.findByTestId('tip-picture')
    expect(tip).toHaveTextContent('Tip: drag a picture from your computer onto it.')
    await waitFor(() => expect(stored()?.tips).toEqual(['picture']))
    await user.click(within(tip).getByRole('button', { name: 'Dismiss tip' }))
    expect(screen.queryByTestId('tip-picture')).toBeNull()
    await user.click(within(tree).getByRole('button', { name: /^Heading.*Made fresh/ }))
    await user.click(within(tree).getByRole('button', { name: /^Image/ }))
    expect(screen.queryByTestId('tip-picture')).toBeNull()
    // No tour: it was seen.
    expect(screen.queryByRole('dialog', { name: 'Editor tour' })).toBeNull()
  })

  it('someone who used the builder before keeps the full editor: no tour, no Easy mode', async () => {
    window.localStorage.setItem('pos.builder.commands.recent', '["action:check"]')
    mockEditor()
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByRole('switch', { name: 'Easy mode' })).not.toBeChecked()
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(screen.queryByRole('dialog', { name: 'Editor tour' })).toBeNull()
    expect(stored()).toEqual({ v: 1, easy: false, tour: true, tips: ['picture', 'empty', 'publish'] })
  })
})
