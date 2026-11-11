import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Banner } from '@/features/storefront/api'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { createElement, Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorProps, type Problem } from './index'

// Tiptap needs layout APIs jsdom lacks; a textarea stands in for the editor (its own tests cover it).
vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const page = { pagination: { current_page: 1, per_page: 24, total: 1, last_page: 1 } }

const el = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'e_test01', type, props, ...common, ...extra }) as unknown as Element

function contentWith(node: BuilderNode): BuilderContent {
  const isSection = node.type === 'section'
  const isColumn = node.type === 'column'
  const column: Column = isColumn ? (node as Column) : { id: 'c_col001', type: 'column', width: { base: 50, tablet: 50 }, style: {}, elements: isSection ? [] : [node as Element] }
  const section = isSection ? (node as Section) : ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [column, { ...column, id: 'c_col002', elements: [] }] } as Section)
  const other = { id: 's_sec002', type: 'section', props: { layout: 'boxed', anchor: 'offers' }, ...common, columns: [] } as unknown as Section
  return { schema_version: 1, sections: [section, other] }
}

function setup(initial: BuilderNode | null, options: { locales?: string[]; errors?: Problem[]; published?: InspectorProps['document']['published'] } = {}) {
  const onChange = vi.fn()
  const onCommand = vi.fn()
  function Harness() {
    const [node, setNode] = useState<BuilderNode | null>(initial)
    return (
      <Inspector
        content={node ? contentWith(node) : { schema_version: 1, sections: [] }}
        node={node}
        document={{ id: 'd-1', title: 'Home', path: '/', published: options.published ?? null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={options.errors ?? []}
        onChange={(next, opts) => {
          onChange(next, opts)
          setNode(next)
        }}
        onCommand={onCommand}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(<Harness />)
  return { user, onChange, onCommand, last: () => onChange.mock.calls.at(-1)?.[0] as BuilderNode, lastOpts: () => onChange.mock.calls.at(-1)?.[1] }
}

const banner = (id: string, name: string): Banner => ({
  id,
  placement: 'hero_slider',
  name,
  kicker: null,
  title: null,
  subtitle: null,
  link_url: null,
  button_label: null,
  secondary_link_url: null,
  secondary_button_label: null,
  desktop_media_id: `media-${id}`,
  mobile_media_id: null,
  text_color: '#ffffff',
  text_position: 'left',
  starts_at: null,
  ends_at: null,
  is_active: true,
  is_live: true,
  state: 'live',
  sort_order: 0,
  updated_at: null,
})

function mockStore(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({
      pages: [{ id: 'p-1', slug: 'about-us', title: 'About us', status: 'published' }],
      categories: [{ id: 'cat-1', name: 'Juices', url: '/category/juices' }],
      brands: [],
      blog_categories: [],
      blog_posts: [],
    }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e', border: '#e5e7eb' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    'GET /storefront/banners': ok([banner(UUID, 'Eid sale')]),
    'GET /media': ok([], page),
    ...extra,
  })
}

describe('Inspector: page settings', () => {
  it('shows the page when nothing is selected', () => {
    mockStore()
    setup(null, { published: { number: 3, published_at: '2026-11-10T10:00:00+06:00' }, locales: ['en', 'bn'] })
    const panel = screen.getByRole('complementary', { name: 'Inspector' })
    expect(within(panel).getByText('Home')).toBeInTheDocument()
    expect(within(panel).getByText('/')).toBeInTheDocument()
    expect(within(panel).getByText(/Version 3 ·/)).toBeInTheDocument()
    expect(within(panel).queryByRole('tab')).not.toBeInTheDocument()
  })
})

describe('Inspector: content forms', () => {
  it('edits a heading: text (coalesced), level and link', async () => {
    mockStore()
    const { user, last, lastOpts } = setup(el('heading', { text: 'Hello', level: 2, link: null }))
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()

    const text = screen.getByLabelText('Heading text')
    await user.clear(text)
    expect(await screen.findByText('Enter the heading text.')).toBeInTheDocument()
    await user.type(text, 'Fresh mangoes')
    expect(last()).toMatchObject({ id: 'e_test01', props: { text: 'Fresh mangoes' } })
    expect(lastOpts()).toEqual({ coalesceKey: 'e_test01:text' })

    await user.click(screen.getByRole('combobox', { name: 'Size and importance' }))
    await user.click(await screen.findByRole('option', { name: /Heading 1/ }))
    expect(last()).toMatchObject({ props: { level: 1 } })

    await user.click(screen.getByRole('combobox', { name: 'Link' }))
    await user.click(await screen.findByRole('option', { name: 'About us' }))
    expect(last()).toMatchObject({ props: { link: { url: '/pages/about-us' } } })

    await user.click(screen.getByRole('combobox', { name: 'Link' }))
    await user.click(await screen.findByRole('option', { name: 'Custom link…' }))
    const address = screen.getByRole('textbox', { name: 'Link address' })
    await user.clear(address)
    await user.type(address, 'javascript:x')
    expect(await screen.findByText('Use a site path such as /sale or an http(s) URL.')).toBeInTheDocument()
    await user.clear(address)
    expect(last()).toMatchObject({ props: { link: null } })
  })

  it('writes Bangla texts to translations.bn only when Bangla is enabled', async () => {
    mockStore()
    const { user, last } = setup(el('heading', { text: 'Hello', level: 2, link: null }), { locales: ['en', 'bn'] })
    await user.click(screen.getByRole('button', { name: /বাংলা/ }))
    await user.type(screen.getByLabelText('Heading text in Bangla'), 'স্বাগতম')
    expect(last()).toMatchObject({ props: { text: 'Hello' }, translations: { bn: { text: 'স্বাগতম' } } })
    await user.clear(screen.getByLabelText('Heading text in Bangla'))
    expect((last() as Element).translations).toEqual({})
  })

  it('has no Bangla fields when the store has only English', () => {
    mockStore()
    setup(el('heading', { text: 'Hello', level: 2, link: null }))
    expect(screen.queryByRole('button', { name: /বাংলা/ })).not.toBeInTheDocument()
  })

  it('edits a button and requires its text', async () => {
    mockStore()
    const { user, last } = setup(el('button', { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }))
    expect(screen.getByRole('combobox', { name: 'Opens' })).toHaveTextContent('All products')
    await user.clear(screen.getByLabelText('Button text'))
    expect(await screen.findByText('Enter the button text.')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Full width' }))
    expect(last()).toMatchObject({ props: { label: '', full_width: true } })
    await user.click(screen.getByRole('combobox', { name: 'Look' }))
    await user.click(await screen.findByRole('option', { name: 'Outline' }))
    expect(last()).toMatchObject({ props: { variant: 'outline' } })
  })

  it('chooses an image from the media library and reports its media ref', async () => {
    const image = { id: UUID, url: 'https://cdn.test/a.jpg', srcset: 'https://cdn.test/a.jpg 800w', width: 800, height: 600, alt: 'Mangoes', original_name: 'a.jpg', mime_type: 'image/jpeg', size: 1, created_at: null }
    mockStore({ 'GET /media': ok([image], page) })
    const { user, last, lastOpts } = setup(el('image', { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' }))
    await user.click(screen.getByRole('button', { name: 'Choose image' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose an image' })
    await user.click(await within(dialog).findByRole('button', { name: 'Mangoes' }))
    await user.click(within(dialog).getByRole('button', { name: 'Use image' }))
    await waitFor(() => expect(last()).toMatchObject({ props: { media_id: UUID } }))
    expect(lastOpts()).toEqual({ media: { [UUID]: { id: UUID, url: image.url, srcset: image.srcset, width: 800, height: 600, alt: 'Mangoes' } } })

    await user.type(screen.getByLabelText('Description (alt text)'), 'Ripe')
    expect(last()).toMatchObject({ props: { alt: 'Ripe' } })
    await user.click(screen.getByRole('combobox', { name: 'Shape' }))
    await user.click(await screen.findByRole('option', { name: 'Square (1:1)' }))
    expect(last()).toMatchObject({ props: { aspect: '1:1' } })
    expect(screen.getByRole('combobox', { name: 'Fit' })).toBeInTheDocument()
  })

  it('picks a divider colour from the theme or as hex', async () => {
    mockStore()
    const { user, last } = setup(el('divider', { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' }))
    expect(screen.getByRole('button', { name: 'Theme colour: Borders' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Theme colour: Primary' }))
    expect(last()).toMatchObject({ props: { color: 'theme:primary' } })
    await user.type(screen.getByRole('textbox', { name: 'Colour hex value' }), '#12ab34')
    expect(last()).toMatchObject({ props: { color: '#12ab34' } })
    await user.click(screen.getByRole('combobox', { name: 'Thickness' }))
    await user.click(await screen.findByRole('option', { name: '3 px' }))
    expect(last()).toMatchObject({ props: { thickness: 3 } })
  })

  it('sets a spacer height preset as the only style value', async () => {
    mockStore()
    const { user, last } = setup(el('spacer', {}))
    await user.click(screen.getByRole('combobox', { name: 'Height' }))
    await user.click(await screen.findByRole('option', { name: 'Large (64 px)' }))
    expect(last().style).toEqual({ base: { size: { height: '64px' } } })
    await user.click(screen.getByRole('combobox', { name: 'Height' }))
    await user.click(await screen.findByRole('option', { name: 'Standard (24 px)' }))
    expect(last().style).toEqual({})
  })

  it('edits a rich text element', async () => {
    mockStore()
    const { user, last, lastOpts } = setup(el('text', { html: '<p>Hi</p>' }))
    const editor = await screen.findByRole('textbox', { name: 'Text' })
    await user.clear(editor)
    await user.type(editor, '<p>Hello there</p>')
    expect(last()).toMatchObject({ props: { html: '<p>Hello there</p>' } })
    expect(lastOpts()).toEqual({ coalesceKey: 'e_test01:html' })
  })

  it('changes a section layout and sends column presets to the editor', async () => {
    mockStore()
    const node = contentWith(el('heading', { text: 'x', level: 2, link: null })).sections[0]!
    const { user, last, onCommand } = setup(node)
    expect(screen.getByRole('button', { name: 'Two equal columns' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Three equal columns' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'set-column-preset', nodeId: 's_sec001', preset: '1-1-1' })
    await user.click(screen.getByRole('combobox', { name: 'Width' }))
    await user.click(await screen.findByRole('option', { name: 'Edge to edge' }))
    expect(last()).toMatchObject({ props: { layout: 'full-bleed' } })
  })

  it('shows a column’s widths and selects its section', async () => {
    mockStore()
    const { user, onCommand } = setup(contentWith(el('heading', { text: 'x', level: 2, link: null })).sections[0]!.columns[0]!)
    const widths = screen.getByLabelText('Column width per device')
    expect(within(widths).getAllByText('50 %')).toHaveLength(2)
    expect(within(widths).getByText('50 % (as tablet)')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Advanced/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select the section' }))
    expect(onCommand).toHaveBeenCalledWith({ type: 'select', nodeId: 's_sec001' })
  })

  it('edits a wrapped section with the homepage form, incl. Bangla', async () => {
    mockStore()
    const { user, last } = setup(
      el('newsletter', { title: null, subtitle: null, config: { text: null, button_label: 'Subscribe', image_media_id: null, background: '#c2410c', foreground: '#ffffff' }, items: [] }),
      { locales: ['en', 'bn'] },
    )
    await user.type(screen.getByLabelText('Title'), 'Join us')
    expect(last()).toMatchObject({ props: { title: 'Join us' } })
    await user.clear(screen.getByLabelText('Button label'))
    expect(await screen.findByText('Enter the button label.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /বাংলা/ }))
    await user.type(screen.getByLabelText('Title in Bangla'), 'যোগ দিন')
    expect(last()).toMatchObject({ translations: { bn: { title: 'যোগ দিন' } } })
  })

  it('shows product tab rules', async () => {
    mockStore({ 'GET /catalog/categories': ok([]) })
    const { user, last } = setup(el('product_tabs', { title: null, subtitle: null, config: { tabs: [], limit: 8 }, items: [] }))
    expect(screen.getByText('Add 2 to 5 tabs.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add tab' }))
    expect(last()).toMatchObject({ props: { config: { tabs: [{ label: '', source: 'new_arrivals', category_id: null }] } } })
    expect(await screen.findByText('Enter a label.')).toBeInTheDocument()
  })

  it('maps server problems onto fields and lists the rest at the top', () => {
    mockStore()
    setup(el('hero_slider', { title: null, subtitle: null, config: { autoplay_seconds: 6, height: 'large' }, items: [{ item_type: 'banner', item_id: UUID }] }), {
      errors: [
        { path: 'props.items', message: 'Some banners no longer exist.', code: 'BANNER_NOT_FOUND', ids: [UUID] },
        { path: 'style.base.color', message: 'Unknown colour.' },
      ],
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('these 2 problems are fixed (see the highlighted fields)')
    expect(within(alert).getByText('Unknown colour.')).toBeInTheDocument()
    expect(within(alert).queryByText('Some banners no longer exist.')).not.toBeInTheDocument()
    expect(screen.getByText('Some banners no longer exist.')).toBeInTheDocument()
  })
})

describe('Inspector: advanced tab', () => {
  it('toggles devices and hidden, and schedules in the organization timezone', async () => {
    mockStore()
    const { user, last } = setup(el('heading', { text: 'Hi', level: 2, link: null }))
    await user.click(screen.getByRole('tab', { name: 'Advanced' }))
    await user.click(screen.getByRole('button', { name: 'Show on mobile' }))
    expect(last()).toMatchObject({ visibility: { desktop: true, tablet: true, mobile: false } })
    expect(screen.getByText('Only on desktop and tablet.')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Hide from visitors' }))
    expect(last()).toMatchObject({ hidden: true })

    expect(await screen.findByText('Optional. Time in Asia/Dhaka.')).toBeInTheDocument()
    const from = screen.getByLabelText('Show from')
    await user.type(from, '2026-12-01T09:30')
    await waitFor(() => expect(last()).toMatchObject({ schedule: { starts_at: '2026-12-01T09:30:00+06:00', ends_at: null } }))
    await user.type(screen.getByLabelText('Show until'), '2026-11-30T09:30')
    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Advanced/ })).toContainElement(screen.getByLabelText('has problems'))
  })

  it('edits a section anchor and flags one used by another section', async () => {
    mockStore()
    const { user, last } = setup(contentWith(el('heading', { text: 'x', level: 2, link: null })).sections[0]!)
    await user.click(screen.getByRole('tab', { name: 'Advanced' }))
    await user.type(screen.getByLabelText('Anchor'), 'Hot Offers')
    expect(last()).toMatchObject({ props: { anchor: 'hot-offers' } })
    await user.clear(screen.getByLabelText('Anchor'))
    expect(last()).toMatchObject({ props: { anchor: null } })
    await user.type(screen.getByLabelText('Anchor'), 'offers')
    expect(await screen.findByText('Another section already uses this anchor.')).toBeInTheDocument()
  })
})

describe('createElement', () => {
  const ids = new Set(['s_sec001'])

  it('inserts plain elements and valid wrapped sections directly', async () => {
    await expect(createElement('heading', { registry, existingIds: ids })).resolves.toMatchObject({ type: 'heading', props: { text: 'Your heading' } })
    await expect(createElement('product_grid', { registry, existingIds: ids })).resolves.toMatchObject({ type: 'product_grid', props: { config: { source: 'featured' } } })
    await expect(createElement('blog_posts', { registry, existingIds: ids })).resolves.toMatchObject({ type: 'blog_posts' })
    await expect(createElement('unknown', { registry, existingIds: ids })).resolves.toBeNull()
  })

  it('resolves null for types that need setup when no inspector is mounted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(createElement('hero_slider', { registry, existingIds: ids })).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('opens a setup dialog: Insert is disabled until valid, Cancel resolves null', async () => {
    mockStore()
    const { user } = setup(null)
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('hero_slider', { registry, existingIds: ids })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add hero slider' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    expect(within(dialog).getByText('Choose 1 to 10 banners.')).toBeInTheDocument()

    await user.click(await within(dialog).findByRole('combobox', { name: 'Add a banner' }))
    await user.click(await screen.findByRole('option', { name: 'Eid sale' }))
    expect(insert).toBeEnabled()
    await user.click(insert)
    await expect(pending).resolves.toMatchObject({ type: 'hero_slider', props: { items: [{ item_type: 'banner', item_id: UUID }] } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      pending = createElement('features_strip', { registry, existingIds: ids })
    })
    const second = await screen.findByRole('dialog', { name: 'Add features strip' })
    await user.click(within(second).getByRole('button', { name: 'Cancel' }))
    await expect(pending).resolves.toBeNull()
  })
})
