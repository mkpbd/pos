import { useState } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { buildElement } from './create-element'
import { createElement, Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { validateNode } from './validate'

/*
 * B8a inspector forms: pricing plans with nested features, before / after, the comparison grid,
 * flash sale bar, bundle, team members with links, review wall, photo grid, the store hours week
 * editor, progress bars and the chart's stacked kinds and store data sources.
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

function setup(initial: BuilderNode, options: { locales?: string[] } = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    return (
      <Inspector
        content={content}
        node={current}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={[]}
        theme={{ colors: { primary: '#0f766e', canvas: '#ffffff' } }}
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
  return { user, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps, opts: () => onChange.mock.calls.at(-1)?.[1] }
}

const products = {
  'GET /products': ok(
    [
      { id: UUID, name: 'Straw hat', variants: [{ sku: 'SH-1' }], images: [], is_active: true },
      { id: UUID2, name: 'Linen shirt', variants: [{ sku: 'LS-1' }], images: [], is_active: true },
    ],
    pagination(2),
  ),
  [`GET /products/${UUID}`]: ok({ id: UUID, name: 'Straw hat', images: [] }),
  [`GET /products/${UUID2}`]: ok({ id: UUID2, name: 'Linen shirt', images: [] }),
}

function mockStore(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    ...products,
    ...extra,
  })
}

const cards = () => screen.getAllByTestId('item-card')

describe('B8a catalogue', () => {
  it('every B8a element has an icon and a one-line hint', () => {
    for (const type of ['pricing_table', 'before_after', 'comparison_table', 'flash_sale_bar', 'bundle', 'team', 'review_wall', 'photo_grid', 'store_hours', 'progress_bars']) {
      expect(ELEMENT_ICONS[type], type).toBeDefined()
      expect(ELEMENT_HINTS[type], type).toMatch(/^[A-Z].{10,70}\.$/)
    }
  })
})

describe('B8a forms: selling blocks', () => {
  it('pricing table: price typed in Bangla digits, a word instead of a price, features per plan', async () => {
    mockStore()
    const { user, last } = setup(node('pricing_table'))
    const plans = () => last().props.plans as { name: string; price: string | null; price_text: string; features: { id: string; text: string; included: boolean }[]; button: unknown }[]
    expect(cards()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /^Basic · Free/ }))
    const plan = within(screen.getByRole('group', { name: 'plan 1' }))
    expect(plan.getByLabelText('Instead of a price')).toHaveValue('Free')

    await user.click(plan.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: 'A price' }))
    expect(plans()[0]!.price).toBe('0')
    await user.clear(plan.getByLabelText('Price'))
    await user.type(plan.getByLabelText('Price'), '১,২৫০')
    expect(plans()[0]!.price).toBe('1250')
    await user.type(plan.getByLabelText('Price'), '.555')
    expect(plan.getByText(/Use a price such as 1250/)).toBeInTheDocument()
    expect(plans()[0]!.price).toBe('1250.55')

    // A feature of this plan: added, switched to "not included".
    await user.click(plan.getByRole('button', { name: 'Add feature' }))
    expect(plans()[0]!.features).toHaveLength(2)
    const feature = within(plan.getByRole('group', { name: 'feature 2' }))
    await user.clear(feature.getByLabelText('Feature'))
    await user.type(feature.getByLabelText('Feature'), 'Free delivery')
    await user.click(feature.getByRole('switch', { name: 'Included' }))
    expect(plans()[0]!.features[1]).toMatchObject({ text: 'Free delivery', included: false })
    expect(plan.getByRole('img', { name: 'Not included' })).toBeInTheDocument()

    await user.click(plan.getByRole('switch', { name: 'Show a button' }))
    expect(plans()[0]!.button).toEqual({ label: 'Choose', url: '/shop' })
    expect(validateNode(last())).toEqual([])

    // Back to a word: an empty word is reported (the server needs it).
    await user.click(plan.getByRole('combobox', { name: 'Show' }))
    await user.click(await screen.findByRole('option', { name: /A word instead/ }))
    await user.clear(plan.getByLabelText('Instead of a price'))
    expect(validateNode(last()).map((p) => p.path)).toContain('props.plans.0.price_text')
    expect(plan.getByText('Enter what to show instead of a price, e.g. “Free”.')).toBeInTheDocument()
  })

  it('pricing table: Bangla per plan and per feature (`plans.<id>.features.<id>.text`), dropped with the feature', async () => {
    mockStore()
    const start = node('pricing_table', {}, { translations: { bn: { 'plans.plan-1.name': 'বেসিক', 'plans.plan-1.features.feature-1.text': 'ফিচার' } } })
    const { user, last } = setup(start, { locales: ['en', 'bn'] })
    await user.click(screen.getByRole('button', { name: /^Basic · Free/ }))
    const plan = within(screen.getByRole('group', { name: 'plan 1' }))
    expect(plan.getByLabelText('Plan name in Bangla')).toHaveValue('বেসিক')
    const feature = within(plan.getByRole('group', { name: 'feature 1' }))
    expect(feature.getByLabelText('Feature in Bangla')).toHaveValue('ফিচার')
    await user.click(plan.getByRole('button', { name: 'Add feature' }))
    await user.click(plan.getByRole('button', { name: 'Remove feature 1' }))
    expect(last().translations.bn).toEqual({ 'plans.plan-1.name': 'বেসিক' })
  })

  it('before / after: the setup dialog waits for both photos; handle start, direction and shape', async () => {
    mockStore({ 'GET /media': ok([media(UUID, 'Old sofa'), media(UUID2, 'New sofa')], pagination(2)) })
    const { user } = setup(node('heading'))
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('before_after', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add before / after' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    for (const [side, name] of [['before', 'Old sofa'], ['after', 'New sofa']] as const) {
      await user.click(within(within(dialog).getByTestId(`side-${side}`)).getByRole('button', { name: 'Choose image' }))
      const picker = await screen.findByRole('dialog', { name: new RegExp(`Choose the “${side}” photo`) })
      await user.click(await within(picker).findByRole('button', { name }))
      await user.click(within(picker).getByRole('button', { name: 'Use image' }))
    }
    await user.type(within(within(dialog).getByTestId('side-before')).getByLabelText('Description (alt text)'), 'The sofa before')
    fireEvent.change(within(dialog).getByLabelText('Where the handle starts'), { target: { value: '30' } })
    await waitFor(() => expect(insert).toBeEnabled())
    await user.click(insert)
    const inserted = (await pending) as AnyProps
    expect(inserted.props).toMatchObject({ before: { media_id: UUID, alt: 'The sofa before' }, after: { media_id: UUID2, alt: '' }, start: 30, aspect: '4:3' })
  })

  it('comparison table: columns keep the grid in step; cells are yes / no / text; a text cell needs its text', async () => {
    mockStore()
    const { user, last } = setup(node('comparison_table'), { locales: ['en', 'bn'] })
    const rows = () => last().props.rows as { id: string; label: string; cells: Record<string, { kind: string; text: string }> }[]
    const grid = within(screen.getByTestId('comparison-grid'))
    expect(grid.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Feature', 'Ours', 'Others', 'Row actions'])

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    const columns = () => last().props.columns as { id: string; title: string; product_id: string | null }[]
    const added = columns()[2]!.id
    expect(rows()[0]!.cells[added]).toEqual({ kind: 'no', text: '' })

    await user.selectOptions(grid.getByLabelText('Free delivery, Others'), 'text')
    expect(validateNode(last()).map((p) => p.path)).toContain('props.rows.0.cells.col-2.text')
    await user.type(grid.getByLabelText('Free delivery, Others: text'), 'Over ৳1000')
    expect(rows()[0]!.cells['col-2']).toEqual({ kind: 'text', text: 'Over ৳1000' })

    await user.click(grid.getByRole('button', { name: 'Add row' }))
    expect(rows()).toHaveLength(2)
    expect(Object.keys(rows()[1]!.cells)).toEqual(['col-1', 'col-2', added])
    await user.click(grid.getByRole('button', { name: 'Move row 2 up' }))
    expect(rows().map((r) => r.label)).toEqual(['New feature', 'Free delivery'])

    // The Bangla section lists each row and each text cell.
    await user.click(screen.getAllByRole('button', { name: /বাংলা/ }).at(-1)!)
    await user.type(screen.getByLabelText('Row 2, Others in Bangla'), '১০০০ টাকার বেশি')
    expect(last().translations.bn).toMatchObject({ 'rows.row-1.cells.col-2.text': '১০০০ টাকার বেশি' })
    // Removing the column drops its cells and their Bangla texts.
    await user.click(screen.getByRole('button', { name: 'Remove column 2' }))
    expect(rows().every((r) => !('col-2' in r.cells))).toBe(true)
    expect(last().translations.bn ?? {}).not.toHaveProperty('rows.row-1.cells.col-2.text')
    expect(validateNode(last())).toEqual([])
  })

  it('comparison table: a column may show a product (optional); the same product twice is reported', async () => {
    mockStore()
    const { user, last } = setup(node('comparison_table'))
    await user.click(screen.getByRole('button', { name: /^Ours/ }))
    const first = within(screen.getByRole('group', { name: 'column 1' }))
    await user.click(first.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Straw hat/ }))
    await user.click(screen.getByRole('button', { name: /^Others/ }))
    const second = within(screen.getByRole('group', { name: 'column 2' }))
    await user.click(second.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Straw hat/ }))
    expect((last().props.columns as { product_id: string }[]).map((c) => c.product_id)).toEqual([UUID, UUID])
    expect(second.getByText(/already in another column/)).toBeInTheDocument()
    await user.click(second.getByRole('button', { name: 'Remove' }))
    expect((last().props.columns as { product_id: string | null }[])[1]!.product_id).toBeNull()
    expect(validateNode(last())).toEqual([])
  })

  it('flash sale bar: the sale that ends soonest or a chosen one; products and a button', async () => {
    mockStore({
      'GET /promotions': ok([{ id: UUID3, name: 'Eid flash sale', type: 'percent', value: '20', trigger: 'automatic', state: 'active', show_countdown: true }], pagination(1)),
    })
    const { user, last } = setup(node('flash_sale_bar'))
    expect(last).toBeDefined()
    await user.click(screen.getByRole('combobox', { name: 'Which sale' }))
    await user.click(await screen.findByRole('option', { name: 'A sale I choose' }))
    const sale = screen.getByRole('combobox', { name: 'Sale' })
    await waitFor(() => expect(sale).toBeEnabled())
    await user.click(sale)
    await user.click(await screen.findByRole('option', { name: /Eid flash sale/ }))
    expect(last().props.promotion_id).toBe(UUID3)
    await user.clear(screen.getByLabelText('At most this many products'))
    await user.type(screen.getByLabelText('At most this many products'), '6')
    await user.click(screen.getByRole('switch', { name: 'Show a button' }))
    expect(last().props).toMatchObject({ product_limit: 6, button: { label: 'Shop the sale', url: '/shop' } })
    expect(validateNode(last())).toEqual([])
    await user.click(screen.getByRole('combobox', { name: 'Which sale' }))
    await user.click(await screen.findByRole('option', { name: 'The sale that ends soonest' }))
    expect(last().props.promotion_id).toBeNull()
  })

  it('data notes: a flash sale that has ended keeps the bar hidden', async () => {
    mockStore({ 'POST /storefront/builder/resolve': ok({ data: { e_test01: { promotion: { id: UUID3, name: 'Eid', ends_at: null, state: 'expired' }, products: [], claimed: null } }, media: {}, errors: {} }) })
    setup(node('flash_sale_bar'))
    expect(await screen.findByText(/This sale has ended — the bar stays hidden on your shop/)).toBeInTheDocument()
  })

  it('data notes: a comparison column whose product is not sold online keeps its title only', async () => {
    mockStore({ 'POST /storefront/builder/resolve': ok({ data: { e_test01: { products: [], columns: { 'col-2': { state: 'unavailable' } } } }, media: {}, errors: {} }) })
    setup(node('comparison_table', { columns: [{ id: 'col-1', title: 'Ours', product_id: null, highlighted: true }, { id: 'col-2', title: 'Others', product_id: UUID, highlighted: false }] }))
    expect(await screen.findByText('“Others”: its product isn’t sold online now, so the column shows its title only.')).toBeInTheDocument()
  })

  it('bundle: inserted only with two products; one product twice is reported', async () => {
    mockStore()
    const { user } = setup(node('heading'))
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('bundle', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add bundle' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(within(dialog).getByText('Add at least 2 products.')).toBeInTheDocument()
    for (const name of [/Straw hat/, /Straw hat/]) {
      await user.click(within(dialog).getByRole('button', { name: 'Add product' }))
      const card = within(within(dialog).getAllByTestId('item-card').at(-1)!)
      await user.click(card.getByRole('button', { name: 'Choose product' }))
      await user.click(await screen.findByRole('option', { name }))
    }
    expect(insert).toBeDisabled()
    expect(within(dialog).getByText('This product is already in the list; choose another one.')).toBeInTheDocument()
    const second = within(within(dialog).getAllByTestId('item-card')[1]!)
    await user.click(second.getByRole('button', { name: 'Change product' }))
    await user.click(await screen.findByRole('option', { name: /Linen shirt/ }))
    await waitFor(() => expect(insert).toBeEnabled())
    await user.click(insert)
    const inserted = (await pending) as AnyProps
    expect((inserted.props.items as { product_id: string }[]).map((i) => i.product_id)).toEqual([UUID, UUID2])
  })
})

describe('B8a forms: trust & people', () => {
  it('team: people with a role, links by kind (email → mailto:, others https only), people per row', async () => {
    mockStore()
    const { user, last } = setup(node('team'), { locales: ['en', 'bn'] })
    const member = within(screen.getByRole('group', { name: 'person 1' }))
    await user.clear(member.getByLabelText('Name'))
    await user.type(member.getByLabelText('Name'), 'Rina')
    await user.type(member.getByLabelText('Role'), 'Founder')
    await user.click(member.getByRole('button', { name: 'Add link' }))
    const link = within(member.getByRole('group', { name: 'link 1' }))
    await user.type(link.getByLabelText('Page address'), 'http://instagram.com/rina')
    expect(link.getByText(/https/)).toBeInTheDocument()
    await user.clear(link.getByLabelText('Page address'))
    await user.type(link.getByLabelText('Page address'), 'https://instagram.com/rina')
    await user.click(member.getByRole('button', { name: 'Add link' }))
    const mail = within(member.getByRole('group', { name: 'link 2' }))
    await user.click(mail.getByRole('combobox', { name: 'Kind' }))
    await user.click(await screen.findByRole('option', { name: 'Email' }))
    await user.type(mail.getByLabelText('Email address'), 'rina@shop.com')
    const members = () => last().props.members as { name: string; role: string; links: { kind: string; url: string }[] }[]
    expect(members()[0]).toMatchObject({ name: 'Rina', role: 'Founder', links: [{ kind: 'instagram', url: 'https://instagram.com/rina' }, { kind: 'email', url: 'mailto:rina@shop.com' }] })
    // Names aren't translated; role and bio are.
    expect(member.queryByLabelText('Name in Bangla')).not.toBeInTheDocument()
    await user.click(member.getByRole('button', { name: /বাংলা/ }))
    await user.type(member.getByLabelText('Role in Bangla'), 'প্রতিষ্ঠাতা')
    expect(last().translations.bn).toEqual({ 'members.member-1.role': 'প্রতিষ্ঠাতা' })

    await user.click(screen.getByRole('combobox', { name: 'People per row on mobile' }))
    await user.click(await screen.findByRole('option', { name: '1' }))
    expect(last().props.columns).toEqual({ base: 3, mobile: 1 })
    expect(validateNode(last())).toEqual([])
  })

  it('review wall: one product’s reviews need the product; rating and count', async () => {
    mockStore()
    const { user, last } = setup(node('review_wall'))
    await user.click(screen.getByRole('combobox', { name: 'Which reviews' }))
    await user.click(await screen.findByRole('option', { name: 'Of one product' }))
    expect(screen.getByText('Choose a product.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Linen shirt/ }))
    await user.click(screen.getByRole('combobox', { name: 'Lowest rating shown' }))
    await user.click(await screen.findByRole('option', { name: '5 stars only' }))
    expect(last().props).toMatchObject({ source: 'product', product_id: UUID2, min_rating: 5 })
    expect(validateNode(last())).toEqual([])
    await user.click(screen.getByRole('combobox', { name: 'Which reviews' }))
    await user.click(await screen.findByRole('option', { name: 'The best rated' }))
    expect(last().props).toMatchObject({ source: 'top_rated', product_id: null })
  })

  it('photo grid: needs 3 photos (picked at once); a profile link', async () => {
    mockStore({ 'GET /media': ok([media(UUID, 'Mango'), media(UUID2, 'Lychee'), media(UUID3, 'Guava')], pagination(3)) })
    const { user } = setup(node('heading'))
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('photo_grid', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add photo grid' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Choose photos' }))
    const picker = await screen.findByRole('dialog', { name: 'Add photos' })
    for (const name of ['Mango', 'Lychee', 'Guava']) await user.click(await within(picker).findByRole('button', { name }))
    await user.click(within(picker).getByRole('button', { name: 'Use 3 images' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Show a profile link' }))
    await user.clear(within(dialog).getByLabelText('Profile name'))
    await user.type(within(dialog).getByLabelText('Profile name'), '@littlesprouts')
    await waitFor(() => expect(insert).toBeEnabled())
    await user.click(insert)
    const inserted = (await pending) as AnyProps
    expect((inserted.props.images as { media_id: string; alt: string }[]).map((i) => [i.media_id, i.alt])).toEqual([[UUID, 'Mango'], [UUID2, 'Lychee'], [UUID3, 'Guava']])
    expect(inserted.props.profile).toEqual({ label: '@littlesprouts', url: 'https://www.instagram.com/' })
  })

  it('store hours: week starts on Saturday, a closed day, after-midnight hint, copy to all', async () => {
    mockStore()
    const { user, last } = setup(node('store_hours'))
    const days = () => last().props.days as { day: string; closed: boolean; open: string; close: string }[]
    const editor = within(screen.getByTestId('store-hours-editor'))
    expect(editor.getAllByRole('listitem').map((li) => li.getAttribute('data-testid'))).toEqual(['hours-sat', 'hours-sun', 'hours-mon', 'hours-tue', 'hours-wed', 'hours-thu', 'hours-fri'])

    await user.click(editor.getByRole('switch', { name: 'Open on Friday' }))
    expect(days()[4]).toMatchObject({ day: 'fri', closed: true })
    expect(editor.queryByLabelText('Friday: opens at')).not.toBeInTheDocument()

    fireEvent.change(editor.getByLabelText('Saturday: closes at'), { target: { value: '01:30' } })
    expect(days()[5]).toMatchObject({ day: 'sat', close: '01:30' })
    expect(within(editor.getByTestId('hours-sat')).getByText(/Closes after midnight \(1:30 am/)).toBeInTheDocument()

    await user.click(editor.getByRole('button', { name: 'Copy Saturday to all' }))
    expect(days().every((d) => !d.closed && d.open === '10:00' && d.close === '01:30')).toBe(true)
    // Stored Monday first whatever the display order.
    expect(days().map((d) => d.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

    await user.click(screen.getByRole('combobox', { name: 'Week starts on' }))
    await user.click(await screen.findByRole('option', { name: 'Monday' }))
    expect(editor.getAllByRole('listitem')[0]).toHaveAttribute('data-testid', 'hours-mon')
    expect(editor.getByRole('button', { name: 'Copy Monday to all' })).toBeInTheDocument()
    expect(validateNode(last())).toEqual([])
  })

  it('progress bars: label and value with one decimal; rings', async () => {
    mockStore()
    const { user, last } = setup(node('progress_bars'))
    const value = screen.getByLabelText('Value (%)')
    await user.clear(value)
    await user.type(value, '87.5')
    expect((last().props.items as { value: number }[])[0]!.value).toBe(87.5)
    await user.clear(value)
    await user.type(value, '120')
    expect(screen.getByText('Use a number from 0 to 100 with at most 1 decimal.')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Look' }))
    await user.click(await screen.findByRole('option', { name: 'Rings' }))
    expect(last().props.style).toBe('ring')
  })
})

describe('B8a chart: stacked kinds and store numbers', () => {
  const props = (n: AnyProps) => n.props as { kind: string; data_source?: string; source_product_id?: string | null; series: unknown[] }

  it('stacked kinds need two series and no negative numbers', async () => {
    mockStore()
    const { user, last } = setup(node('chart'))
    await user.click(screen.getByRole('radio', { name: /^Stacked$/ }))
    expect(props(last()).kind).toBe('stacked-column')
    expect(screen.getByTestId('chart-kind-hint')).toHaveTextContent('needs at least 2 series')
    expect(validateNode(last()).map((p) => p.path)).toContain('props.series')
    await user.click(screen.getByRole('button', { name: 'Add a series' }))
    expect(validateNode(last())).toEqual([])
    const grid = within(screen.getByTestId('chart-data-editor'))
    await user.clear(grid.getByLabelText('Series 2, Jan'))
    await user.type(grid.getByLabelText('Series 2, Jan'), '-4')
    expect(screen.getByTestId('chart-problems')).toHaveTextContent('a stacked chart can’t show negative numbers')
  })

  it('“Numbers come from” ratings: the grid gives way to a read-only preview; stacked kinds are off', async () => {
    const fetch = mockStore({
      'POST /storefront/builder/resolve': ok({
        data: { e_test01: { labels: ['5 ★', '4 ★', '3 ★', '2 ★', '1 ★'], series: [{ id: 's1', name: 'Reviews', values: [12, 5, 1, 0, 0] }] } },
        media: {},
        errors: {},
      }),
    })
    const { user, last } = setup(node('chart', { kind: 'stacked-bar' }))
    await user.click(screen.getByRole('combobox', { name: 'Numbers come from' }))
    await user.click(await screen.findByRole('option', { name: 'Customer ratings' }))
    expect(props(last())).toMatchObject({ data_source: 'store.rating_breakdown', source_product_id: null, kind: 'bar' })
    expect(screen.queryByTestId('chart-data-editor')).not.toBeInTheDocument()
    const preview = within(screen.getByTestId('chart-store-preview'))
    expect(await preview.findByRole('rowheader', { name: '5 ★' })).toBeInTheDocument()
    expect(preview.getByRole('cell', { name: '12' })).toBeInTheDocument()
    expect(preview.getByRole('columnheader', { name: 'Reviews' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/storefront/builder/resolve'), expect.objectContaining({ method: 'POST' }))

    const stacked = screen.getByRole('radio', { name: /^Stacked$/ })
    expect(stacked).toHaveAttribute('aria-disabled', 'true')
    await user.click(stacked)
    expect(props(last()).kind).toBe('bar')
    // One product's reviews.
    await user.click(screen.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Straw hat/ }))
    expect(props(last()).source_product_id).toBe(UUID)
    expect(validateNode(last())).toEqual([])

    await user.click(screen.getByRole('combobox', { name: 'Numbers come from' }))
    await user.click(await screen.findByRole('option', { name: 'Numbers I type' }))
    expect(props(last())).toMatchObject({ data_source: 'manual', source_product_id: null })
    expect(screen.getByTestId('chart-data-editor')).toBeInTheDocument()
  })

  it('an empty store source says the chart stays hidden', async () => {
    mockStore({ 'POST /storefront/builder/resolve': ok({ data: { e_test01: { labels: [], series: [], state: 'empty' } }, media: {}, errors: {} }) })
    setup(node('chart', { data_source: 'store.products_per_category' }))
    expect(await screen.findByText(/No categories with products yet — the chart stays hidden/)).toBeInTheDocument()
  })
})
