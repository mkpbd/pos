import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { deliverySummary, paymentBadges } from './builder/elements/b17-lines'
import { B17_TYPES } from './builder/elements/b17-types'
import {
  banglaDigits,
  bengaliMonthLengths,
  formatBengali,
  formatHijri,
  formatWeekday,
  toBengali,
  toHijri,
  zonedDate,
  type CivilDate,
} from './builder/elements/bangla-calendar'
import { ORNAMENT_NAMES, ORNAMENTS } from './builder/elements/ornament-names'
import { elementMeta, isAllowedIn, isTranslatableKey } from './builder/registry'
import { documentOf, elementNode, payloadOf } from './builder/test-payload'
import type { BuilderData, BuilderPage, DeliveryPromiseData, Element } from './builder/types'
import { b17PropProblems, b6PropProblems, elementPropProblems } from './builder/validate'
import { storefrontRoutes } from './routes'
import { bilingualBootstrap, bootstrapFixture, cartFixture, resetLocale } from './test-fixtures'
import type { StorePage } from './types'

afterEach(() => {
  resetLocale()
  vi.useRealTimers()
})

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day })
const bn = (date: CivilDate) => formatBengali(toBengali(date), 'bn')

/* ============================================================================================= */

describe('the Bangladesh revised Bengali calendar', () => {
  it('matches the known dates', () => {
    expect(bn(d(2027, 4, 14))).toBe('১ বৈশাখ ১৪৩৪')
    expect(bn(d(2026, 4, 14))).toBe('১ বৈশাখ ১৪৩৩')
    expect(bn(d(2026, 4, 13))).toBe('৩০ চৈত্র ১৪৩২')
    expect(bn(d(2026, 2, 21))).toBe('৮ ফাল্গুন ১৪৩২')
    expect(bn(d(2028, 2, 21))).toBe('৮ ফাল্গুন ১৪৩৪')
    expect(bn(d(2026, 12, 16))).toBe('১ পৌষ ১৪৩৩')
    expect(bn(d(2026, 3, 26))).toBe('১২ চৈত্র ১৪৩২')
    expect(bn(d(2026, 11, 15))).toBe('৩০ কার্তিক ১৪৩৩')
    expect(bn(d(2026, 10, 16))).toBe('৩১ আশ্বিন ১৪৩৩')
    expect(formatBengali(toBengali(d(2027, 4, 14)), 'en')).toBe('1 Boishakh 1434')
  })

  it('gives Falgun 30 days in a leap year and 29 otherwise', () => {
    expect(bn(d(2027, 3, 14))).toBe('২৯ ফাল্গুন ১৪৩৩')
    expect(bn(d(2027, 3, 15))).toBe('১ চৈত্র ১৪৩৩')
    expect(bn(d(2028, 2, 29))).toBe('১৬ ফাল্গুন ১৪৩৪')
    expect(bn(d(2028, 3, 14))).toBe('৩০ ফাল্গুন ১৪৩৪')
    expect(bn(d(2028, 3, 15))).toBe('১ চৈত্র ১৪৩৪')
    expect(bengaliMonthLengths(2026).reduce((a, b) => a + b, 0)).toBe(365)
    expect(bengaliMonthLengths(2027).reduce((a, b) => a + b, 0)).toBe(366)
  })

  it('counts one day at a time across several years', () => {
    let previous = toBengali(d(2025, 1, 1))
    for (let i = 1; i < 365 * 4; i += 1) {
      const date = new Date(Date.UTC(2025, 0, 1 + i))
      const next = toBengali(d(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()))
      if (next.day === 1) {
        expect(next.month === previous.month + 1 || (next.month === 1 && previous.month === 12 && next.year === previous.year + 1)).toBe(true)
      } else {
        expect([next.year, next.month, next.day]).toEqual([previous.year, previous.month, previous.day + 1])
      }
      expect(next.weekday).toBe(date.getUTCDay())
      previous = next
    }
  })

  it('names the weekday and season, with Bengali digits', () => {
    const boishakh = toBengali(d(2027, 4, 14))
    expect(formatWeekday(boishakh.weekday, 'bn')).toBe('বুধবার')
    expect(formatWeekday(boishakh.weekday, 'en')).toBe('Wednesday')
    expect(boishakh.season).toBe(0)
    expect(toBengali(d(2026, 12, 16)).season).toBe(4)
    expect(banglaDigits('1434')).toBe('১৪৩৪')
  })

  it('finds today in the store time zone', () => {
    // 18:30 UTC on 13 April is already 14 April in Dhaka.
    expect(zonedDate(new Date('2026-04-13T18:30:00Z'), 'Asia/Dhaka')).toEqual(d(2026, 4, 14))
    expect(zonedDate(new Date('2026-04-13T17:59:00Z'), 'Asia/Dhaka')).toEqual(d(2026, 4, 13))
    expect(zonedDate(new Date('2026-04-13T18:30:00Z'), 'Not/AZone')).toEqual(d(2026, 4, 13))
  })

  it('computes the tabular Hijri date', () => {
    expect(toHijri(d(2026, 2, 18))).toEqual({ year: 1447, month: 9, day: 1 })
    expect(toHijri(d(2026, 3, 20))).toEqual({ year: 1447, month: 10, day: 1 })
    expect(toHijri(d(2000, 1, 1))).toEqual({ year: 1420, month: 9, day: 24 })
    expect(formatHijri(toHijri(d(2026, 2, 18)), 'bn')).toBe('১ রমজান ১৪৪৭')
    expect(formatHijri(toHijri(d(2026, 2, 18)), 'en')).toBe('1 Ramadan 1447')
  })
})

