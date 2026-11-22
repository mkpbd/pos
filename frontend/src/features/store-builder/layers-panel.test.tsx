import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent } from '@/storefront/builder/types'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { detail, seedFullMode } from './test-helpers'

/* B12 in the Layers panel: several selected, and the tablet / phone order ("Order on phones"). */

type Backend = { puts: { revision: number; content: BuilderContent }[] }

function mockEditor(content: BuilderContent = cloneSample()): Backend {
  const b: Backend = { puts: [] }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(content, 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/fonts': ok({ fonts: [], limit: 4, max_bytes: 512000 }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as Backend['puts'][number]
      b.puts.push(body)
      return ok({ ...detail(body.content, body.revision + 1) })
    },
  })
  return b
}

async function openLayers() {
  const user = userEvent.setup()
  renderRoutes(routes, '/storefront/builder/doc-1')
  await screen.findByTitle(/Page canvas/)
  await user.click(screen.getByRole('tab', { name: 'Layers' }))
  return user
}

const tree = () => screen.getByRole('tree')
const row = (id: string) => screen.getByTestId(`layer-${id}`)
const rowButton = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-layer-id]')!
const sectionOrder = () => within(tree()).getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '1').map((r) => r.dataset.testid!.replace('layer-', ''))

// B21: no first-visit tour over the editor.
beforeEach(() => seedFullMode())

describe('Layers panel (B12)', () => {
  it('Ctrl+click adds rows, Shift+click picks the siblings in between, Esc clears', async () => {
    mockEditor()
    const user = await openLayers()
    await user.click(rowButton('e_heading'))
    await user.keyboard('{Control>}')
    await user.click(rowButton('e_button'))
    await user.keyboard('{/Control}')
    expect(row('e_heading')).toHaveAttribute('aria-selected', 'true')
    expect(row('e_button')).toHaveAttribute('aria-selected', 'true')
    expect(row('e_text')).toHaveAttribute('aria-selected', 'false')
    expect(tree()).toHaveAttribute('aria-multiselectable', 'true')

    await user.click(rowButton('s_story'))
    await user.keyboard('{Shift>}')
    await user.click(rowButton('s_products'))
    await user.keyboard('{/Shift}')
    expect(['s_story', 's_features', 's_products'].map((id) => row(id).getAttribute('aria-selected'))).toEqual(['true', 'true', 'true'])
    // The inspector shows the common style form.
    expect(await screen.findByRole('heading', { name: '3 selected' })).toBeInTheDocument()

    rowButton('s_products').focus()
    await user.keyboard('{Escape}')
    expect(row('s_story')).toHaveAttribute('aria-selected', 'false')
  })

  it('in Mobile view: the phone order, moved with Alt+arrows, a badge, and "Same as computer"', async () => {
    const b = mockEditor()
    const user = await openLayers()
    expect(screen.queryByTestId('device-order-banner')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mobile view' }))
    const banner = await screen.findByTestId('device-order-banner')
    expect(within(banner).getByRole('heading', { name: 'Order on phones' })).toBeInTheDocument()

    await user.click(rowButton('s_products'))
    rowButton('s_products').focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() => expect(sectionOrder()).toEqual(['s_hero', 's_story', 's_products', 's_features', 's_hidden']))
    expect(within(screen.getByTestId('device-order-banner')).getByText('Own phone order')).toBeInTheDocument()
    await waitFor(() => expect(b.puts.at(-1)?.content.device_order).toEqual({ mobile: { root: ['s_hero', 's_story', 's_products', 's_features', 's_hidden'] } }), { timeout: 4000 })
    expect(b.puts.at(-1)?.content.sections.map((s) => s.id)).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])

    // Elements of a column: the ⋯ menu says the move is for phones only.
    await user.click(within(row('e_text')).getByRole('button', { name: /More actions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Move up on phones only (the computer order stays)' }))
    await waitFor(() => expect(within(row('c_story_text')).getByText('Own phone order')).toBeInTheDocument())
    await user.click(within(row('c_story_text')).getByRole('button', { name: /^Same as computer for Column 1/ }))
    await waitFor(() => expect(within(row('c_story_text')).queryByText('Own phone order')).not.toBeInTheDocument())

    // Back on the computer: the original order, with a note that phones differ.
    await user.click(screen.getByRole('button', { name: 'Desktop view' }))
    expect(sectionOrder()).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
    expect(screen.getByTestId('device-order-note')).toHaveTextContent('Own phone order')

    await user.click(screen.getByRole('button', { name: 'Mobile view' }))
    await user.click(within(await screen.findByTestId('device-order-banner')).getByRole('button', { name: /Same as computer/ }))
    await waitFor(() => expect(sectionOrder()).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden']))
    expect(screen.queryByText('Own phone order')).not.toBeInTheDocument()
  })

  it('with several selected, the row ⋯ menu and Alt+arrows act on all of them (one step each)', async () => {
    mockEditor()
    const user = await openLayers()
    await user.click(rowButton('e_heading'))
    await user.keyboard('{Control>}')
    await user.click(rowButton('e_text'))
    await user.keyboard('{/Control}')
    await user.click(within(row('e_text')).getByRole('button', { name: /More actions/ }))
    expect(screen.getByText('2 selected items')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    const story = () => within(tree()).getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '3').map((r) => r.dataset.testid!.replace('layer-', '')).slice(1, 4)
    await waitFor(() => expect(story()).toEqual(['e_button', 'e_heading', 'e_text']))
    rowButton('e_text').focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() => expect(story()).toEqual(['e_heading', 'e_text', 'e_button']))
    await user.click(within(row('e_heading')).getByRole('button', { name: /More actions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete 2 items' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/2 items/)
  })

  it('columns and the first item do not move on phones', async () => {
    mockEditor()
    const user = await openLayers()
    await user.click(screen.getByRole('button', { name: 'Tablet view' }))
    expect(await screen.findByRole('heading', { name: 'Order on tablets' })).toBeInTheDocument()
    expect(within(row('c_story_text')).queryByRole('button', { name: /^Drag/ })).not.toBeInTheDocument()
    rowButton('c_story_text').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    rowButton('s_hero').focus()
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(sectionOrder()).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
    expect(screen.queryByText('Own tablet order')).not.toBeInTheDocument()
  })
})
