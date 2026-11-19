import { createRef, useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { envelope, type ParentMessage } from '@/storefront/builder/canvas/protocol'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { StorePageContext } from '@/storefront/builder/templates/types'
import type { BuilderContent, Column, Element, Section } from '@/storefront/builder/types'
import { samplePage } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { CanvasFrame, type CanvasHandle } from './canvas-frame'
import { allowedIn, documentTemplate, kindInfo } from './document-kind'
import { Inspector, type BuilderNode, type ElementsMetadata } from './inspector'
import { b14Problems, fieldGroups } from './inspector/b14-model'
import { buildElement } from './inspector/create-element'
import { validateNode } from './inspector/validate'
import { runPageCheck } from './page-check'
import { coreInsertRefusal, elementsOfType } from './store-page-core'
import { sampleOptions, summaryTemplate, templateCreateInput } from './store-pages-api'
import { SamplePicker } from './template-sample'
import { sampleFieldText, sampleLabel, TemplateSampleContext, type TemplateSample } from './template-sample-state'

/*
 * B14 editor: store page designs — which elements a design may hold (its main part once), the
 * page check's "needs its main part", the live text and listing forms (field picker, live value
 * from the sample, scope per page), the toolbar's sample picker and the canvas `page-context`.
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
type AnyProps = Element & { props: Record<string, unknown> }

const node = (type: string, props: Record<string, unknown> = {}, id = 'e_test01', context?: 'template' | 'page') => {
  const base = buildElement(type, registry, new Set(), context)!
  return { ...base, id, props: { ...base.props, ...props } } as unknown as Element
}
const section = (elements: Element[], id = 's_sec001'): Section =>
  ({ id, type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section
const content = (...elements: Element[]): BuilderContent => ({ schema_version: 1, sections: [section(elements)] })

const CATEGORY_CONTEXT: StorePageContext = {
  template: 'category',
  store: { name: 'Nakshi', phone: '01700000000', email: null, address: null },
  category: { id: 'c-1', slug: 'panjabi', name: 'Panjabi', description: null, product_count: 42 },
}

const sampleState = (over: Partial<TemplateSample> = {}): TemplateSample => ({
  template: 'category',
  choice: null,
  setChoice: vi.fn(),
  context: CATEGORY_CONTEXT,
  sample: null,
  choices: [],
  pending: false,
  missing: false,
  ...over,
})

describe('store page designs: what they may hold', () => {
  it('knows a template document and words it plainly', () => {
    expect(documentTemplate({ kind: 'page', key: 'template:blog_post' })).toBe('blog_post')
    expect(documentTemplate({ kind: 'page', key: 'home' })).toBeNull()
    expect(documentTemplate({ kind: 'zone', key: 'template:shop' })).toBeNull()
    const info = kindInfo({ kind: 'page', key: 'template:category' })
    expect(info.noun).toBe('store page')
    expect(info.placement).toMatch(/every category page/)
    expect(summaryTemplate({ kind: 'page', key: 'template:order', template: 'order' })).toBe('order')
    expect(templateCreateInput('search', 'starter')).toEqual({ kind: 'page', key: 'template:search', title: 'Search results', from: 'starter' })
  })

  it('offers each main part only in its own store pages; the listing also on normal pages', () => {
    const meta = (type: string) => registry.types.find((t) => t.type === type)!
    expect(allowedIn(meta('product_listing'), 'template', 'category')).toBe(true)
    expect(allowedIn(meta('product_listing'), 'template', 'blog_post')).toBe(false)
    expect(allowedIn(meta('blog_post_body'), 'template', 'blog_post')).toBe(true)
    expect(allowedIn(meta('order_summary'), 'template', 'shop')).toBe(false)
    expect(allowedIn(meta('not_found_message'), 'page')).toBe(false)
    expect(allowedIn(meta('product_listing'), 'page')).toBe(true)
    expect(allowedIn(meta('heading'), 'template', 'order')).toBe(true)
    expect(allowedIn(meta('dynamic_text'), 'template', 'order')).toBe(true)
  })

  it('holds the main part once', () => {
    const listing = node('product_listing', {}, 'e_list01', 'template')
    expect(elementsOfType(content(listing), 'product_listing')).toEqual(['e_list01'])
    expect(coreInsertRefusal(content(), 'product_listing', 'category')).toBeNull()
    expect(coreInsertRefusal(content(listing), 'product_listing', 'category')).toMatch(/already has the product list/)
    expect(coreInsertRefusal(content(listing), 'product_listing', null)).toBeNull()
  })

  it('starts the listing with this page’s products in a store page, all products elsewhere', () => {
    expect((buildElement('product_listing', registry, new Set(), 'template') as AnyProps).props.scope).toBe('current')
    expect((buildElement('product_listing', registry, new Set(), 'page') as AnyProps).props.scope).toBe('all')
  })
})

describe('store page designs: rules and page check', () => {
  it('groups the live text fields by where they come from', () => {
    expect(fieldGroups('category').map((g) => g.label)).toEqual(['This category', 'Your store'])
    expect(fieldGroups('order')[0]!.fields.map((f) => f.label)).toContain('Order total')
    expect(fieldGroups(null).map((g) => g.label)).toEqual(['Your store'])
  })

  it('refuses a field the page doesn’t know and the wrong listing scope', () => {
    expect(b14Problems('dynamic_text', { ...node('dynamic_text').props, field: 'order.total' }, 'category', true)).toEqual([
      { path: 'props.field', message: 'This page has no “Order total”. Choose something this page knows.' },
    ])
    expect(b14Problems('dynamic_text', { ...node('dynamic_text').props, field: 'category.name' }, 'category', true)).toEqual([])
    const listing = node('product_listing').props
    expect(b14Problems('product_listing', { ...listing, scope: 'all' }, 'brand', true).map((p) => p.path)).toEqual(['props.scope'])
    expect(b14Problems('product_listing', { ...listing, scope: 'current' }, null, false)[0]!.message).toBe('Choose which products to show.')
    expect(b14Problems('product_listing', { ...listing, scope: 'categories', category_ids: [] }, null, false)[0]).toEqual({ path: 'props.category_ids', message: 'Tick at least one category.' })
    expect(validateNode(node('dynamic_text', { field: 'post.title' }), { context: 'template', template: 'blog_post' })).toEqual([])
  })

  it('says a store page needs its main part, and adds it', () => {
    const issues = runPageCheck({ content: content(node('heading')), document: { kind: 'page', key: 'template:blog_post' }, theme: null, media: {} })
    const missing = issues.find((i) => i.code === 'TEMPLATE_CORE_MISSING')!
    expect(missing.severity).toBe('error')
    expect(missing.message).toMatch(/needs its main part: the blog post/)
    expect(missing.fix).toEqual({ kind: 'insert', label: 'Add it', type: 'blog_post_body' })
  })

  it('flags a second main part and stays quiet on a complete design or a normal page', () => {
    const a = node('order_summary', {}, 'e_ordr01')
    const b = node('order_summary', {}, 'e_ordr02')
    const twice = runPageCheck({ content: content(a, b), document: { kind: 'page', key: 'template:order' }, theme: null, media: {} })
    expect(twice.filter((i) => i.code === 'TEMPLATE_CORE_DUPLICATE').map((i) => i.node_id)).toEqual(['e_ordr02'])
    const once = runPageCheck({ content: content(a), document: { kind: 'page', key: 'template:order' }, theme: null, media: {} })
    expect(once.some((i) => i.code.startsWith('TEMPLATE_CORE'))).toBe(false)
    const hidden = runPageCheck({ content: content({ ...a, hidden: true } as Element), document: { kind: 'page', key: 'template:order' }, theme: null, media: {} })
    const off = hidden.find((i) => i.code === 'TEMPLATE_CORE_MISSING')!
    expect(off).toMatchObject({ severity: 'error', node_id: 'e_ordr01', fix: { kind: 'focus', node_id: 'e_ordr01' } })
    expect(off.message).toMatch(/is hidden/)
    const home = runPageCheck({ content: content(node('heading')), document: { kind: 'page', key: 'home' }, theme: null, media: {} })
    expect(home.some((i) => i.code.startsWith('TEMPLATE_CORE'))).toBe(false)
  })
})

/* ---------------------------------------------------------------------------------------------- */

function setup(initial: Element, options: { key?: string; sample?: TemplateSample | null } = {}) {
  const onChange = vi.fn()
  const key = options.key ?? 'template:category'
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const page: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    const inspector = (
      <Inspector
        content={page}
        node={current}
        document={{ id: 'd-1', kind: 'page', key, title: 'Store page', path: null, published: null }}
        registry={registry}
        locales={['en']}
        errors={[]}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={() => undefined}
      />
    )
    return options.sample === null ? inspector : <TemplateSampleContext value={options.sample ?? sampleState()}>{inspector}</TemplateSampleContext>
  }
  mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({
      pages: [],
      categories: [
        { id: '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', name: 'Panjabi', url: '/category/panjabi' },
        { id: '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', name: 'Saree', url: '/category/saree' },
      ],
      brands: [],
      blog_categories: [],
      blog_posts: [],
    }),
  })
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps }
}

