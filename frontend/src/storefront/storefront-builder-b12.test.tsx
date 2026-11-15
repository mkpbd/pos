import { act, render, screen, within } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { MOBILE_QUERY, TABLET_QUERY } from './builder/compile-styles'
import { applyOrder, DEVICE_ORDER_ROOT, deviceOrderList, hasDeviceOrder, orderedChildren, orderedIds, ownDeviceOrder } from './builder/device-order'
import { PageRenderer } from './builder/page-renderer'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderPage, Device, DeviceOrder } from './builder/types'
import { storefrontRoutes } from './routes'
import { bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

/*
 * B12 §4: phone / tablet order. Sections (container `root`) and the elements of a column are drawn
 * in the device's own order — mobile falls back to tablet, tablet to the base order — chosen by the
 * viewport on the store and by the editor's device on the canvas. DOM order = visual order.
 */

/* ---------------------------------------------------------------------------------------------
 * A controllable viewport: matchMedia answers by width and tells listeners when it changes.
 * ------------------------------------------------------------------------------------------- */

function viewport(initial: number) {
  let width = initial
  const listeners = new Map<string, Set<() => void>>()
  const matches = (query: string) => (query === TABLET_QUERY ? width <= 1023 : query === MOBILE_QUERY ? width <= 639 : false)
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return matches(query)
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, listener: () => void) => {
          if (!listeners.has(query)) listeners.set(query, new Set())
          listeners.get(query)!.add(listener)
        },
        removeEventListener: (_: string, listener: () => void) => listeners.get(query)?.delete(listener),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  return {
    resize(next: number) {
      width = next
      act(() => listeners.forEach((set) => set.forEach((listener) => listener())))
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  resetLocale()
})

/** Three sections (s_row0..2), each with one heading; section 0 has three headings in column c_row0. */
function orderedDocument(deviceOrder: DeviceOrder | null): BuilderPage {
  const doc = documentOf(
    [elementNode('heading', 'e_a', { text: 'Alpha' }), elementNode('heading', 'e_b', { text: 'Bravo' }), elementNode('heading', 'e_c', { text: 'Charlie' })],
    [elementNode('heading', 'e_second', { text: 'Second section' })],
    [elementNode('heading', 'e_third', { text: 'Third section' })],
  )
  return { ...payloadOf(doc, { key: 'cms:about' }), device_order: deviceOrder }
}

const OWN_ORDER: DeviceOrder = {
  tablet: { [DEVICE_ORDER_ROOT]: ['s_row2', 's_row0', 's_row1'] },
  mobile: { c_row0: ['e_c', 'e_a', 'e_b'] },
}

const sectionIds = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('section[data-b]')).map((el) => el.dataset.b)
const headingNames = (root: HTMLElement) => within(root).getAllByRole('heading').map((h) => h.textContent)

function renderCanvasLike(page: BuilderPage, device?: Device) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PageRenderer page={page} device={device} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/* ============================================================================================= */

describe('B12 device order helpers', () => {
  const kids = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('inherits mobile → tablet → base; desktop is always the base order', () => {
    const order: DeviceOrder = { tablet: { root: ['c', 'b', 'a'], col: ['b', 'a'] }, mobile: { col: ['a', 'b'] } }
    expect(deviceOrderList(order, 'desktop', 'root')).toBeNull()
    expect(deviceOrderList(order, 'tablet', 'root')).toEqual(['c', 'b', 'a'])
    // Mobile has no own root list: the tablet's.
    expect(deviceOrderList(order, 'mobile', 'root')).toEqual(['c', 'b', 'a'])
    expect(deviceOrderList(order, 'mobile', 'col')).toEqual(['a', 'b'])
    expect(deviceOrderList(order, 'tablet', 'other')).toBeNull()
    expect(ownDeviceOrder(order, 'mobile', 'root')).toBeNull()
    expect(ownDeviceOrder(order, 'tablet', 'root')).toEqual(['c', 'b', 'a'])
    expect(hasDeviceOrder(order, 'mobile', 'root')).toBe(true)
    expect(hasDeviceOrder(order, 'desktop', 'root')).toBe(false)
    expect(orderedIds('root', ['a', 'b', 'c'], order, 'mobile')).toEqual(['c', 'b', 'a'])
    expect(orderedChildren('root', kids, null, 'mobile')).toBe(kids)
  })

  it('reads lists defensively: unknown and repeated ids ignored, missed children appended in base order', () => {
    expect(applyOrder(kids, ['c', 'x', 'c', 'a']).map((k) => k.id)).toEqual(['c', 'a', 'b'])
    // Nothing moves (or nothing known): the same array.
    expect(applyOrder(kids, ['a', 'b', 'c'])).toBe(kids)
    expect(applyOrder(kids, ['x', 'y'])).toBe(kids)
    expect(applyOrder(kids, [])).toBe(kids)
    // Malformed maps and lists are no order at all.
    const bad = { tablet: { root: 'c,b,a', col: [1, 2] }, mobile: ['root'] } as unknown as DeviceOrder
    expect(deviceOrderList(bad, 'tablet', 'root')).toBeNull()
    expect(deviceOrderList(bad, 'mobile', 'col')).toBeNull()
    expect(deviceOrderList('x' as unknown as DeviceOrder, 'tablet', 'root')).toBeNull()
    // Inherited keys never count as containers.
    expect(deviceOrderList({ tablet: {} }, 'tablet', 'constructor')).toBeNull()
  })
})

