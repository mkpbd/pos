import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, HorizontalGalleryProps, ScrollStoryStep, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { ELEMENT_WORDS } from '../command-words'
import {
  b19Message,
  b19StartingProps,
  galleryCount,
  pictureWarning,
  pinIsLong,
  pinWarnLimit,
  withItemLink,
  withSource,
  withStepLink,
  withStepLinkLabel,
  withoutTranslation,
} from './b19-model'
import { buildElement } from './create-element'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { clearReveal, revealItem } from './item-reveal'
import { validateNode } from './validate'

/*
 * B19 inspector forms: the scroll story (2–6 steps added / removed / reordered, a picture with its
 * required alt text as a warning, kicker, heading, text, an optional link with its text, layout,
 * picture shape, transition, dots, Bangla per step, a canvas click opening a step) and the
 * horizontal gallery (pictures or products, the other list emptied on a switch, ≤ 12, card width,
 * pin with the tiring-scroll hint above 8, progress).
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID2 = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const UUID3 = '2b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const pagination = (total: number) => ({ pagination: { current_page: 1, per_page: 100, total, last_page: 1 } })
const media = (id: string, alt: string) => ({ id, url: `/m/${id}.jpg`, srcset: '', width: 800, height: 600, alt, original_name: `${alt}.jpg`, mime_type: 'image/jpeg', size: 1, created_at: null })

type AnyProps = Element & { props: Record<string, unknown> }

const node = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const base = buildElement(type, registry, new Set())!
  return { ...base, id: 'e_test01', props: { ...base.props, ...props }, ...extra } as unknown as Element
}

const section = (elements: Element[]): Section =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_sec001', type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

function setup(initial: BuilderNode, options: { locales?: string[]; limits?: Record<string, unknown> } = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    return (
      <Inspector
        content={content}
        node={current}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={{ ...registry, limits: options.limits ?? {} }}
        locales={options.locales ?? ['en']}
        errors={[]}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={() => undefined}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps, opts: () => onChange.mock.calls.at(-1)?.[1] }
}

function mockStore(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    'GET /media': ok([media(UUID, 'Our first shop')], pagination(1)),
    ...extra,
  })
}

const step = (id: string, over: Partial<ScrollStoryStep> = {}): ScrollStoryStep => ({ id, media_id: null, alt: '', kicker: '', heading: `Heading ${id}`, text: '', link: null, ...over })
const pic = (id: string, over: Record<string, unknown> = {}) => ({ id, media_id: UUID, alt: `Photo ${id}`, caption: '', link: null, ...over })
const story = (steps: ScrollStoryStep[], props: Record<string, unknown> = {}) => node('scroll_story', { steps, ...props })
const gallery = (props: Partial<HorizontalGalleryProps> = {}) => node('horizontal_gallery', { items: [pic('i_a'), pic('i_b')], product_ids: [], ...props })
const cards = () => screen.getAllByTestId('item-card')

afterEach(() => {
  // A request left over from a test must not open a card in the next one.
  revealItem(null, null)
})

describe('B19 model', () => {
  it('links: set with a starting text, relabel, and back to null; Bangla link text dropped with it', () => {
    const s = step('s_1')
    const linked = withStepLink(s, '/shop')
    expect(linked.link).toEqual({ label: 'Learn more', url: '/shop' })
    expect(withStepLinkLabel(linked, 'See more').link).toEqual({ label: 'See more', url: '/shop' })
    expect(withStepLink(withStepLinkLabel(linked, 'See more'), '/about').link).toEqual({ label: 'See more', url: '/about' })
    expect(withStepLink(linked, null).link).toBeNull()
    expect(withStepLinkLabel(s, 'x')).toBe(s)
    expect(withItemLink(pic('i_a'), '/sale').link).toEqual({ url: '/sale' })
    expect(withItemLink(pic('i_a', { link: { url: '/x' } }), null).link).toBeNull()
    expect(withoutTranslation({ bn: { 'steps.s_1.link.label': 'আরও', 'steps.s_1.heading': 'শিরোনাম' } }, 'steps.s_1.link.label')).toEqual({ bn: { 'steps.s_1.heading': 'শিরোনাম' } })
    expect(withoutTranslation({ bn: { 'steps.s_1.link.label': 'আরও' } }, 'steps.s_1.link.label')).toEqual({})
  })

  it('gallery source: the other list is emptied and comes back from the session stash', () => {
    const p = { source: 'images', items: [pic('i_a'), pic('i_b')], product_ids: [], card_width: 'medium', pin: true, show_progress: true } as HorizontalGalleryProps
    const products = withSource(p, 'products', { product_ids: [UUID, UUID2] })
    expect(products).toMatchObject({ source: 'products', items: [], product_ids: [UUID, UUID2] })
    expect(withSource(products, 'images')).toMatchObject({ source: 'images', items: [], product_ids: [] })
    expect(withSource(p, 'images')).toBe(p)
    expect(galleryCount(products)).toBe(2)
  })

  it('pin hint above 8 (or the registry limit) only while pinned', () => {
    const items = Array.from({ length: 9 }, (_, i) => pic(`i_${i}`))
    const p = { source: 'images', items, product_ids: [], pin: true } as Pick<HorizontalGalleryProps, 'source' | 'items' | 'product_ids' | 'pin'>
    expect(pinIsLong(p)).toBe(true)
    expect(pinIsLong({ ...p, pin: false })).toBe(false)
    expect(pinIsLong({ ...p, items: items.slice(0, 8) })).toBe(false)
    expect(pinIsLong(p, pinWarnLimit({ horizontal_gallery_pin_warn: 10 }))).toBe(false)
    expect(pinWarnLimit({})).toBe(8)
    expect(pinWarnLimit({ horizontal_gallery_pin_warn: 'x' })).toBe(8)
  })

  it('pictures: missing picture, then missing alt text, are warnings', () => {
    expect(pictureWarning({ media_id: null, alt: '' })).toMatch(/Choose a picture/)
    expect(pictureWarning({ media_id: UUID, alt: ' ' })).toMatch(/Describe the picture/)
    expect(pictureWarning({ media_id: UUID, alt: 'A shop' })).toBeNull()
  })

  it('friendly messages for the shared rules', () => {
    expect(b19Message('scroll_story', { path: 'steps', code: 'too_few' })).toBe('Add 2 to 6 steps.')
    expect(b19Message('scroll_story', { path: 'steps.1.heading', code: 'required' })).toBe('Give the step a heading.')
    expect(b19Message('scroll_story', { path: 'steps.1.text', code: 'too_long' })).toBe('At most 600 characters.')
    expect(b19Message('scroll_story', { path: 'steps.0.link.label', code: 'required' })).toBe('Enter the link text.')
    expect(b19Message('scroll_story', { path: 'steps.0.link.url', code: 'invalid' })).toMatch(/https:/)
    expect(b19Message('horizontal_gallery', { path: 'product_ids', code: 'too_many' })).toBe('Add 2 to 12 products.')
    expect(b19Message('horizontal_gallery', { path: 'product_ids.3', code: 'duplicate' })).toBe('A product is in the list twice.')
    expect(b19Message('horizontal_gallery', { path: 'items.0.caption', code: 'too_long' })).toBe('At most 120 characters.')
  })

  it('a new story starts with 3 steps and a gallery with 2 pictures, every key present and valid without media', () => {
    expect(b19StartingProps('scroll_story', { steps: [] }).steps).toHaveLength(3)
    expect(b19StartingProps('scroll_story', { steps: [step('s_x'), step('s_y')] })).toEqual({})
    expect(b19StartingProps('horizontal_gallery', { source: 'products', items: [] })).toEqual({})
    const s = buildElement('scroll_story', registry, new Set())!
    const steps = (s.props as { steps: ScrollStoryStep[] }).steps
    expect(steps).toHaveLength(3)
    expect(Object.keys(steps[0]!).sort()).toEqual(['alt', 'heading', 'id', 'kicker', 'link', 'media_id', 'text'])
    expect(validateNode(s)).toEqual([])
    const g = buildElement('horizontal_gallery', registry, new Set())!
    expect((g.props as HorizontalGalleryProps).items).toEqual([
      { id: expect.any(String), media_id: null, alt: '', caption: '', link: null },
      { id: expect.any(String), media_id: null, alt: '', caption: '', link: null },
    ])
    expect(validateNode(g)).toEqual([])
  })

  it('validation: heading required, 2–6 steps, products 2–12; translatable step and picture texts', () => {
    expect(validateNode(story([step('s_1', { heading: ' ' }), step('s_2')]))).toEqual([{ path: 'props.steps.0.heading', message: 'Give the step a heading.' }])
    expect(validateNode(story([step('s_1')]))).toEqual([{ path: 'props.steps', message: 'Add 2 to 6 steps.' }])
    expect(validateNode(gallery({ source: 'products', items: [], product_ids: [UUID] }))).toEqual([{ path: 'props.product_ids', message: 'Add 2 to 12 products.' }])
    expect(validateNode(gallery({ source: 'products', items: [], product_ids: [UUID, UUID2] }))).toEqual([])
    const long = story([step('s_1'), step('s_2')], {})
    expect(validateNode({ ...long, translations: { bn: { 'steps.s_1.link.label': 'x'.repeat(41), 'steps.s_2.heading': 'ঠিক আছে' } } })).toEqual([{ path: 'translations.bn.steps.s_1.link.label', message: 'At most 40 characters.' }])
  })

  it('Insert library: icons, plain hints and search words', () => {
    for (const type of ['scroll_story', 'horizontal_gallery']) {
      expect(ELEMENT_ICONS[type]).toBeDefined()
      expect(ELEMENT_HINTS[type]).toMatch(/scroll/)
      expect(ELEMENT_WORDS[type]).toMatch(/[ঀ-৿]/)
    }
  })
})

describe('B19 scroll story form', () => {
  it('adds steps up to 6, removes down to 2, reorders with the keyboard buttons', async () => {
    mockStore()
    const { user, last } = setup(story([step('s_1'), step('s_2'), step('s_3')]))
    expect(cards()).toHaveLength(3)
    expect(screen.getByText('3 of 6')).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add step' })
    for (let i = 0; i < 3; i++) await user.click(add)
    expect(cards()).toHaveLength(6)
    expect(add).toBeDisabled()
    const steps = () => last().props.steps as ScrollStoryStep[]
    expect(steps()[3]).toMatchObject({ media_id: null, alt: '', kicker: 'Step 4', heading: 'A new chapter', link: null })

    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(steps().slice(0, 2).map((s) => s.id)).toEqual(['s_2', 's_1'])

    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: `Remove step ${6 - i}` }))
    expect(cards()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeDisabled()
    expect(steps().map((s) => s.id)).toEqual(['s_2', 's_1'])
  })

  it('a step: picture with its alt text (prefilled from the library), warnings, texts and an optional link', async () => {
    mockStore()
    const { user, last, opts } = setup(story([step('s_1'), step('s_2')]))
    await user.click(within(cards()[0]!).getByRole('button', { expanded: false, name: /Heading s_1/ }))
    const card = within(within(cards()[0]!).getByRole('group', { name: 'step 1' }))
    expect(card.getByTestId('step-picture-warning')).toHaveTextContent('Choose a picture')

    await user.click(card.getByRole('button', { name: 'Choose image' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose the step’s picture' })
    await user.click(await within(picker).findByRole('button', { name: 'Our first shop' }))
    await user.click(within(picker).getByRole('button', { name: /^Use/ }))
    await waitFor(() => expect((last().props.steps as ScrollStoryStep[])[0]).toMatchObject({ media_id: UUID, alt: 'Our first shop' }))
    expect(opts()).toMatchObject({ media: { [UUID]: expect.objectContaining({ id: UUID }) } })
    expect(card.queryByTestId('step-picture-warning')).toBeNull()

    await user.clear(card.getByLabelText('Description (alt text)'))
    expect(card.getByTestId('step-picture-warning')).toHaveTextContent('Describe the picture')

    await user.type(card.getByLabelText('Small line above the heading'), 'Since 2012')
    await user.clear(card.getByLabelText('Heading'))
    expect(card.getByText('Give the step a heading.')).toBeInTheDocument()
    await user.type(card.getByLabelText('Heading'), 'Where it began')
    await user.type(card.getByLabelText('Text'), 'A small shop.')
    expect((last().props.steps as ScrollStoryStep[])[0]).toMatchObject({ kicker: 'Since 2012', heading: 'Where it began', text: 'A small shop.' })
    expect(opts()).toMatchObject({ coalesceKey: 'e_test01:steps:s_1.text' })

    expect(card.queryByLabelText('Link text')).toBeNull()
    await user.click(card.getByRole('combobox', { name: 'Link' }))
    await user.click(await screen.findByRole('option', { name: 'All products' }))
    expect((last().props.steps as ScrollStoryStep[])[0]!.link).toEqual({ label: 'Learn more', url: '/shop' })
    await user.clear(card.getByLabelText('Link text'))
    expect(card.getByText('Enter the link text.')).toBeInTheDocument()
    await user.type(card.getByLabelText('Link text'), 'Shop the story')
    expect((last().props.steps as ScrollStoryStep[])[0]!.link).toEqual({ label: 'Shop the story', url: '/shop' })
  })

  it('layout, picture shape, transition and dots', async () => {
    mockStore()
    const { user, last } = setup(story([step('s_1'), step('s_2')]))
    await user.click(screen.getByRole('combobox', { name: 'Picture side' }))
    await user.click(await screen.findByRole('option', { name: 'Picture on the right' }))
    await user.click(screen.getByRole('combobox', { name: 'Picture shape' }))
    await user.click(await screen.findByRole('option', { name: 'Square' }))
    await user.click(screen.getByRole('combobox', { name: 'Picture change' }))
    await user.click(await screen.findByRole('option', { name: 'Zoom into the next picture' }))
    await user.click(screen.getByRole('switch', { name: 'Show progress dots' }))
    expect(last().props).toMatchObject({ media_side: 'right', media_ratio: 'square', transition: 'zoom', progress_dots: false })
  })

  it('Bangla fields of each step, the link text only with a link', async () => {
    mockStore()
    const { user, last } = setup(story([step('s_1', { link: { label: 'More', url: '/shop' } }), step('s_2')]), { locales: ['en', 'bn'] })
    await user.click(within(cards()[0]!).getByRole('button', { expanded: false, name: /Heading s_1/ }))
    const card = within(within(cards()[0]!).getByRole('group', { name: 'step 1' }))
    await user.click(card.getByRole('button', { name: /বাংলা/ }))
    await user.type(card.getByLabelText('Heading in Bangla'), 'শুরু')
    expect(last().translations).toEqual({ bn: { 'steps.s_1.heading': 'শুরু' } })
    for (const field of ['Description (alt text)', 'Small line above the heading', 'Text', 'Link text']) expect(card.getByLabelText(`${field} in Bangla`)).toBeInTheDocument()
    await user.type(card.getByLabelText('Link text in Bangla'), 'আরও')
    // Removing the link drops its Bangla text too.
    await user.click(card.getByRole('combobox', { name: 'Link' }))
    await user.click(await screen.findByRole('option', { name: 'No link' }))
    expect(last().translations).toEqual({ bn: { 'steps.s_1.heading': 'শুরু' } })
    expect((last().props.steps as ScrollStoryStep[])[0]!.link).toBeNull()
    expect(card.queryByLabelText('Link text in Bangla')).toBeNull()
  })

  it('a click on a step on the canvas opens its card', async () => {
    mockStore()
    setup(story([step('s_1'), step('s_2'), step('s_3')]))
    expect(screen.queryByRole('group', { name: 'step 3' })).toBeNull()
    act(() => revealItem('e_test01', 's_3'))
    expect(await screen.findByRole('group', { name: 'step 3' })).toBeInTheDocument()
    // Handled once: the request is cleared.
    act(() => clearReveal(Number.MAX_SAFE_INTEGER))
    expect(screen.getByRole('group', { name: 'step 3' })).toBeInTheDocument()
    // A click on another node's item does nothing here.
    act(() => revealItem('e_other1', 's_2'))
    expect(screen.queryByRole('group', { name: 'step 2' })).toBeNull()
  })
})

describe('B19 horizontal gallery form', () => {
  it('pictures: list up to 12, alt warning, caption and link; card width, pin, progress', async () => {
    mockStore()
    const { user, last } = setup(gallery({ items: [pic('i_a'), pic('i_b', { alt: '' })] }))
    expect(screen.getByText('2 of 12')).toBeInTheDocument()
    await user.click(within(cards()[1]!).getByRole('button', { expanded: false }))
    const card = within(within(cards()[1]!).getByRole('group', { name: 'picture 2' }))
    expect(card.getByTestId('gallery-picture-warning')).toHaveTextContent('Describe the picture')
    await user.type(card.getByLabelText('Description (alt text)'), 'Red scarf')
    await user.type(card.getByLabelText('Caption'), 'New')
    expect((last().props.items as { alt: string; caption: string }[])[1]).toMatchObject({ alt: 'Red scarf', caption: 'New' })

    await user.click(screen.getByRole('combobox', { name: 'Card width' }))
    await user.click(await screen.findByRole('option', { name: 'Large' }))
    await user.click(screen.getByRole('switch', { name: 'Show a progress bar' }))
    expect(last().props).toMatchObject({ card_width: 'large', show_progress: false })
    expect(screen.queryByTestId('gallery-pin-hint')).toBeNull()
  })

  it('the tiring-scroll hint above 8 pinned cards (registry limit), gone when pinning is off', async () => {
    mockStore()
    const { user } = setup(gallery({ items: Array.from({ length: 9 }, (_, i) => pic(`i_${i}`)) }), { limits: { horizontal_gallery_pin_warn: 8 } })
    expect(screen.getByTestId('gallery-pin-hint')).toHaveTextContent('9 cards is a long pinned scroll')
    await user.click(screen.getByRole('switch', { name: 'Pin while scrolling' }))
    expect(screen.queryByTestId('gallery-pin-hint')).toBeNull()
  })

  it('products: switching empties the pictures; the product grid picker adds, orders and removes; switching back restores them', async () => {
    mockStore({
      'GET /products': ok([
        { id: UUID2, name: 'Straw hat', variants: [{ sku: 'SH-1' }], images: [], is_active: true },
        { id: UUID3, name: 'Linen shirt', variants: [{ sku: 'LS-1' }], images: [], is_active: true },
      ], pagination(2)),
      [`GET /products/${UUID2}`]: ok({ id: UUID2, name: 'Straw hat', images: [] }),
      [`GET /products/${UUID3}`]: ok({ id: UUID3, name: 'Linen shirt', images: [] }),
    })
    const { user, last } = setup(gallery())
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'Products' }))
    expect(last().props).toMatchObject({ source: 'products', items: [], product_ids: [] })
    expect(screen.getByText('Add 2 to 12 products.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.click(await screen.findByRole('option', { name: /Straw hat/ }))
    await user.click(screen.getByRole('button', { name: 'Add product' }))
    await user.click(await screen.findByRole('option', { name: /Linen shirt/ }))
    expect(last().props.product_ids).toEqual([UUID2, UUID3])
    await user.click(screen.getByRole('button', { name: 'Move Linen shirt up' }))
    expect(last().props.product_ids).toEqual([UUID3, UUID2])

    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'Pictures' }))
    expect(last().props).toMatchObject({ source: 'images', product_ids: [], items: [{ id: 'i_a' }, { id: 'i_b' }] })
    await user.click(screen.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'Products' }))
    expect(last().props).toMatchObject({ source: 'products', items: [], product_ids: [UUID3, UUID2] })
  })

  it('a click on a picture on the canvas opens its card', async () => {
    mockStore()
    setup(gallery({ items: [pic('i_a'), pic('i_b'), pic('i_c')] }))
    expect(screen.queryByRole('group', { name: 'picture 3' })).toBeNull()
    act(() => revealItem('e_test01', 'i_c'))
    expect(await screen.findByRole('group', { name: 'picture 3' })).toBeInTheDocument()
  })
})
