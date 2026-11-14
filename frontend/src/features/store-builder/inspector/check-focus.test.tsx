import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { focusField } from './check-focus'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorFocus, type InspectorProps } from './index'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const page = { pagination: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }

const el = (type: string, props: Record<string, unknown>) => ({ id: 'e_test01', type, props, ...common }) as unknown as Element

function contentWith(node: Element): BuilderContent {
  const column: Column = { id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [node] }
  return { schema_version: 1, sections: [{ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [column] } as Section] }
}

/** The inspector of `node` (null: the page settings), then a focus request like the page check's "Fix it". */
function setup(node: BuilderNode | null, focus: Omit<InspectorFocus, 'token'>, extra: Partial<InspectorProps> = {}) {
  mockApi({ 'GET /media': ok([], page), 'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [] }) })
  function Harness() {
    const [current, setCurrent] = useState<InspectorFocus | null>(null)
    return (
      <MemoryRouter>
        <button type="button" onClick={() => setCurrent({ ...focus, token: (current?.token ?? 0) + 1 })}>
          Request focus
        </button>
        <Inspector
          content={node ? contentWith(node as Element) : { schema_version: 1, sections: [] }}
          node={node}
          document={{ id: 'd-1', kind: 'page', key: 'landing:eid', title: 'Eid', path: '/p/eid', published: null }}
          registry={registry}
          locales={['en']}
          errors={[]}
          onChange={vi.fn()}
          onCommand={vi.fn()}
          focus={current}
          {...extra}
        />
      </MemoryRouter>
    )
  }
  renderWithQuery(<Harness />)
  return () => fireEvent.click(screen.getByRole('button', { name: 'Request focus' }))
}

describe('inspector focus (page check "Fix it")', () => {
  it('focuses an image’s alt text field', async () => {
    const go = setup(el('image', { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }), { nodeId: 'e_test01', tab: 'content', field: 'alt' })
    go()
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Description \(alt text\)/ })).toHaveFocus())
  })

  it('switches to the Style tab and opens the colour group', async () => {
    const go = setup(el('heading', { text: 'Hi', level: 2, link: null }), { nodeId: 'e_test01', tab: 'style', field: 'color' })
    go()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Style' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(document.activeElement?.closest('[data-testid="style-group-color"]')).not.toBeNull())
  })

  it('opens a gallery image’s card (by item id) and focuses its alt text', async () => {
    const images = [
      { id: 'img-a', media_id: 'm1', alt: 'One', caption: '' },
      { id: 'img-b', media_id: 'm2', alt: '', caption: '' },
    ]
    const go = setup(el('gallery', { images, columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' }), { nodeId: 'e_test01', tab: 'content', field: 'images.img-b.alt' })
    go()
    await waitFor(() => {
      const focused = document.activeElement as HTMLElement
      expect(focused.closest('[data-item-id]')?.getAttribute('data-item-id')).toBe('img-b')
      expect(focused).toHaveValue('')
    })
  })

  it('focuses the page’s search description in the page settings', async () => {
    const go = setup(null, { nodeId: null, tab: 'content', field: 'seo.description' })
    go()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Description' })).toHaveFocus())
  })

  it('ignores a request for another node', async () => {
    const go = setup(el('image', { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }), { nodeId: 'other', tab: 'style', field: 'alt' })
    go()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('focusField', () => {
  it('prefers data-check-field, then labels; falls back to the first invalid field when told it is the last try', () => {
    render(
      <div data-testid="root">
        <label htmlFor="a">Heading text</label>
        <input id="a" />
        <input aria-label="Size and importance" />
        <input data-check-field="seo.title" aria-label="Exact" />
        <input aria-invalid="true" aria-label="Broken" />
      </div>,
    )
    const root = screen.getByTestId('root')
    expect(focusField(root, 'seo.title')).toBe('focused')
    expect(screen.getByLabelText('Exact')).toHaveFocus()
    expect(focusField(root, 'text')).toBe('focused')
    expect(screen.getByLabelText('Heading text')).toHaveFocus()
    expect(focusField(root, 'level')).toBe('focused')
    expect(screen.getByLabelText('Size and importance')).toHaveFocus()
    expect(focusField(root, 'nothing_here')).toBe('none')
    expect(focusField(root, 'nothing_here', true)).toBe('fallback')
    expect(screen.getByLabelText('Broken')).toHaveFocus()
  })

  it('finds list items by position too (server paths)', () => {
    render(
      <section data-item-list="items" data-testid="root">
        <ol>
          <li data-item-id="x1">
            <button type="button" aria-expanded="true">One</button>
            <label htmlFor="t1">Title</label>
            <input id="t1" />
          </li>
          <li data-item-id="x2">
            <button type="button" aria-expanded="true">Two</button>
            <label htmlFor="t2">Title</label>
            <input id="t2" />
          </li>
        </ol>
      </section>,
    )
    expect(focusField(screen.getByTestId('root'), 'items.1.title')).toBe('focused')
    expect(document.getElementById('t2')).toHaveFocus()
  })
})
