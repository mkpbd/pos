import { describe, expect, it } from 'vitest'
import type { AnimatedIconProps } from '@/storefront/builder/types'
import {
  b20Message,
  defaultFxColors,
  fxColors,
  humanize,
  iconColor,
  iconContrastHint,
  iconGroups,
  iconKeywords,
  iconTitle,
  illustrationLabels,
  searchIcons,
  toBackgroundFx,
  toggleFxColor,
  withColorRole,
  withoutKey,
  type IconGroup,
} from './b20-model'

/* B20 editor model: the icon picker's groups and search (en + bn), colours and the contrast hint, the moving background helpers, messages. */

const GROUPS: IconGroup[] = [
  { key: 'delivery', label: 'Delivery', label_bn: 'ডেলিভারি', icons: ['delivery_truck', 'parcel'] },
  { key: 'payment', label: 'Payment', label_bn: 'পেমেন্ট', icons: ['cash_on_delivery', 'mobile_wallet'] },
]
const KEYWORDS = {
  delivery_truck: { en: ['truck', 'shipping'], bn: ['ট্রাক', 'শিপিং'] },
  parcel: { en: ['box', 'package'], bn: ['পার্সেল'] },
  cash_on_delivery: { en: ['cash', 'cod'], bn: ['ক্যাশ অন ডেলিভারি'] },
  mobile_wallet: { en: ['wallet', 'bkash'], bn: ['মোবাইল ওয়ালেট'] },
}
const NAMES = ['delivery_truck', 'parcel', 'cash_on_delivery', 'mobile_wallet', 'gift']
const COLORS = { primary: '#0f766e', accent: '#b45309', highlight: '#15803d', text: '#475569', canvas: '#ffffff', surface: '#ffffff' }

const icon = (patch: Partial<AnimatedIconProps> = {}): AnimatedIconProps => ({ name: 'parcel', animation: 'draw', trigger: 'view', size: 64, stroke: 2, color_role: 'primary', background: 'none', label: '', ...patch })

describe('B20 icon catalogue', () => {
  it('reads the registry groups (unknown icons dropped, ungrouped ones in More) and falls back', () => {
    const enums = { animated_icon_groups: [{ key: 'delivery', label: 'Delivery', label_bn: 'ডেলিভারি', icons: ['delivery_truck', 'parcel', 'hovercraft'] }] }
    expect(iconGroups(enums, NAMES, GROUPS).map((g) => [g.key, g.icons])).toEqual([
      ['delivery', ['delivery_truck', 'parcel']],
      ['more', ['cash_on_delivery', 'mobile_wallet', 'gift']],
    ])
    expect(iconGroups({}, NAMES, GROUPS).map((g) => g.key)).toEqual(['delivery', 'payment', 'more'])
    expect(iconGroups({ animated_icon_groups: 'nope' }, ['parcel'], GROUPS)).toEqual([{ ...GROUPS[0]!, icons: ['parcel'] }])
  })

  it('reads keywords and illustration labels from the registry, else the fallback', () => {
    expect(iconKeywords({ animated_icon_keywords: { parcel: { en: ['box'], bn: 'x' } } }, KEYWORDS)).toEqual({ parcel: { en: ['box'], bn: [] } })
    expect(iconKeywords(undefined, KEYWORDS)).toBe(KEYWORDS)
    expect(illustrationLabels({ illustration_labels: { gift_unwrap: { en: 'Gift opening', bn: 'উপহার খোলা' } } }, {})).toEqual({ gift_unwrap: { en: 'Gift opening', bn: 'উপহার খোলা' } })
  })

  it('searches names, English and Bangla words and group names; every word must match', () => {
    const found = (q: string) => searchIcons(GROUPS, KEYWORDS, q).flatMap((g) => g.icons)
    expect(found('')).toEqual(['delivery_truck', 'parcel', 'cash_on_delivery', 'mobile_wallet'])
    expect(found('bkash')).toEqual(['mobile_wallet'])
    expect(found('ক্যাশ')).toEqual(['cash_on_delivery'])
    expect(found('পার্সেল')).toEqual(['parcel'])
    expect(found('Delivery')).toEqual(['delivery_truck', 'parcel', 'cash_on_delivery'])
    expect(found('delivery box')).toEqual(['parcel'])
    expect(found('rocket ship')).toEqual([])
  })

  it('titles tiles with the first words, else the name', () => {
    expect(iconTitle('delivery_truck', KEYWORDS)).toEqual({ en: 'Delivery truck', bn: 'ট্রাক' })
    expect(iconTitle('whatsapp_bubble', KEYWORDS).en).toBe('Phone chat')
    expect(iconTitle('gift', KEYWORDS)).toEqual({ en: 'Gift', bn: '' })
    expect(humanize('cash_on_delivery')).toBe('Cash on delivery')
  })
})

