import { useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, OrderFormProps, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { allowedIn } from '../document-kind'
import { buildElement, needsSetup } from './create-element'
import { errorMap } from './errors'
import { groupsFor } from './style-groups'
import { createElement, Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { translatableFields, validateNode } from './validate'

/*
 * P2a: the one-product order form in the editor — catalogue entry, the setup dialog that asks for
 * the product, the Content tab (quantity, asked fields, payment, texts, the add-on product, layout)
 * and its Bangla fields.
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const HONEY = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const JAR = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const pagination = (total: number) => ({ pagination: { current_page: 1, per_page: 24, total, last_page: 1 } })

type OrderNode = Element & { props: OrderFormProps }

const node = (props: Partial<OrderFormProps> = {}, extra: Record<string, unknown> = {}) => {
  const base = buildElement('order_form', registry, new Set())!
  return { ...base, id: 'e_order1', props: { ...base.props, ...props }, ...extra } as unknown as OrderNode
}

const section = (elements: Element[]): Section =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_sec001', type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

function mockStore() {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /products': ok(
      [
        { id: HONEY, name: 'Sundarban honey 500 g', variants: [{ sku: 'HN-500' }], images: [], is_active: true },
        { id: JAR, name: 'Gift jar', variants: [{ sku: 'GJ-1' }], images: [], is_active: true },
      ],
      pagination(2),
    ),
    [`GET /products/${HONEY}`]: ok({ id: HONEY, name: 'Sundarban honey 500 g', images: [] }),
    [`GET /products/${JAR}`]: ok({ id: JAR, name: 'Gift jar', images: [] }),
  })
}

function setup(initial: BuilderNode, options: { locales?: string[] } = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    return (
      <Inspector
        content={content}
        node={current}
        document={{ id: 'd-1', kind: 'page', key: 'landing:honey', title: 'Honey', path: '/p/honey', published: null }}
        registry={registry}
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
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as OrderNode }
}

describe('order form: catalogue and checks', () => {
  it('has an icon and a hint, sits in Commerce on pages (not popups or the header) and needs its product first', () => {
    expect(ELEMENT_ICONS.order_form).toBeDefined()
    expect(ELEMENT_HINTS.order_form).toMatch(/^[A-Z].{10,110}\.$/)
    const meta = registry.types.find((t) => t.type === 'order_form')!
    expect(meta.group).toBe('commerce')
    expect(allowedIn(meta, 'page')).toBe(true)
    expect(allowedIn(meta, 'popup')).toBe(false)
    expect(allowedIn(meta, 'header')).toBe(false)
    const fresh = buildElement('order_form', registry, new Set())!
    expect(needsSetup(fresh)).toBe(true)
    expect(validateNode(fresh)).toEqual([{ path: 'props.product_id', message: 'Choose the product this form sells.' }])
    expect(needsSetup(node({ product_id: HONEY }))).toBe(false)
    expect(groupsFor(fresh).map((g) => g.id)).toEqual(['spacing', 'background', 'border', 'effects', 'motion'])
  })

  it('reports the quantity, the add-on and the required texts in plain words, next to their fields', () => {
    const bad = node({ product_id: HONEY, quantity: { default: 5, max: 3 }, button_label: '', success_message: '', upsell: { product_id: HONEY, label: '' } })
    const problems = validateNode(bad)
    expect(Object.fromEntries(problems.map((p) => [p.path, p.message]))).toEqual({
      'props.quantity.max': 'Use a whole number from 1 to 20, not below the starting quantity.',
      'props.button_label': 'Enter the button text.',
      'props.success_message': 'Enter the thank-you message.',
      'props.upsell.product_id': 'Choose another product than the one the form sells.',
      'props.upsell.label': 'Enter the text next to the tick box.',
    })
    expect(Object.keys(errorMap(bad, problems, []))).toEqual(['quantity.max', 'button_label', 'success_message', 'upsell.product_id', 'upsell.label'])
    expect(validateNode(node({ product_id: HONEY, quantity: { default: 11, max: 20 } })).map((p) => p.message)).toEqual(['Use a whole number from 1 to 10.'])
    expect(translatableFields('order_form')).toEqual({ title: 120, text: 400, button_label: 60, success_message: 400, 'upsell.label': 120 })
  })
})

describe('order form: setup dialog', () => {
  it('asks for the product (Insert waits for it), whether shoppers choose the option, and the payment', async () => {
    mockStore()
    const { user } = setup(section([]))
    let pending!: Promise<BuilderNode | null>
    act(() => {
      pending = createElement('order_form', { registry, existingIds: new Set(['s_sec001']) })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Add order form' })
    const insert = within(dialog).getByRole('button', { name: 'Insert' })
    expect(insert).toBeDisabled()
    expect(within(dialog).getByText('Choose the product this form sells.')).toBeInTheDocument()
    // The texts and the add-on come later, in the panel.
    expect(within(dialog).queryByLabelText('Button text')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Choose product' }))
    await user.click(await screen.findByRole('option', { name: /Sundarban honey/ }))
    expect(await within(dialog).findByText('Sundarban honey 500 g')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('switch', { name: 'Let shoppers choose the option' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'How shoppers pay' }))
    await user.click(await screen.findByRole('option', { name: 'All payment methods of your store' }))
    await waitFor(() => expect(insert).toBeEnabled())
    await user.click(insert)
    const inserted = (await pending) as OrderNode
    expect(inserted.props).toMatchObject({ product_id: HONEY, show_variants: false, payment: 'store_methods', button_label: 'Confirm order', upsell: null })
  })
})

describe('order form: Content tab', () => {
  it('changes the quantity, the asked fields, the texts and the layout', async () => {
    mockStore()
    const { user, last } = setup(node({ product_id: HONEY }))
    expect(await screen.findByText('Sundarban honey 500 g')).toBeInTheDocument()

    const most = screen.getByLabelText('At most')
    await user.clear(most)
    await user.type(most, '5')
    expect(last().props.quantity).toEqual({ default: 1, max: 5 })
    const starts = screen.getByLabelText('Starts at')
    await user.clear(starts)
    await user.type(starts, '6')
    expect(last().props.quantity).toEqual({ default: 6, max: 5 })
    expect(screen.getByText('Use a whole number from 1 to 20, not below the starting quantity.')).toBeInTheDocument()
    await user.clear(starts)
    await user.type(starts, '2')

    await user.click(screen.getByRole('combobox', { name: 'E-mail' }))
    await user.click(await screen.findByRole('option', { name: 'Ask, must be filled in' }))
    await user.click(screen.getByRole('combobox', { name: 'Note for the order' }))
    await user.click(await screen.findByRole('option', { name: 'Don’t ask' }))
    expect(last().props.fields).toEqual({ email: 'required', note: 'hidden' })

    const button = screen.getByLabelText('Button text')
    await user.clear(button)
    expect(screen.getByText('Enter the button text.')).toBeInTheDocument()
    await user.type(button, 'Order with cash on delivery')
    await user.click(screen.getByRole('combobox', { name: 'Layout' }))
    await user.click(await screen.findByRole('option', { name: 'Product beside the form (wide screens)' }))
    expect(last().props).toMatchObject({ button_label: 'Order with cash on delivery', layout: 'two_columns', quantity: { default: 2, max: 5 } })
    expect(validateNode(last())).toEqual([])
  })

  it('adds an add-on product (not the product sold), with its tick-box text in Bangla; removing it clears it', async () => {
    mockStore()
    const { user, last } = setup(node({ product_id: HONEY }), { locales: ['en', 'bn'] })
    const upsell = within(screen.getByTestId('order-form-upsell'))
    await user.click(upsell.getByRole('switch', { name: 'Offer an add-on' }))
    // Nothing is stored until the product is chosen.
    expect(last()).toBeUndefined()
    expect(upsell.getByText('The add-on is saved once you choose its product.')).toBeInTheDocument()
    await user.click(upsell.getByRole('button', { name: 'Choose add-on' }))
    const options = await screen.findAllByRole('option')
    // The product the form sells isn't offered as its own add-on.
    expect(options.map((o) => o.textContent)).toEqual([expect.stringMatching(/Gift jar/)])
    await user.click(options[0]!)
    expect(last().props.upsell).toEqual({ product_id: JAR, label: 'Yes, add this to my order' })
    expect(await upsell.findByText('Gift jar')).toBeInTheDocument()

    await user.clear(upsell.getByLabelText('Tick-box text'))
    await user.type(upsell.getByLabelText('Tick-box text'), 'Add a gift jar')
    expect(last().props.upsell?.label).toBe('Add a gift jar')

    await user.click(screen.getByRole('button', { name: /বাংলা \(Bangla\)/ }))
    await user.type(screen.getByLabelText('Tick-box text in Bangla'), 'গিফট জার যোগ করুন')
    await user.type(screen.getByLabelText('Button text in Bangla'), 'অর্ডার নিশ্চিত করুন')
    expect(last().translations.bn).toEqual({ 'upsell.label': 'গিফট জার যোগ করুন', button_label: 'অর্ডার নিশ্চিত করুন' })

    await user.click(upsell.getByRole('button', { name: 'Remove' }))
    expect(last().props.upsell).toBeNull()
    expect(last().translations.bn).toEqual({ button_label: 'অর্ডার নিশ্চিত করুন' })
    expect(upsell.getByRole('switch', { name: 'Offer an add-on' })).not.toBeChecked()
  })

  it('shows the Bangla fields of every text only when Bangla is on', () => {
    mockStore()
    setup(node({ product_id: HONEY }))
    expect(screen.queryByRole('button', { name: /বাংলা \(Bangla\)/ })).toBeNull()
  })
})
