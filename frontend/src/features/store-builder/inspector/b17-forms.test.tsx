import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { b17Message, readDeliveryData, readPaymentData, toggleWallet, toggleZone, withBadgeLink, withOrnamentName } from './b17-model'
import { buildElement, needsSetup } from './create-element'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { validateNode } from './validate'

/*
 * B17 inspector forms: the ornament picker (grouped drawings with previews, repeat only for
 * borders, fixed flag colours), payment badges (wallets in a fixed order, the store's methods, the
 * empty note), delivery promise (all / chosen zones, a gone zone), Bangla date, and trust badges
 * with links (up to 8, the link key absent when unset).
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const ZONE_A = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const ZONE_B = '1b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const GONE = '2b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'

type AnyProps = Element & { props: Record<string, unknown> }

const node = (type: string, props: Record<string, unknown> = {}) => {
  const base = buildElement(type, registry, new Set())!
  return { ...base, id: 'e_test01', props: { ...base.props, ...props } } as unknown as Element
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
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps }
}

function mockStore(resolved: unknown = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser()),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/theme': ok({ settings: { colors: { primary: '#0f766e', accent: '#b45309' } }, custom_css: null, has_custom_css: false, updated_at: null }),
    'POST /storefront/builder/resolve': ok({ data: { e_test01: resolved }, media: {}, errors: {} }),
  })
}

describe('B17 model', () => {
  it('keeps wallets in the fixed order without duplicates and zones as a list', () => {
    expect(toggleWallet(['upay', 'bkash'], 'nagad', true)).toEqual(['bkash', 'nagad', 'upay'])
    expect(toggleWallet(['bkash', 'bkash', 'paypal'], 'bkash', false)).toEqual([])
    expect(toggleZone('all', ZONE_A, true)).toEqual([ZONE_A])
    expect(toggleZone([ZONE_A, ZONE_B], ZONE_A, false)).toEqual([ZONE_B])
  })

  it('drops repeat for drawings that are not borders and removes an unset badge link', () => {
    const props = { name: 'alpona_border', color: 'theme:primary', secondary_color: null, size: 40, align: 'center' as const, flip: 'none' as const, opacity: 100, repeat: true }
    expect(withOrnamentName(props, 'flag_ribbon').repeat).toBe(true)
    expect(withOrnamentName(props, 'lantern').repeat).toBe(false)
    const item = { id: 'i_1', icon: 'truck', title: 'Fast', text: '', link: { url: '/pages/returns' } }
    expect(withBadgeLink(item, null)).toEqual({ id: 'i_1', icon: 'truck', title: 'Fast', text: '' })
    expect(withBadgeLink({ id: 'i_1', icon: 'truck', title: 'Fast', text: '' }, '/x')).toMatchObject({ link: { url: '/x' } })
  })

  it('reads resolved data defensively and words problems plainly', () => {
    expect(readPaymentData({ methods: [{ code: 'cod', name: 'Cash on delivery' }], wallets: [] })).toEqual({ empty: false, methods: ['Cash on delivery'] })
    expect(readPaymentData({ methods: [], wallets: [], state: 'empty' }).empty).toBe(true)
    expect(readDeliveryData({ zones: [], all_zones: [{ id: ZONE_A, name: 'Inside Dhaka' }, { id: 1 }], missing: [GONE], state: 'empty' })).toEqual({
      empty: true,
      allZones: [{ id: ZONE_A, name: 'Inside Dhaka' }],
      missing: [GONE],
      shown: 0,
    })
    expect(b17Message('ornament', { path: 'repeat', code: 'invalid' })).toBe('Only border drawings repeat across the width.')
    expect(b17Message('payment_badges', { path: 'title', code: 'too_long' })).toBe('At most 80 characters.')
    expect(b17Message('delivery_promise', { path: 'zones', code: 'too_few' })).toMatch(/at least one delivery area/)
  })

  it('the four new elements are valid as added (no setup dialog) and listed in the Add panel', () => {
    for (const type of ['ornament', 'payment_badges', 'delivery_promise', 'bangla_date']) {
      const element = buildElement(type, registry, new Set())!
      expect(validateNode(element), type).toEqual([])
      expect(needsSetup(element), type).toBe(false)
      expect(ELEMENT_ICONS[type], type).toBeDefined()
      expect(ELEMENT_HINTS[type], type).toMatch(/^[A-Z].{10,90}\.$/)
    }
    expect(validateNode(node('ornament', { name: 'lantern', repeat: true }))).toEqual([{ path: 'props.repeat', message: 'Only border drawings repeat across the width.' }])
    expect(validateNode(node('payment_badges', { title: 'x'.repeat(81) }))).toEqual([{ path: 'props.title', message: 'At most 80 characters.' }])
  })
})

describe('B17 forms', () => {
  it('ornament: picks a drawing from its group, repeats borders only, the flag ribbon keeps its colours', async () => {
    mockStore()
    const { user, last } = setup(node('ornament'))
    const bangla = screen.getByRole('group', { name: 'Bangla festivals and Puja' })
    expect(within(bangla).getByRole('button', { name: /Kash flower/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sparkle/, pressed: true })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Repeat across the width' })).not.toBeInTheDocument()

    await user.click(within(bangla).getByTestId('ornament-alpona_border'))
    expect(last().props.name).toBe('alpona_border')
    await user.click(screen.getByRole('switch', { name: 'Repeat across the width' }))
    expect(last().props.repeat).toBe(true)
    // Repeated borders run across the width: no position.
    expect(screen.queryByRole('combobox', { name: 'Position' })).not.toBeInTheDocument()

    await user.click(screen.getByTestId('ornament-lantern'))
    expect(last().props).toMatchObject({ name: 'lantern', repeat: false })
    expect(screen.getByRole('group', { name: 'Theme colours' })).toBeInTheDocument()

    await user.click(screen.getByTestId('ornament-flag_ribbon'))
    expect(screen.queryByRole('group', { name: 'Theme colours' })).not.toBeInTheDocument()
    expect(screen.getByText(/national flag’s green and red/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Extra large', pressed: false }))
    expect(last().props.size).toBe(160)
    await user.clear(screen.getByLabelText('Strength (%)'))
    await user.type(screen.getByLabelText('Strength (%)'), '40')
    expect(last().props.opacity).toBe(40)
    expect(screen.getByTestId('ornament-preview').querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('payment badges: wallets as ordered text badges, the store methods now, the empty note and Bangla fields', async () => {
    mockStore({ methods: [{ code: 'cod', name: 'Cash on delivery' }, { code: 'bank', name: 'Bank transfer' }], wallets: [] })
    const { user, last } = setup(node('payment_badges'), { locales: ['en', 'bn'] })
    expect(await screen.findByTestId('payment-methods-now')).toHaveTextContent('Shoppers see now: Cash on delivery, Bank transfer.')
    await user.click(screen.getByRole('checkbox', { name: /Upay/ }))
    await user.click(screen.getByRole('checkbox', { name: /bKash/ }))
    expect(last().props.wallets).toEqual(['bkash', 'upay'])
    expect(screen.getByText('Shown as plain text badges, never brand logos.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Note'), 'Send Money')
    expect(last().props.note).toBe('Send Money')
    expect(screen.getAllByText(/বাংলা/).length).toBeGreaterThan(0)
  })

  it('payment badges with nothing to show say so', async () => {
    mockStore({ methods: [], wallets: [], state: 'empty' })
    setup(node('payment_badges', { show_store_methods: false }))
    expect(await screen.findByTestId('payment-empty')).toHaveTextContent(/stays hidden on your shop/)
  })

  it('delivery promise: all areas or chosen ones, a gone zone can be removed', async () => {
    mockStore({ zones: [{ id: ZONE_A }], all_zones: [{ id: ZONE_A, name: 'Inside Dhaka' }, { id: ZONE_B, name: 'All Bangladesh' }], missing: [GONE] })
    const { user, last } = setup(node('delivery_promise', { zones: [ZONE_A, GONE] }))
    expect(await screen.findByRole('checkbox', { name: 'Inside Dhaka' })).toBeChecked()
    expect(screen.getByTestId('zone-missing')).toHaveTextContent('This delivery zone is gone.')
    await user.click(within(screen.getByTestId('zone-missing')).getByRole('button', { name: 'Remove' }))
    expect(last().props.zones).toEqual([ZONE_A])
    await user.click(screen.getByRole('checkbox', { name: 'All Bangladesh' }))
    expect(last().props.zones).toEqual([ZONE_A, ZONE_B])
    await user.click(screen.getByRole('checkbox', { name: 'Inside Dhaka' }))
    await user.click(screen.getByRole('checkbox', { name: 'All Bangladesh' }))
    expect(last().props.zones).toEqual([])
    expect(screen.getByText(/Choose at least one delivery area/)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Delivery areas shown' }))
    await user.click(await screen.findByRole('option', { name: 'All delivery areas' }))
    expect(last().props.zones).toBe('all')
    await user.click(screen.getByRole('switch', { name: 'Show the delivery charge' }))
    expect(last().props.show_price).toBe(false)
  })

  it('Bangla date: prefix, extra calendars and the expected Hijri note', async () => {
    mockStore()
    const { user, last } = setup(node('bangla_date'))
    expect(screen.getByText(/Bangla calendar used in Bangladesh/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Words before the date'), 'আজ')
    await user.click(screen.getByRole('switch', { name: 'Also show the Hijri date' }))
    expect(last().props).toMatchObject({ prefix: 'আজ', show_hijri: true })
    expect(screen.getByText(/may differ by a day from the moon sighting/)).toBeInTheDocument()
  })

  it('trust badges: up to 8, an optional link per badge (the key removed again)', async () => {
    mockStore()
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `i_b${i}`, icon: 'shield-check', title: `Badge ${i + 1}`, text: '' }))
    const { user, last } = setup(node('trust_badges', { items }))
    await user.click(screen.getByRole('button', { name: 'Add badge' }))
    expect((last().props.items as unknown[]).length).toBe(8)
    expect(screen.getByRole('button', { name: 'Add badge' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /^Badge 1/ }))
    const card = within(screen.getByRole('group', { name: 'badge 1' }))
    await user.click(card.getByRole('combobox', { name: 'Link' }))
    await user.click(await screen.findByRole('option', { name: 'Custom link…' }))
    await user.type(card.getByLabelText('Link address'), '/pages/returns')
    const first = () => (last().props.items as { link?: unknown }[])[0]!
    expect(first().link).toEqual({ url: '/pages/returns' })
    expect(validateNode(last())).toEqual([])
    await user.clear(card.getByLabelText('Link address'))
    expect('link' in first()).toBe(false)
  })
})