describe('B20 icon colours', () => {
  it('resolves roles to theme colours (secondary = highlight) and custom to its hex', () => {
    expect(iconColor(icon(), COLORS)).toBe('#0f766e')
    expect(iconColor(icon({ color_role: 'secondary' }), COLORS)).toBe('#15803d')
    expect(iconColor(icon({ color_role: 'text' }), COLORS)).toBe('#475569')
    expect(iconColor(icon({ color_role: 'custom', color: '#123456' }), COLORS)).toBe('#123456')
  })

  it('keeps `color` only with custom, starting from the colour shown', () => {
    const custom = withColorRole(icon({ color_role: 'accent' }), 'custom', COLORS)
    expect(custom).toMatchObject({ color_role: 'custom', color: '#b45309' })
    const back = withColorRole(custom, 'primary', COLORS)
    expect(back.color_role).toBe('primary')
    expect('color' in back).toBe(false)
  })

  it('hints when a custom colour is under 3:1 on the page background', () => {
    expect(iconContrastHint('#ffff66', COLORS)?.text).toMatch(/hard to see/)
    expect(iconContrastHint('#0f766e', COLORS)).toBeNull()
    expect(iconContrastHint('#eeeeee', { canvas: '#111111' })).toBeNull()
    expect(iconContrastHint(undefined, COLORS)).toBeNull()
  })

  it('drops a key from every language', () => {
    expect(withoutKey({ bn: { label: 'ট্রাক', other: 'x' }, fr: { label: 'camion' } }, 'label')).toEqual({ bn: { other: 'x' } })
  })
})

describe('B20 moving background', () => {
  it('keeps it sparse: defaults left out, colours reset with the type', () => {
    expect(toBackgroundFx({ type: 'bubbles' }, { density: 'high' })).toEqual({ type: 'bubbles', density: 'high' })
    expect(toBackgroundFx({ type: 'bubbles', density: 'high' }, { density: 'medium', speed: 'slow' })).toEqual({ type: 'bubbles' })
    expect(toBackgroundFx({ type: 'bubbles', colors: ['accent'] }, { type: 'snow' })).toEqual({ type: 'snow' })
  })

  it('ticks colours within 1–3, the type’s own colours stored as absent', () => {
    expect(defaultFxColors('snow')).toEqual(['surface'])
    expect(defaultFxColors('snow', { background_fx_default_colors: { snow: ['primary'] } })).toEqual(['primary'])
    expect(fxColors({ type: 'stars' })).toEqual(['accent'])
    const added = toggleFxColor({ type: 'stars' }, 'primary', true)
    expect(added).toEqual({ type: 'stars', colors: ['primary', 'accent'] })
    expect(toggleFxColor(added, 'primary', false)).toEqual({ type: 'stars' })
    // The last colour can't go; a fourth can't come.
    expect(toggleFxColor({ type: 'stars' }, 'accent', false)).toEqual({ type: 'stars' })
    const three = { type: 'gradient_flow' as const }
    expect(toggleFxColor(three, 'surface', true)).toBe(three)
  })
})

describe('B20 messages', () => {
  it('speaks plainly', () => {
    expect(b20Message('animated_icon', { path: 'color', code: 'required' })).toBe('Choose your colour.')
    expect(b20Message('animated_icon', { path: 'size', code: 'out_of_range' })).toBe('Use a whole number from 24 to 160 px.')
    expect(b20Message('animated_icon', { path: 'label', code: 'too_long' })).toBe('At most 80 characters.')
    expect(b20Message('illustration', { path: 'alt', code: 'too_long' })).toBe('At most 200 characters.')
    expect(b20Message('illustration', { path: 'play', code: 'invalid' })).toBe('Choose when it plays.')
  })
})