describe('store page designs: inspector forms', () => {
  it('previews live text with the sample and its words before and after', async () => {
    const { user, last } = setup(node('dynamic_text', { field: 'category.name' }))
    expect(screen.getByTestId('dynamic-preview')).toHaveTextContent('With the sample (Panjabi)')
    expect(screen.getByTestId('dynamic-preview-value')).toHaveTextContent('Panjabi')
    await user.type(screen.getByLabelText('Words before'), 'Shop ')
    expect(last().props.prefix).toBe('Shop ')
    expect(screen.getByTestId('dynamic-preview-value')).toHaveTextContent('Shop Panjabi')
    await user.type(screen.getByLabelText('Words after'), '!')
    expect(screen.getByTestId('dynamic-preview-value')).toHaveTextContent(/^Shop Panjabi!$/)
    expect(screen.getByRole('combobox', { name: 'What to show' })).toHaveTextContent('Category name')
  })

  it('says what shows when the sample has no value', async () => {
    const { user } = setup(node('dynamic_text', { field: 'category.description' }))
    expect(screen.getByTestId('dynamic-preview')).toHaveTextContent('No value here, so nothing shows')
    await user.type(screen.getByLabelText('Text when empty'), 'Handpicked for you')
    expect(screen.getByTestId('dynamic-preview')).toHaveTextContent('shoppers see: Handpicked for you')
  })

  it('formats numbers and points out a field this page doesn’t have', () => {
    expect(sampleFieldText(CATEGORY_CONTEXT, 'category.product_count', 'default')).toBe('42')
    expect(sampleFieldText(CATEGORY_CONTEXT, 'order.total', 'default')).toBeNull()
    setup(node('dynamic_text', { field: 'order.total' }))
    expect(screen.getByText('This page has no “Order total”. Choose something this page knows.')).toBeInTheDocument()
  })

  it('shows the listing of a store page with this page’s products and its settings', async () => {
    const { user, last } = setup(node('product_listing', {}, 'e_test01', 'template'))
    expect(screen.getByText(/products of the category being viewed/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Products shown' })).toBeNull()
    const filters = screen.getByTestId('listing-filters')
    await user.click(within(filters).getByLabelText('On sale'))
    expect((last().props.filters as Record<string, boolean>).on_sale).toBe(false)
    expect(within(screen.getByTestId('listing-columns')).getByRole('combobox', { name: 'Phones' })).toHaveTextContent('2 in a row')
  })

  it('lets a normal page choose which products, with a category checklist', async () => {
    const { user, last } = setup(node('product_listing', { scope: 'categories', category_ids: [] }), { key: 'home', sample: null })
    expect(screen.getByRole('combobox', { name: 'Products shown' })).toHaveTextContent('Products in the categories I choose')
    expect(screen.getByText('Tick at least one category.')).toBeInTheDocument()
    await user.click(await screen.findByLabelText('Saree'))
    expect(last().props.category_ids).toEqual(['1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'])
  })

  it('switches the blog post’s parts on and off', async () => {
    const blog = setup(node('blog_post_body'), { key: 'template:blog_post' })
    await blog.user.click(screen.getByRole('switch', { name: 'Show related posts at the end' }))
    expect(blog.last().props.show_related).toBe(!(node('blog_post_body').props as Record<string, unknown>).show_related)
  })

  it('keeps the order details private and the page-not-found message editable', async () => {
    const order = setup(node('order_summary'), { key: 'template:order' })
    expect(screen.getByText(/sees only their own order/)).toBeInTheDocument()
    await order.user.click(screen.getByRole('switch', { name: 'Show the products and totals' }))
    expect(order.last().props.show_items).toBe(false)
  })

  it('edits the page-not-found message', async () => {
    const page = setup(node('not_found_message'), { key: 'template:not_found' })
    await page.user.type(screen.getByLabelText('Heading'), 'Oops')
    expect(page.last().props.heading).toBe('Oops')
    await page.user.click(screen.getByRole('switch', { name: 'Show a search box' }))
    expect(page.last().props.show_search).toBe(!(node('not_found_message').props as Record<string, unknown>).show_search)
  })

  it('explains search texts on the store page settings', () => {
    renderWithQuery(
      <MemoryRouter>
        <Inspector
          content={{ schema_version: 1, sections: [] }}
          node={null}
          document={{ id: 'd-1', kind: 'page', key: 'template:order', title: 'Order / thank you', path: null, published: null }}
          registry={registry}
          locales={['en']}
          errors={[]}
          onChange={() => undefined}
          onCommand={() => undefined}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Store page' })).toBeInTheDocument()
    expect(screen.getByTestId('store-page-seo-note')).toHaveTextContent('Search engines don’t list this page.')
    expect(screen.queryByText('Search & sharing')).toBeNull()
  })
})

/* ---------------------------------------------------------------------------------------------- */

describe('store page designs: sample picker and canvas', () => {
  it('names what the canvas shows', () => {
    expect(sampleLabel('category', CATEGORY_CONTEXT, [], null)).toBe('Panjabi')
    expect(sampleLabel('search', null, [], 'saree')).toBe('“saree”')
    expect(sampleLabel('order', null, [], 'sample')).toBe('Sample order')
    expect(sampleOptions('order', undefined, [{ id: 'sample', label: 'Sample order' }, { id: '1042', label: '#1042 · R***' }])).toHaveLength(2)
  })

  it('picks a category for the canvas', async () => {
    const user = userEvent.setup()
    const setChoice = vi.fn()
    mockApi({
      'GET /storefront/link-targets': ok({
        pages: [],
        categories: [
          { id: 'c-1', name: 'Panjabi', url: null },
          { id: 'c-2', name: 'Saree', url: null },
        ],
      }),
    })
    renderWithQuery(
      <TemplateSampleContext value={sampleState({ setChoice })}>
        <SamplePicker />
      </TemplateSampleContext>,
    )
    const button = screen.getByTestId('sample-picker')
    expect(button).toHaveAccessibleName(/Preview with: Panjabi/)
    await user.click(button)
    const options = await screen.findByRole('radiogroup', { name: 'Preview with a category' })
    expect(within(options).getByRole('radio', { name: 'Panjabi' })).toBeChecked()
    await user.click(within(options).getByRole('radio', { name: 'Saree' }))
    expect(setChoice).toHaveBeenCalledWith('c-2')
  })

  it('takes search words and offers the order choices', async () => {
    const user = userEvent.setup()
    const setChoice = vi.fn()
    const { unmount } = renderWithQuery(
      <TemplateSampleContext value={sampleState({ template: 'search', context: { template: 'search', store: CATEGORY_CONTEXT.store, search: { query: 'shirt', result_count: 3 } }, setChoice })}>
        <SamplePicker />
      </TemplateSampleContext>,
    )
    await user.click(screen.getByTestId('sample-picker'))
    const words = screen.getByTestId('sample-search-words')
    expect(words).toHaveValue('shirt')
    await user.clear(words)
    await user.type(words, 'saree{Enter}')
    expect(setChoice).toHaveBeenCalledWith('saree')
    unmount()

    const choose = vi.fn()
    renderWithQuery(
      <TemplateSampleContext value={sampleState({ template: 'order', context: null, choices: [{ id: 'sample', label: 'Sample order' }, { id: '1042', label: '#1042 · R***' }], setChoice: choose })}>
        <SamplePicker />
      </TemplateSampleContext>,
    )
    await user.click(screen.getByTestId('sample-picker'))
    expect(screen.getByText(/names, phone numbers and addresses are hidden/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Sample order' }))
    expect(choose).toHaveBeenCalledWith('sample')
  })

  it('shows no picker for the shop and normal pages', () => {
    const { container } = renderWithQuery(
      <TemplateSampleContext value={sampleState({ template: 'shop' })}>
        <SamplePicker />
      </TemplateSampleContext>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sends the page context to the canvas after ready and on change', () => {
    const page = samplePage({ source: 'draft' })
    const props = {
      bootstrap: bootstrapFixture(),
      locale: 'en',
      sections: page.sections,
      data: page.data,
      media: page.media,
      pending: [],
      selection: null,
      hover: null,
      errorIds: [],
      device: 'desktop' as const,
      dragging: false,
      indicator: null,
      onSelect: vi.fn(),
      onHover: vi.fn(),
      onKey: vi.fn(),
      toolbar: () => null,
      hoverLabel: () => '',
      handleRef: createRef<CanvasHandle>(),
    }
    const view = render(<CanvasFrame {...props} pageContext={CATEGORY_CONTEXT} pageSample={null} />)
    const child = (screen.getByTitle(/Page canvas/) as HTMLIFrameElement).contentWindow!
    const posted: ParentMessage[] = []
    vi.spyOn(child, 'postMessage').mockImplementation((data: unknown) => void posted.push(data as ParentMessage))
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope({ type: 'ready' }), origin: window.location.origin, source: child })))
    const types = posted.map((m) => m.type)
    expect(types.indexOf('page-context')).toBeGreaterThan(-1)
    expect(types.indexOf('page-context')).toBeLessThan(types.indexOf('render'))
    expect(posted.find((m) => m.type === 'page-context')).toMatchObject({ context: CATEGORY_CONTEXT, sample: null })

    posted.length = 0
    const next = { ...CATEGORY_CONTEXT, category: { ...CATEGORY_CONTEXT.category!, name: 'Saree' } }
    view.rerender(<CanvasFrame {...props} pageContext={next} pageSample={null} />)
    expect(posted.filter((m) => m.type === 'page-context')).toHaveLength(1)

    posted.length = 0
    view.rerender(<CanvasFrame {...props} />)
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope({ type: 'ready' }), origin: window.location.origin, source: child })))
    expect(posted.some((m) => m.type === 'page-context')).toBe(false)
  })
})