describe('B12 store pages draw the viewport’s order', () => {
  function renderCms(builder: BuilderPage) {
    const page: StorePage = { slug: 'about', title: 'About us', template: 'default', body_html: '', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
    mockApi({
      'GET /store/bootstrap': ok(bootstrapFixture()),
      'GET /store/pages/about': ok(page),
      'GET /store/cart': ok(cartFixture()),
      'GET /store/wishlist': ok({ items: [] }),
    })
    return renderRoutes(storefrontRoutes, '/pages/about')
  }

  it('reorders sections on tablets and elements on phones in the DOM, following resizes', async () => {
    const screenSize = viewport(1366)
    renderCms(orderedDocument(OWN_ORDER))
    await screen.findByRole('heading', { name: 'Alpha' })
    const page = screen.getByTestId('builder-page')
    // Desktop: the base order.
    expect(sectionIds(page)).toEqual(['s_row0', 's_row1', 's_row2'])
    expect(headingNames(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Second section', 'Third section'])

    // Tablet: its own section order; the column keeps the base order (no tablet list for it).
    screenSize.resize(900)
    expect(sectionIds(page)).toEqual(['s_row2', 's_row0', 's_row1'])
    expect(headingNames(page)).toEqual(['Third section', 'Alpha', 'Bravo', 'Charlie', 'Second section'])

    // Phone: sections inherit the tablet order, the column has its own.
    screenSize.resize(400)
    expect(sectionIds(page)).toEqual(['s_row2', 's_row0', 's_row1'])
    expect(headingNames(page)).toEqual(['Third section', 'Charlie', 'Alpha', 'Bravo', 'Second section'])
    // Reading order is the DOM order — no CSS `order` anywhere.
    expect(screen.getByTestId('builder-styles').textContent).not.toMatch(/(^|[;{])order:/)

    screenSize.resize(1366)
    expect(headingNames(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Second section', 'Third section'])
  })

  it('draws the base order without a device order or without matchMedia', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')!
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined })
    try {
      renderCms(orderedDocument(OWN_ORDER))
      await screen.findByRole('heading', { name: 'Alpha' })
      expect(headingNames(screen.getByTestId('builder-page'))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Second section', 'Third section'])
    } finally {
      Object.defineProperty(window, 'matchMedia', original)
    }
  })

  it('ignores a null device order on a phone', async () => {
    viewport(400)
    renderCms(orderedDocument(null))
    await screen.findByRole('heading', { name: 'Alpha' })
    expect(headingNames(screen.getByTestId('builder-page'))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Second section', 'Third section'])
  })
})

describe('B12 the canvas draws the editor’s device order', () => {
  it('follows the device prop, not the viewport', () => {
    viewport(1366)
    mockApi({ 'GET /store/bootstrap': ok(bootstrapFixture()) })
    const page = { ...orderedDocument(OWN_ORDER), document: { ...orderedDocument(null).document, key: 'canvas', source: 'draft' as const } }
    const { container, rerender } = renderCanvasLike(page, 'mobile')
    const root = container.querySelector<HTMLElement>('[data-testid="builder-page"]')!
    expect(headingNames(root)).toEqual(['Third section', 'Charlie', 'Alpha', 'Bravo', 'Second section'])
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PageRenderer page={page} device="desktop" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(headingNames(container.querySelector<HTMLElement>('[data-testid="builder-page"]')!)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Second section', 'Third section'])
  })

  it('orders the elements of an inner row’s columns too', () => {
    viewport(1366)
    const inner = elementNode('inner_row', 'e_inner', {}, {} as never) as unknown as Record<string, unknown>
    inner.columns = [
      {
        id: 'c_inner',
        type: 'column',
        width: { base: 100 },
        style: {},
        elements: [elementNode('heading', 'e_one', { text: 'One' }), elementNode('heading', 'e_two', { text: 'Two' })],
      },
    ]
    const page = { ...payloadOf(documentOf([inner as never])), device_order: { tablet: { c_inner: ['e_two', 'e_one'] } } }
    const { container } = renderCanvasLike(page, 'mobile')
    expect(headingNames(container.querySelector<HTMLElement>('[data-testid="builder-page"]')!)).toEqual(['Two', 'One'])
  })
})
