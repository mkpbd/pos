import { afterEach, describe, expect, it } from 'vitest'
import { mockApi, ok } from '@/test/utils'
import { storeApi } from '../http'
import { formatPrice, formatShortPrice, promotionBadge } from '../money'
import { bn } from './bn'
import { en } from './en'
import { formatCurrency, formatDate, formatNumber, localizeDigits } from './format'
import { resetLocaleRuntime, setLocaleRuntime } from './runtime'
import { createTranslator, isMessageKey } from './translate'
import type { Message } from './types'

const placeholders = (message: Message) =>
  new Set((typeof message === 'string' ? [message] : [message.one, message.other]).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))

/** Texts that are rightly the same in both languages (language names, the SKU abbreviation, a phone format typed in Latin digits). */
const SAME_IN_BOTH = new Set(['common.language.en', 'common.language.bn', 'catalog.summary.sku', 'cart.line.sku', 'orders.items.sku', 'checkout.phonePlaceholder'])

afterEach(() => resetLocaleRuntime())

describe('dictionaries', () => {
  const keys = Object.keys(en) as (keyof typeof en)[]

  it('has every English key in Bangla, with the same shape and no empty text', () => {
    expect(Object.keys(bn).sort()).toEqual([...keys].sort())
    const empty: string[] = []
    for (const key of keys) {
      const source: Message = en[key]
      const translation: Message = bn[key]
      expect(typeof translation, key).toBe(typeof source)
      const texts = typeof translation === 'string' ? [translation] : [translation.one, translation.other]
      if (texts.some((text) => text.trim() === '')) empty.push(key)
    }
    expect(empty).toEqual([])
  })

  it('uses only placeholders the English text provides, and namespaced keys', () => {
    const unknown = keys.filter((key) => [...placeholders(bn[key])].some((name) => !placeholders(en[key]).has(name)))
    expect(unknown).toEqual([])
    expect(keys.filter((key) => !/^[a-z]+\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/.test(key))).toEqual([])
  })

  it('translates (nearly) everything: Bangla texts contain Bengali script', () => {
    const latinOnly = keys.filter((key) => {
      if (SAME_IN_BOTH.has(key)) return false
      const message: Message = bn[key]
      const texts = typeof message === 'string' ? [message] : [message.one, message.other]
      // A text of placeholders, digits, symbols and Latin abbreviations only (e.g. "{server}") has nothing to translate.
      return texts.every((text) => !/[ঀ-৿]/.test(text)) && /[a-z]{3,}/i.test(texts.join(' ').replace(/\{\w+\}/g, ''))
    })
    expect(latinOnly).toEqual([])
  })
})

describe('t()', () => {
  const enT = createTranslator(en, { locale: 'en', banglaDigits: false })
  const bnT = createTranslator(bn, { locale: 'bn', banglaDigits: false })
  const bnDigitsT = createTranslator(bn, { locale: 'bn', banglaDigits: true })

  it('fills placeholders and leaves unknown ones for rich()', () => {
    expect(enT('common.storeHome', { store: 'Berry Kids' })).toBe('Berry Kids home')
    expect(bnT('common.storeHome', { store: 'Berry Kids' })).toBe('Berry Kids হোম')
    expect(enT('common.storeHome')).toBe('{store} home')
  })

  it('picks plural forms by count and formats numbers for the locale', () => {
    expect(enT('common.items', { count: 1 })).toBe('1 item')
    expect(enT('common.items', { count: 1234 })).toBe('1,234 items')
    expect(bnT('common.items', { count: 3 })).toBe('3টি পণ্য')
    expect(bnDigitsT('common.items', { count: 3 })).toBe('৩টি পণ্য')
    // Strings go in as they are (order numbers, codes).
    expect(bnDigitsT('common.storeHome', { store: 'Shop 24' })).toBe('Shop 24 হোম')
  })

  it('knows its keys', () => {
    expect(isMessageKey('common.cart')).toBe(true)
    expect(isMessageKey('The quantity must be a whole number.')).toBe(false)
  })
})