/* ============================================================================================= */

describe('B17 registry and validation', () => {
  it('registers the four new types with their defaults and contexts', () => {
    expect(B17_TYPES).toEqual(['ornament', 'payment_badges', 'delivery_promise', 'bangla_date'])
    for (const type of B17_TYPES) expect(elementPropProblems(type, elementMeta(type)!.props), type).toEqual([])
    expect(isAllowedIn('ornament', 'header')).toBe(true)
    expect(isAllowedIn('ornament', 'popup')).toBe(true)
    expect(isAllowedIn('bangla_date', 'footer')).toBe(true)
    expect(isAllowedIn('payment_badges', 'popup')).toBe(false)
    expect(isAllowedIn('delivery_promise', 'footer')).toBe(true)
    expect(isAllowedIn('trust_badges', 'popup')).toBe(true)
    expect(isTranslatableKey('payment_badges', 'note')).toBe(true)
    expect(isTranslatableKey('bangla_date', 'prefix')).toBe(true)
    expect(isTranslatableKey('ornament', 'name')).toBe(false)
  })

  it('has sixteen ornaments, two of them repeatable, with Bangla labels', () => {
    expect(ORNAMENT_NAMES).toHaveLength(16)
    expect(ORNAMENTS.filter((o) => o.repeatable).map((o) => o.name)).toEqual(['alpona_border', 'flag_ribbon'])
    expect(ORNAMENTS.every((o) => o.label_bn !== '')).toBe(true)
  })

  it('checks the props like the server', () => {
    const ornament = elementMeta('ornament')!.props
    expect(b17PropProblems('ornament', { ...ornament, repeat: true })).toEqual([{ path: 'repeat', code: 'invalid' }])
    expect(b17PropProblems('ornament', { ...ornament, name: 'alpona_border', repeat: true })).toEqual([])
    expect(b17PropProblems('ornament', { ...ornament, name: 'logo', size: 600, opacity: 5, flip: 'x', color: 'red' }).map((p) => p.path)).toEqual(['name', 'color', 'size', 'flip', 'opacity'])
    const pay = elementMeta('payment_badges')!.props
    expect(b17PropProblems('payment_badges', { ...pay, wallets: ['bkash', 'bkash', 'paypal'] })).toEqual([
      { path: 'wallets.1', code: 'duplicate' },
      { path: 'wallets.2', code: 'invalid' },
    ])
    const delivery = elementMeta('delivery_promise')!.props
    expect(b17PropProblems('delivery_promise', { ...delivery, zones: [] })).toEqual([{ path: 'zones', code: 'too_few' }])
    expect(b17PropProblems('delivery_promise', { ...delivery, zones: ['nope'] })).toEqual([{ path: 'zones.0', code: 'invalid' }])
    expect(b17PropProblems('bangla_date', { ...elementMeta('bangla_date')!.props, prefix: 'x'.repeat(61) })).toEqual([{ path: 'prefix', code: 'too_long' }])
  })

  it('lets trust badges take up to 8 items and an optional link', () => {
    const item = (i: number, extra: Record<string, unknown> = {}) => ({ id: `item-${i}`, icon: 'truck', title: `T${i}`, text: '', ...extra })
    expect(b6PropProblems('trust_badges', { items: Array.from({ length: 8 }, (_, i) => item(i)), style: 'row' })).toEqual([])
    expect(b6PropProblems('trust_badges', { items: Array.from({ length: 9 }, (_, i) => item(i)), style: 'row' })).toEqual([{ path: 'items', code: 'too_many' }])
    expect(b6PropProblems('trust_badges', { items: [item(1, { link: { url: '/pages/returns' } }), item(2, { link: null })], style: 'grid' })).toEqual([])
    expect(b6PropProblems('trust_badges', { items: [item(1, { link: { url: 'javascript:alert(1)' } })], style: 'grid' })).toEqual([{ path: 'items.0.link', code: 'invalid' }])
  })
})

