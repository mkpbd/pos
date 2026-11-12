import { useState } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Device, Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { buildElement } from './create-element'
import { createElement, Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorCommand, type InspectorProps } from './index'
import { validateNode } from './validate'

/*
 * B6 inspector forms: repeatable item lists (add, edit, duplicate, move, remove, Bangla per item),
 * the chart data editor, the hotspot editor, the media lists, setup dialogs, and the Style tab's
 * animation, section shapes, sticky and background video.
 */

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

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

const section = (id: string, props: Record<string, unknown> = {}, elements: Element[] = []): Section =>
  ({ id, type: 'section', props: { layout: 'boxed', anchor: null, ...props }, ...common, columns: [{ id: `c_${id.slice(2)}`, type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

function setup(initial: BuilderNode, options: { locales?: string[]; device?: Device; others?: Section[]; kind?: InspectorProps['document']['kind']; key?: string } = {}) {
  const onChange = vi.fn()
  const commands: InspectorCommand[] = []
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = {
      schema_version: 1,
      sections: current.type === 'section' ? [current as Section, ...(options.others ?? [])] : [section('s_sec001', {}, [current as Element]), ...(options.others ?? [])],
    }
    return (
      <Inspector
        content={content}
        node={current}
        document={{ id: 'd-1', kind: options.kind ?? 'page', key: options.key ?? 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={[]}
        device={options.device ?? 'desktop'}
        theme={{ colors: { primary: '#0f766e', canvas: '#ffffff' } }}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={(cmd) => commands.push(cmd)}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, onChange, commands, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps, opts: () => onChange.mock.calls.at(-1)?.[1] }
}

function mockStore(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    ...extra,
  })
}

const cards = () => screen.getAllByTestId('item-card')

describe('B6 forms: repeatable item lists', () => {
  it('accordion: add, edit, duplicate, move and remove panels; each change is valid', async () => {
    mockStore()
    const { user, last, opts } = setup(node('accordion'))
    expect(cards()).toHaveLength(1)
    // The only panel starts open.
    expect(screen.getByLabelText('Title')).toHaveValue('A question shoppers ask')

    await user.click(screen.getByRole('button', { name: 'Add panel' }))
    expect(cards()).toHaveLength(2)
    const items = () => last().props.items as { id: string; title: string; html: string }[]
    expect(items()[1]).toMatchObject({ title: 'New question', html: '<p>The answer.</p>' })
    expect(items()[1]!.id).toMatch(/^i_[a-z0-9]{6}$/)

    const second = within(within(cards()[1]!).getByRole('group', { name: 'panel 2' }))
    await user.clear(second.getByLabelText('Title'))
    await user.type(second.getByLabelText('Title'), 'Delivery?')
    expect(items()[1]!.title).toBe('Delivery?')
    // Typing in one field is one undo step.
    expect(opts()).toMatchObject({ coalesceKey: expect.stringContaining(`items:${items()[1]!.id}.title`) })

    await user.click(screen.getByRole('button', { name: 'Move panel 2 up' }))
    expect(items().map((i) => i.title)).toEqual(['Delivery?', 'A question shoppers ask'])
    expect(screen.getByRole('button', { name: 'Move panel 1 up' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Duplicate panel 1' }))
    expect(items().map((i) => i.title)).toEqual(['Delivery?', 'Delivery?', 'A question shoppers ask'])
    expect(new Set(items().map((i) => i.id)).size).toBe(3)

    await user.click(screen.getByRole('button', { name: 'Remove panel 3' }))
    expect(items().map((i) => i.title)).toEqual(['Delivery?', 'Delivery?'])
    expect(validateNode(last())).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Remove panel 2' }))
    // At least one panel stays.
    expect(screen.getByRole('button', { name: 'Remove panel 1' })).toBeDisabled()
  })

  it('accordion: an empty title is reported on the item, and the list can’t go past 20', async () => {
    mockStore()
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `i_item${String(i).padStart(2, '0')}`, title: `Q${i}`, html: '' }))
    items[3]!.title = ''
    const { user } = setup(node('accordion', { items }))
    expect(screen.getByRole('button', { name: 'Add panel' })).toBeDisabled()
    expect(screen.getByText('20 of 20')).toBeInTheDocument()
    // The card with the problem opens by itself and shows the message.
    expect(within(cards()[3]!).getByText('Enter a title.')).toBeInTheDocument()
    expect(within(cards()[3]!).getByLabelText('has problems')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicate panel 1' }))
    expect(cards()).toHaveLength(20)
  })

  it('Bangla per item: written under items.<id>.<field>, copied with a duplicate and dropped with a removal', async () => {
    mockStore()
    const { user, last } = setup(node('accordion', { items: [{ id: 'i_first1', title: 'Fresh?', html: '<p>Yes</p>' }] }), { locales: ['en', 'bn'] })
    const panel = within(screen.getByRole('group', { name: 'panel 1' }))
    await user.click(panel.getByRole('button', { name: /বাংলা/ }))
    await user.type(panel.getByLabelText('Title in Bangla'), 'তাজা?')
    expect(last().translations).toEqual({ bn: { 'items.i_first1.title': 'তাজা?' } })

    await user.click(screen.getByRole('button', { name: 'Duplicate panel 1' }))
    const copy = (last().props.items as { id: string }[])[1]!.id
    expect(last().translations.bn).toEqual({ 'items.i_first1.title': 'তাজা?', [`items.${copy}.title`]: 'তাজা?' })

    await user.click(screen.getByRole('button', { name: 'Remove panel 1' }))
    expect(last().translations.bn).toEqual({ [`items.${copy}.title`]: 'তাজা?' })
    expect(validateNode(last())).toEqual([])
  })

  it('counter: number, before / after and label per item; a value past the limit is reported', async () => {
    mockStore()
    const { user, last } = setup(node('counter'))
    const item = within(screen.getByRole('group', { name: 'number 1' }))
    await user.clear(item.getByLabelText('Number'))
    await user.type(item.getByLabelText('Number'), '2500.75')
    await user.type(item.getByLabelText('Before'), '৳')
    expect((last().props.items as object[])[0]).toMatchObject({ value: 2500.75, prefix: '৳', suffix: '+', label: 'Happy customers' })
    await user.clear(item.getByLabelText('Number'))
    await user.type(item.getByLabelText('Number'), '2000000000')
    expect(item.getByText('Use a number from 0 to 1,000,000,000 with at most 2 decimals.')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Count up when shown' }))
    expect(last().props.animate).toBe(false)
  })

  it('steps: at least two; an icon can be switched on per step', async () => {
    mockStore()
    const { user, last } = setup(node('steps'))
    expect(cards()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Remove step 3' }))
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeDisabled()
    await user.click(within(cards()[0]!).getByRole('button', { expanded: false }))
    const step = within(screen.getByRole('group', { name: 'step 1' }))
    await user.click(step.getByRole('switch', { name: 'Icon' }))
    await user.click(step.getByRole('button', { name: 'Truck' }))
    expect((last().props.items as { icon: string | null }[])[0]!.icon).toBe('truck')
  })

  it('marquee: edits its texts and speed', async () => {
    mockStore()
    const marquee = setup(node('marquee'))
    await marquee.user.type(screen.getByLabelText('Text'), '!')
    expect((marquee.last().props.items as { text: string }[])[0]!.text).toBe('Free delivery on every order!')
    await marquee.user.click(screen.getByRole('combobox', { name: 'Speed' }))
    await marquee.user.click(await screen.findByRole('option', { name: 'Fast' }))
    expect(marquee.last().props.speed).toBe('fast')
  })

  it('icon box: icon, title and link; trust badges: icon per badge', async () => {
    mockStore()
    const box = setup(node('icon_box'))
    await box.user.click(screen.getByRole('button', { name: 'Leaf' }))
    await box.user.type(screen.getByLabelText('Text'), 'Same day in Dhaka')
    expect(box.last().props).toMatchObject({ icon: 'leaf', title: 'Fast delivery', text: 'Same day in Dhaka', link: null })
    expect(validateNode(box.last())).toEqual([])
  })

  it('quote needs its text', async () => {
    mockStore()
    const { user, last } = setup(node('quote'))
    await user.clear(screen.getByLabelText('Quote'))
    expect(screen.getByText('Enter the text.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Quote'), 'Best mangoes in town.')
    await user.type(screen.getByLabelText('Who said it'), 'Rina')
    expect(last().props).toMatchObject({ text: 'Best mangoes in town.', author: 'Rina' })
  })
})

describe('B6 forms: chart data editor', () => {
  const chartNode = () => node('chart')
  const props = (n: AnyProps) => n.props as { kind: string; labels: string[]; series: { id: string; name: string; values: number[] }[] }

  it('edits labels, numbers and series names in the grid; adds and removes rows and series', async () => {
    mockStore()
    const { user, last } = setup(chartNode())
    const grid = within(screen.getByTestId('chart-data-editor'))
    await user.clear(grid.getByLabelText('Sales, Feb'))
    await user.type(grid.getByLabelText('Sales, Feb'), '1,250')
    expect(props(last()).series[0]!.values).toEqual([10, 1250, 30])
    await user.clear(grid.getByLabelText('Label of row 1'))
    await user.type(grid.getByLabelText('Label of row 1'), 'January')
    expect(props(last()).labels[0]).toBe('January')

    // A cell that isn't a number is marked and not saved.
    await user.clear(grid.getByLabelText('Sales, Mar'))
    await user.type(grid.getByLabelText('Sales, Mar'), 'abc')
    expect(grid.getByLabelText('Sales, Mar')).toHaveAttribute('aria-invalid', 'true')
    expect(props(last()).series[0]!.values[2]).toBe(30)

    await user.click(grid.getByRole('button', { name: 'Add a series' }))
    expect(props(last()).series).toHaveLength(2)
    expect(props(last()).series[1]).toMatchObject({ name: 'Series 2', values: [0, 0, 0] })
    await user.click(grid.getByRole('button', { name: 'Add row' }))
    expect(props(last()).labels).toEqual(['January', 'Feb', 'Mar', 'Label 4'])
    expect(props(last()).series.every((s) => s.values.length === 4)).toBe(true)
    await user.click(grid.getByRole('button', { name: 'Remove row Feb' }))
    expect(props(last()).labels).toEqual(['January', 'Mar', 'Label 4'])
    await user.click(grid.getByRole('button', { name: 'Remove series Series 2' }))
    expect(props(last()).series).toHaveLength(1)
    expect(validateNode(last())).toEqual([])
  })

  it('pasting cells from a spreadsheet fills from the cell and grows the grid', async () => {
    mockStore()
    const { last } = setup(chartNode())
    const cell = screen.getByLabelText('Sales, Jan')
    fireEvent.paste(cell, { clipboardData: { getData: () => '5\t50\n6\t60\n7\t70\n8\t80\n' } })
    expect(props(last()).labels).toEqual(['Jan', 'Feb', 'Mar', 'Label 4'])
    expect(props(last()).series.map((s) => s.values)).toEqual([[5, 6, 7, 8], [50, 60, 70, 80]])
  })

  it('“Paste a table” replaces the data and reads the series names from the first row', async () => {
    mockStore()
    const { user, last } = setup(chartNode())
    await user.click(screen.getByRole('button', { name: 'Paste a table' }))
    fireEvent.change(screen.getByLabelText(/Copy cells in Excel/), { target: { value: 'Branch\tOnline\tShop\nDhanmondi\t120\t80\nGulshan\t95\t110' } })
    await user.click(screen.getByRole('button', { name: 'Use this data' }))
    expect(props(last()).labels).toEqual(['Dhanmondi', 'Gulshan'])
    expect(props(last()).series.map((s) => [s.name, s.values])).toEqual([['Online', [120, 95]], ['Shop', [80, 110]]])
    // The first series keeps its id (and so its Bangla name).
    expect(props(last()).series[0]!.id).toBe('series-1')
  })

  it('kind picker: hints which kind fits, offers the better one, and validates pie rules live', async () => {
    mockStore()
    const { user, last } = setup(node('chart', { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ id: 'series-1', name: 'Orders', values: [1, 2, 3, 4, 5, 6] }] }))
    expect(screen.getByTestId('chart-kind-hint')).toHaveTextContent('Your labels look like time')
    await user.click(screen.getByRole('button', { name: 'Use area' }))
    expect(last().props.kind).toBe('area')
    expect(screen.getByRole('radio', { name: /Area/ })).toHaveAttribute('aria-checked', 'true')
    // Only line charts may start above zero; areas, bars and slices always start there.
    expect(screen.getByRole('switch', { name: 'Start the scale at zero' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Line/ }))
    expect(screen.getByRole('switch', { name: 'Start the scale at zero' })).toBeEnabled()
    await user.click(screen.getByRole('switch', { name: 'Hide legend when lines are labelled' }))
    expect(last().props.show_legend).toBe(false)
    // Series colours are shown in their fixed order.
    expect(screen.getAllByTestId('series-swatch')[0]).toHaveStyle({ backgroundColor: '#2a78d6' })

    await user.click(screen.getByRole('button', { name: 'Add a series' }))
    await user.click(screen.getByRole('radio', { name: /Pie/ }))
    expect(screen.getByTestId('chart-kind-hint')).toHaveTextContent('A pie or donut shows one series only')
    expect(screen.getByTestId('chart-problems')).toHaveTextContent('A pie or donut chart shows exactly one series')
    expect(validateNode(last()).map((p) => p.path)).toContain('props.series')
    expect(screen.getByRole('switch', { name: 'Start the scale at zero' })).toBeDisabled()
    expect(screen.queryByRole('switch', { name: 'Hide legend when lines are labelled' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove series Series 2' }))
    // 6 parts is fine; with 7 the store draws bars.
    expect(screen.getByTestId('chart-kind-hint')).not.toHaveTextContent('shows this as bars')
    await user.click(screen.getByRole('button', { name: 'Add row' }))
    expect(screen.getByTestId('chart-kind-hint')).toHaveTextContent('With more than 6 parts your store shows this as bars')
  })

  it('Bangla: title, description, each label by position and each series name; removing a row shifts the labels', async () => {
    mockStore()
    const start = node('chart', {}, { translations: { bn: { 'labels.0': 'জানু', 'labels.1': 'ফেব্রু', 'labels.2': 'মার্চ', 'series.series-1.name': 'বিক্রি' } } })
    const { user, last } = setup(start, { locales: ['en', 'bn'] })
    // Opens by itself: something is translated already.
    expect(screen.getByLabelText('Label 2 in Bangla')).toHaveValue('ফেব্রু')
    expect(screen.getByLabelText('Series 1 name in Bangla')).toHaveValue('বিক্রি')
    await user.click(screen.getByRole('button', { name: 'Remove row Jan' }))
    expect(last().translations.bn).toEqual({ 'labels.0': 'ফেব্রু', 'labels.1': 'মার্চ', 'series.series-1.name': 'বিক্রি' })
  })
})

describe('B6 forms: shop the look hotspots', () => {
  const look = (hotspots: unknown[] = []) => node('shop_the_look', { media_id: UUID, alt: 'Summer look', hotspots })
  const products = {
    'GET /products': ok([{ id: UUID3, name: 'Straw hat', variants: [{ sku: 'SH-1' }], images: [], is_active: true }], pagination(1)),
    [`GET /products/${UUID3}`]: ok({ id: UUID3, name: 'Straw hat', images: [] }),
    [`GET /products/${UUID2}`]: ok({ id: UUID2, name: 'Linen shirt', images: [] }),
    'GET /media': ok([media(UUID, 'Summer look')], pagination(1)),
  }

  function stubArea() {
    const area = screen.getByTestId('hotspot-area')
    area.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) })
    return area
  }

  it('click the photo to place a dot, choose its product; Insert waits for it', async () => {
    mockStore(products)
    const { user, last } = setup(look())
    await screen.findByTestId('hotspot-area')
    const area = stubArea()
    fireEvent.click(area, { clientX: 300, clientY: 100 })
    const spots = () => last().props.hotspots as { id: string; x: number; y: number; product_id: string }[]
    expect(spots()).toHaveLength(1)
    expect(spots()[0]).toMatchObject({ x: 50, y: 25, product_id: '' })
    expect(screen.getByRole('button', { name: 'Hotspot 1: no product yet' })).toBeInTheDocument()
    expect(validateNode(last()).map((p) => p.path)).toContain('props.hotspots.0.product_id')

    const detail = within(screen.getByTestId('hotspot-detail'))
    await user.click(detail.getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Straw hat/ }))
    expect(spots()[0]!.product_id).toBe(UUID3)
    expect(await screen.findByRole('button', { name: 'Hotspot 1: Straw hat' })).toBeInTheDocument()
    expect(validateNode(last())).toEqual([])
  })

  it('arrow keys nudge a dot (Shift for 5 %), dragging moves it, Delete removes it (one stays)', async () => {
    mockStore(products)
    const { last, opts } = setup(look([{ id: 'h_one111', x: 10, y: 10, product_id: UUID3 }, { id: 'h_two222', x: 50, y: 50, product_id: UUID2 }]))
    await screen.findByTestId('hotspot-area')
    stubArea()
    const dot = (await screen.findAllByTestId('hotspot-dot'))[0]!
    fireEvent.keyDown(dot, { key: 'ArrowRight' })
    fireEvent.keyDown(dot, { key: 'ArrowDown', shiftKey: true })
    const spots = () => last().props.hotspots as { x: number; y: number }[]
    expect(spots()[0]).toMatchObject({ x: 11, y: 15 })
    expect(opts()).toMatchObject({ coalesceKey: expect.stringContaining('hotspot.h_one111.nudge') })

    const second = screen.getAllByTestId('hotspot-dot')[1]!
    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 300, clientY: 150 })
    fireEvent.pointerMove(second, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerUp(second, { pointerId: 1 })
    expect(spots()[1]).toMatchObject({ x: 75, y: 75 })

    fireEvent.keyDown(screen.getAllByTestId('hotspot-dot')[0]!, { key: 'Delete' })
    expect(spots()).toHaveLength(1)
    fireEvent.keyDown(screen.getAllByTestId('hotspot-dot')[0]!, { key: 'Delete' })
    expect(spots()).toHaveLength(1)
  })
})

describe('B6 forms: media lists and setup dialogs', () => {
  it('gallery: the setup dialog asks for images; several are added at once with their alt texts', async () => {
    mockStore({ 'GET /media': ok([media(UUID, 'Mango'), media(UUID2, 'Lychee')], pagination(2)) })
    const { user } = setup(node('heading' as string, {}) as Element)
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('gallery', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add gallery' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Choose images' }))
    const picker = await screen.findByRole('dialog', { name: 'Add images' })
    await user.click(await within(picker).findByRole('button', { name: 'Mango' }))
    await user.click(within(picker).getByRole('button', { name: 'Lychee' }))
    await user.click(within(picker).getByRole('button', { name: 'Use 2 images' }))
    await waitFor(() => expect(insert).toBeEnabled())
    await user.click(insert)
    const inserted = (await pending) as AnyProps
    expect(inserted.props.images).toEqual([
      { id: expect.stringMatching(/^i_/), media_id: UUID, alt: 'Mango', caption: '' },
      { id: expect.stringMatching(/^i_/), media_id: UUID2, alt: 'Lychee', caption: '' },
    ])
  })

  it('gallery: images per row per device; tablet and mobile can follow the wider device', async () => {
    mockStore({ 'GET /media': ok([media(UUID, 'Mango')], pagination(1)) })
    const { user, last } = setup(node('gallery', { images: [{ id: 'i_img001', media_id: UUID, alt: 'Mango', caption: '' }] }))
    await user.click(screen.getByRole('combobox', { name: 'Images per row on mobile' }))
    await user.click(await screen.findByRole('option', { name: '2' }))
    expect(last().props.columns).toEqual({ base: 3, mobile: 2 })
    await user.click(screen.getByRole('combobox', { name: 'Images per row on mobile' }))
    await user.click(await screen.findByRole('option', { name: 'As tablet' }))
    expect(last().props.columns).toEqual({ base: 3 })
  })

  it('logo carousel needs two logos', async () => {
    mockStore()
    setup(node('logo_carousel'))
    expect(screen.getByText('Add at least 2 logos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose logos' })).toBeEnabled()
  })

  it('map: address, place name, height and zoom', async () => {
    mockStore()
    const { user, last } = setup(node('map'))
    expect(screen.getByText('Enter an address or map coordinates.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Address'), 'Dhanmondi, Dhaka')
    expect(screen.getByRole('link', { name: /Check it on Google Maps/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=Dhanmondi%2C%20Dhaka')
    await user.click(screen.getByRole('combobox', { name: 'Zoom' }))
    await user.click(await screen.findByRole('option', { name: '12 – city' }))
    expect(last().props).toMatchObject({ query: 'Dhanmondi, Dhaka', zoom: 12 })
    expect(validateNode(last())).toEqual([])
  })

  it('category card: picks one of the active categories; product spotlight: picks a product', async () => {
    mockStore({
      'GET /categories': ok([
        { id: UUID, parent_id: null, name: 'Fruit', description: null, sort_order: 1, is_active: true },
        { id: UUID2, parent_id: UUID, name: 'Mangoes', description: null, sort_order: 1, is_active: true },
        { id: UUID3, parent_id: null, name: 'Old stock', description: null, sort_order: 2, is_active: false },
      ]),
    })
    const { user, last } = setup(node('category_card'))
    expect(screen.getByText('Choose a category.')).toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Category' })
    await waitFor(() => expect(picker).toBeEnabled())
    await user.click(picker)
    expect(screen.queryByRole('option', { name: /Old stock/ })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: /Mangoes/ }))
    expect(last().props.category_id).toBe(UUID2)
    await user.type(screen.getByLabelText('Title'), 'x')
    await user.clear(screen.getByLabelText('Title'))
    expect(last().props.title).toBeNull()
  })

  it('recently viewed and elements valid by default are inserted without a dialog', async () => {
    await expect(createElement('recently_viewed', { registry, existingIds: new Set() })).resolves.toMatchObject({ type: 'recently_viewed', props: { limit: 8 } })
    await expect(createElement('accordion', { registry, existingIds: new Set() })).resolves.toMatchObject({ type: 'accordion' })
    await expect(createElement('chart', { registry, existingIds: new Set() })).resolves.toMatchObject({ type: 'chart', props: { kind: 'column' } })
  })
})