describe('formatting', () => {
  it('formats amounts per locale: Latin digits unless Bengali digits are on, ৳ first in both', () => {
    expect(formatCurrency('1234.50', 'BDT', false, { locale: 'en', banglaDigits: false })).toBe('৳1,234.50')
    expect(formatCurrency('1234.50', 'BDT', false, { locale: 'bn', banglaDigits: false })).toBe('৳1,234.50')
    expect(formatCurrency('1234567.50', 'BDT', false, { locale: 'bn', banglaDigits: false })).toBe('৳12,34,567.50')
    expect(formatCurrency('1234.50', 'BDT', false, { locale: 'bn', banglaDigits: true })).toBe('৳১,২৩৪.৫০')
    expect(formatCurrency('-45', 'BDT', true, { locale: 'bn', banglaDigits: true })).toBe('-৳৪৫')
    // English never uses Bengali digits, whatever the setting.
    expect(formatCurrency('20', 'BDT', true, { locale: 'en', banglaDigits: true })).toBe('৳20')
  })

  it('follows the published locale in the price helpers', () => {
    expect(formatPrice('120.00', 'BDT')).toBe('৳120.00')
    setLocaleRuntime({ lang: 'bn', banglaDigits: true })
    expect(formatPrice('120.00', 'BDT')).toBe('৳১২০.০০')
    expect(formatShortPrice('20.00', 'BDT')).toBe('৳২০')
    expect(promotionBadge({ type: 'percent', value: '10.00' }, 'BDT')).toBe('−১০ %')
    setLocaleRuntime({ lang: 'bn', banglaDigits: false })
    expect(formatPrice('120.00', 'BDT')).toBe('৳120.00')
  })

  it('formats numbers, dates and loose digits', () => {
    expect(formatNumber('1234.5', {}, { locale: 'en', banglaDigits: false })).toBe('1,234.5')
    expect(formatNumber(1234, {}, { locale: 'bn', banglaDigits: true })).toBe('১,২৩৪')
    expect(formatNumber('WEB-1', {}, { locale: 'bn', banglaDigits: true })).toBe('WEB-1')
    expect(formatDate('2026-11-05T10:00:00Z', 'medium', { locale: 'en', banglaDigits: false })).toBe('Nov 5, 2026')
    expect(formatDate('2026-11-05T10:00:00Z', 'medium', { locale: 'bn', banglaDigits: false })).toMatch(/^5 নভে(ম্বর)?,? 2026$/)
    expect(formatDate('2026-11-05T10:00:00Z', 'medium', { locale: 'bn', banglaDigits: true })).toMatch(/^৫ নভে(ম্বর)?,? ২০২৬$/)
    expect(localizeDigits('1–24', { locale: 'bn', banglaDigits: true })).toBe('১–২৪')
    expect(localizeDigits('1–24', { locale: 'bn', banglaDigits: false })).toBe('1–24')
  })
})

describe('the store API client', () => {
  it('adds the published language to every /store/* request, and nothing before it is known', async () => {
    const fetchMock = mockApi({ 'GET /store/cart': ok({}), 'GET /store/products': ok([]), 'POST /store/cart/items': ok({}), 'GET /store/bootstrap': ok({}) })

    await storeApi.get('/store/cart')
    setLocaleRuntime({ lang: 'bn', banglaDigits: false })
    await storeApi.get('/store/cart', { query: { page: 2 } })
    await storeApi.get('/store/products?category=juices&colour=Red')
    await storeApi.post('/store/cart/items', { variant_id: 'v-1', quantity: '1' })
    // An explicit language wins (the bootstrap asks for the requested one; undefined = the store default).
    await storeApi.get('/store/bootstrap', { query: { lang: 'en' } })
    await storeApi.get('/store/bootstrap', { query: { lang: undefined } })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/store/cart',
      '/api/v1/store/cart?page=2&lang=bn',
      '/api/v1/store/products?category=juices&colour=Red&lang=bn',
      '/api/v1/store/cart/items?lang=bn',
      '/api/v1/store/bootstrap?lang=en',
      '/api/v1/store/bootstrap',
    ])
  })
})