/* ============================================================================================= */

const ZONE_A = '0199a5c1-0000-7000-8000-00000000d001'
const ZONE_B = '0199a5c1-0000-7000-8000-00000000d002'

const DELIVERY: DeliveryPromiseData = {
  zones: [
    { id: ZONE_A, name: 'Inside Dhaka', method: 'Home delivery', min_days: 1, max_days: 2, fee: '60.00', fee_from: '60.00', free_over: null, cod_allowed: true },
    { id: ZONE_B, name: 'All Bangladesh', method: null, min_days: 3, max_days: 5, fee: null, fee_from: '120.00', free_over: '3000.00', cod_allowed: false },
  ],
  cod_everywhere: false,
  free_over: null,
}

describe('B17 pure helpers', () => {
  it('lists store methods and the chosen wallets (props order, payload names, built-in names as a fallback)', () => {
    const data = { methods: [{ code: 'cod', name: 'Cash on delivery' }], wallets: [{ code: 'nagad', name: 'নগদ' }] }
    expect(paymentBadges({ show_store_methods: true, wallets: ['nagad', 'bkash', 'nagad', 'paypal'] }, data, 'bn')).toEqual([
      { kind: 'store', code: 'cod', name: 'Cash on delivery' },
      { kind: 'wallet', code: 'nagad', name: 'নগদ' },
      { kind: 'wallet', code: 'bkash', name: 'বিকাশ' },
    ])
    expect(paymentBadges({ show_store_methods: false, wallets: [] }, data, 'en')).toEqual([])
  })

  it('applies the delivery switches', () => {
    const all = deliverySummary({}, DELIVERY)!
    expect(all.lines.map((l) => [l.name, l.fee, l.from, l.cod, l.freeOver])).toEqual([
      ['Inside Dhaka', '60.00', null, true, null],
      ['All Bangladesh', null, '120.00', false, '3000.00'],
    ])
    const plain = deliverySummary({ show_price: false, show_cod: false, show_free_over: false }, DELIVERY)!
    expect(plain.lines.every((l) => l.fee === null && l.from === null && !l.cod && l.freeOver === null)).toBe(true)
    const everywhere = deliverySummary({}, { ...DELIVERY, cod_everywhere: true, free_over: '2000.00' })!
    expect(everywhere).toMatchObject({ codEverywhere: true, freeOver: '2000.00' })
    expect(everywhere.lines.every((l) => !l.cod && l.freeOver === null)).toBe(true)
    expect(deliverySummary({}, { zones: [], cod_everywhere: true, free_over: null })).toBeNull()
  })
})

/* ============================================================================================= */

function page(builder: BuilderPage): StorePage {
  return { slug: 'about', title: 'About us', template: 'default', body_html: '<p>Classic</p>', published_at: null, seo_title: null, seo_description: null, updated_at: null, builder }
}

function render(elements: Element[], options: { data?: Record<string, BuilderData>; source?: 'published' | 'draft'; locale?: 'en' | 'bn'; banglaDigits?: boolean } = {}) {
  const builder = payloadOf(documentOf(elements), { key: 'cms:x', data: options.data, source: options.source, locale: options.locale })
  const bn = options.locale === 'bn'
  mockApi({
    'GET /store/bootstrap': ok(bn ? bilingualBootstrap({ bangla_digits: options.banglaDigits ?? false }) : bootstrapFixture()),
    'GET /store/pages/about': ok(page(builder)),
    'GET /store/cart': ok(cartFixture()),
    'GET /store/wishlist': ok({ items: [] }),
  })
  return renderRoutes(storefrontRoutes, bn ? '/pages/about?lang=bn' : '/pages/about')
}