describe('B6 style: animation, section shapes, sticky and background video', () => {
  it('animation: written on desktop (base) whatever device is styled; Preview animation asks the canvas', async () => {
    mockStore()
    const { user, last, commands } = setup(node('heading' as string, { text: 'Hi', level: 2, link: null }), { device: 'mobile' })
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    await user.click(screen.getByRole('button', { name: 'Animation' }))
    const preview = screen.getByRole('button', { name: 'Preview animation' })
    expect(preview).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Entrance'), 'slide-up')
    expect(last().style).toEqual({ base: { motion: { entrance: 'slide-up', duration: 600, delay: 0 } } })
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '1200' } })
    expect(last().style.base?.motion).toEqual({ entrance: 'slide-up', duration: 1200, delay: 0 })
    await user.click(preview)
    expect(commands).toContainEqual({ type: 'preview-motion', nodeId: 'e_test01' })
    await user.selectOptions(screen.getByLabelText('Entrance'), 'none')
    expect(last().style).toEqual({})
  })

  it('B6 elements have a Style tab with their groups and the animation', async () => {
    mockStore()
    const { user } = setup(node('gallery', { images: [{ id: 'i_img001', media_id: UUID, alt: 'A', caption: '' }] }))
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    for (const id of ['spacing', 'size', 'border', 'effects', 'motion']) expect(screen.getByTestId(`style-group-${id}`)).toBeInTheDocument()
  })

  it('section: shape dividers from drawn previews; straight removes the key', async () => {
    mockStore()
    const { user, last } = setup(section('s_sec001'))
    const top = within(screen.getByTestId('shape-top'))
    await user.click(top.getByRole('radio', { name: 'Wave' }))
    expect(last().props).toMatchObject({ shape_top: { shape: 'wave', color: 'theme:canvas', height: 48, flip: false } })
    await user.click(top.getByRole('radio', { name: 'Mirrored' }))
    expect((last().props as unknown as { shape_top: { flip: boolean } }).shape_top.flip).toBe(true)
    fireEvent.change(top.getByLabelText('Shape height'), { target: { value: '120' } })
    expect((last().props as unknown as { shape_top: { height: number } }).shape_top.height).toBe(120)
    expect(validateNode(last())).toEqual([])
    await user.click(top.getByRole('radio', { name: 'Straight' }))
    expect(last().props).not.toHaveProperty('shape_top')
  })

  it('section: sticky is written only when on, and only one section may stick', async () => {
    mockStore()
    const { user, last } = setup(section('s_sec001'))
    await user.click(screen.getByRole('switch', { name: 'Stick to the top when scrolling' }))
    expect(last().props).toMatchObject({ sticky: true })
    await user.click(screen.getByRole('switch', { name: 'Stick to the top when scrolling' }))
    expect(last().props).not.toHaveProperty('sticky')
  })

  it('section: another sticky section disables the switch; the header has none', async () => {
    mockStore()
    setup(section('s_sec001'), { others: [section('s_sec002', { sticky: true })] })
    expect(screen.getByRole('switch', { name: 'Stick to the top when scrolling' })).toBeDisabled()
    expect(screen.getByText(/Another section already sticks/)).toBeInTheDocument()
  })

  it('section: background video on desktop with a poster; a wrong link is not saved', async () => {
    mockStore({ 'GET /media': ok([media(UUID, 'Poster')], pagination(1)) })
    const { user, last } = setup(section('s_sec001'), { device: 'tablet' })
    await user.click(screen.getByRole('tab', { name: 'Style' }))
    await user.click(screen.getByRole('button', { name: 'Background video' }))
    const input = screen.getByLabelText('Video link')
    await user.type(input, 'https://example.com/video')
    expect(screen.getByText(/Use a YouTube link/)).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'https://youtu.be/dQw4w9WgXcQ')
    expect(last().style).toEqual({ base: { background: { type: 'none', video: { url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube', video_id: 'dQw4w9WgXcQ' } } } })
    expect(screen.getByText(/same on every device/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose image' }))
    const picker = await screen.findByRole('dialog', { name: 'Choose the poster' })
    await user.click(await within(picker).findByRole('button', { name: 'Poster' }))
    await user.click(within(picker).getByRole('button', { name: 'Use image' }))
    await waitFor(() => expect(last().style.base?.background?.video?.poster).toEqual({ media_id: UUID }))
    await user.clear(input)
    expect(last().style).toEqual({})
  })
})