describe('B17 elements on the storefront', () => {
  it('draws ornaments as decoration only: coloured, flipped, faded, repeated borders', async () => {
    const { container } = render([
      elementNode('ornament', 'e_star', { name: 'crescent_star', color: '#0b6e4f', secondary_color: null, flip: 'horizontal', opacity: 60, align: 'right' }),
      elementNode('ornament', 'e_border', { name: 'alpona_border', color: 'theme:accent', size: 24, repeat: true }),
      elementNode('ornament', 'e_flag', { name: 'flag_ribbon', color: '#123456', secondary_color: '#654321' }),
      elementNode('ornament', 'e_spark', { name: 'sparkle', repeat: true }),
    ])
    await screen.findAllByTestId('builder-ornament')
    const star = container.querySelector('[data-b="e_star"]')!
    expect(star).toHaveAttribute('aria-hidden', 'true')
    expect(star).toHaveClass('justify-end')
    const svg = star.querySelector('svg')!
    expect(svg.getAttribute('style')).toContain('--o1: #0b6e4f')
    expect(svg.style.transform).toBe('scaleX(-1)')
    expect(svg.style.opacity).toBe('0.6')
    const border = container.querySelector('[data-b="e_border"] svg')!
    expect(border).toHaveAttribute('data-repeat', 'true')
    expect(border).toHaveAttribute('width', '100%')
    expect(border.querySelector('pattern')).not.toBeNull()
    expect(border.querySelector('rect')!.getAttribute('fill')).toMatch(/^url\(#orn-[A-Za-z0-9_-]+\)$/)
    // The flag keeps the national colours whatever the props say.
    const fills = [...container.querySelectorAll('[data-b="e_flag"] [fill]')].map((n) => n.getAttribute('fill'))
    expect(fills).toEqual(['#006a4e', '#f42a41'])
    // A drawing that is not a border never repeats.
    expect(container.querySelector('[data-b="e_spark"] svg')).not.toHaveAttribute('data-repeat')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows how to pay as text badges, with the note', async () => {
    render(
      [elementNode('payment_badges', 'e_pay', { title: 'How you can pay', wallets: ['bkash', 'nagad'], note: 'Send Money to the shop number at checkout.' })],
      {
        data: {
          e_pay: {
            methods: [
              { code: 'cod', name: 'Cash on delivery' },
              { code: 'bank_transfer', name: 'Bank transfer' },
            ],
            wallets: [
              { code: 'bkash', name: 'bKash' },
              { code: 'nagad', name: 'Nagad' },
            ],
          },
        },
      },
    )
    const section = await screen.findByRole('region', { name: 'How you can pay' })
    const items = within(section).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-code'))).toEqual(['cod', 'bank_transfer', 'bkash', 'nagad'])
    expect(items[2]).toHaveTextContent('bKash (Mobile banking)')
    expect(section.querySelector('img')).toBeNull()
    expect(within(section).getByText('Send Money to the shop number at checkout.')).toBeInTheDocument()
  })

  it('drops empty payment badges and delivery promises for visitors and marks them in a draft', async () => {
    const elements = [
      elementNode('payment_badges', 'e_pay', { wallets: [] }),
      elementNode('delivery_promise', 'e_ship', {}),
      elementNode('heading', 'e_head', { text: 'Below' }),
    ]
    const data = { e_pay: { methods: [], wallets: [] }, e_ship: { zones: [], cod_everywhere: false, free_over: null } }
    const { container, unmount } = render(elements, { data })
    await screen.findByRole('heading', { name: 'Below' })
    expect(container.querySelector('[data-b="e_pay"]')).toBeNull()
    expect(container.querySelector('[data-b="e_ship"]')).toBeNull()
    unmount()
    resetLocale()
    const draft = render(elements, { source: 'draft', data: { e_pay: { methods: [], wallets: [], state: 'empty' }, e_ship: { zones: [], cod_everywhere: false, free_over: null, state: 'empty' } } })
    await screen.findByRole('heading', { name: 'Below' })
    expect(draft.container.querySelectorAll('[data-node-state="empty"]')).toHaveLength(2)
  })

  it('promises delivery per zone as cards, a list or a bar', async () => {
    const { container } = render(
      [
        elementNode('delivery_promise', 'e_cards', { title: 'Delivery', layout: 'cards' }),
        elementNode('delivery_promise', 'e_list', { title: 'Delivery times', layout: 'list', show_cod: false }),
        elementNode('delivery_promise', 'e_bar', { title: 'Shipping', layout: 'bar' }),
      ],
      { data: { e_cards: DELIVERY, e_list: DELIVERY, e_bar: { ...DELIVERY, cod_everywhere: true, free_over: '2000.00' } } },
    )
    const cards = await screen.findByRole('region', { name: 'Delivery' })
    const dhaka = cards.querySelector(`[data-zone="${ZONE_A}"]`)!
    expect(dhaka).toHaveTextContent('Inside Dhaka')
    expect(dhaka).toHaveTextContent('Home delivery')
    expect(dhaka).toHaveTextContent('1–2 days')
    expect(dhaka.textContent).toMatch(/৳\s?60(?!\.)/)
    expect(dhaka).toHaveTextContent('Cash on delivery')
    const country = cards.querySelector(`[data-zone="${ZONE_B}"]`)!
    expect(country.textContent).toMatch(/from ৳\s?120/)
    expect(country.textContent).toMatch(/Free over ৳\s?3,000/)
    expect(within(cards).queryByTestId('delivery-promises')).toBeNull()

    const list = screen.getByRole('region', { name: 'Delivery times' })
    expect(list.querySelector(`[data-zone="${ZONE_A}"]`)).not.toHaveTextContent('Cash on delivery')

    const bar = container.querySelector('[data-b="e_bar"]')!
    expect(bar).toHaveAttribute('data-layout', 'bar')
    expect(within(bar as HTMLElement).getByTestId('delivery-promises')).toHaveTextContent('Cash on delivery everywhere')
    expect(within(bar as HTMLElement).getByTestId('delivery-promises').textContent).toMatch(/Free delivery over ৳\s?2,000/)
    expect(bar.querySelector(`[data-zone="${ZONE_A}"]`)).not.toHaveTextContent('Cash on delivery')
  })

  it('writes delivery days and prices in Bangla with Bengali digits', async () => {
    render([elementNode('delivery_promise', 'e_ship', { title: 'ডেলিভারি', layout: 'list' })], { data: { e_ship: { ...DELIVERY, zones: [{ ...DELIVERY.zones[0]!, name: 'ঢাকার ভিতরে' }] } }, locale: 'bn', banglaDigits: true })
    const section = await screen.findByRole('region', { name: 'ডেলিভারি' })
    expect(section).toHaveTextContent('ঢাকার ভিতরে')
    expect(section).toHaveTextContent('১–২ দিন')
    expect(section.textContent).toMatch(/৳\s?৬০/)
    expect(section).toHaveTextContent('ক্যাশ অন ডেলিভারি')
  })

  it('shows today in the Bangla calendar in the store time zone, with Gregorian and expected Hijri dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 14 April 2027, 00:30 in Dhaka (still 13 April in UTC).
    vi.setSystemTime(new Date('2027-04-13T18:30:00Z'))
    render([elementNode('bangla_date', 'e_date', { prefix: 'আজ', show_gregorian: true, show_hijri: true, style: 'plain' })], { data: { e_date: { timezone: 'Asia/Dhaka' } }, locale: 'bn' })
    const main = await screen.findByTestId('bangla-date-main')
    expect(main).toHaveTextContent('১ বৈশাখ ১৪৩৪, বুধবার')
    expect(main).toHaveAttribute('datetime', '2027-04-14')
    expect(screen.getByText('আজ')).toBeInTheDocument()
    // Plain keeps the surrounding text colour (no colour or background of its own).
    expect(screen.getByTestId('builder-bangla-date').querySelector('p')!.className).toBe('')
    expect(screen.getByTestId('bangla-date-gregorian')).toHaveTextContent('১৪ এপ্রিল ২০২৭')
    expect(screen.getByTestId('bangla-date-hijri')).toHaveTextContent(/^৭ জিলকদ ১৪৪৮ \(সম্ভাব্য\)$/)
  })

  it('spells the Bangla date in English on the English storefront, as a card with the season', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-16T06:00:00Z'))
    render([elementNode('bangla_date', 'e_date', { style: 'card', show_hijri: true })], { data: { e_date: { timezone: 'Asia/Dhaka' } } })
    const main = await screen.findByTestId('bangla-date-main')
    expect(main).toHaveTextContent('1 Poush 1433, Wednesday')
    const card = screen.getByTestId('builder-bangla-date')
    expect(card).toHaveAttribute('data-style', 'card')
    expect(card).toHaveTextContent('Winter')
    expect(card).toHaveTextContent('may differ by a day from the moon sighting')
    expect(screen.queryByTestId('bangla-date-gregorian')).toBeNull()
  })

  it('links a trust badge when it has a link', async () => {
    render([
      elementNode('trust_badges', 'e_trust', {
        items: [
          { id: 'item-1', icon: 'rotate-ccw', title: '7-day easy return', text: 'No questions asked', link: { url: '/pages/returns' } },
          { id: 'item-2', icon: 'shield-check', title: '100% original products', text: '' },
        ],
        style: 'row',
      }),
    ])
    const link = await screen.findByRole('link', { name: '7-day easy return' })
    expect(link).toHaveAttribute('href', '/pages/returns')
    expect(screen.getByText('100% original products').closest('a')).toBeNull()
  })
})
