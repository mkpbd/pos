import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Column, Element, ResponsiveStyle, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { ELEMENT_WORDS } from '../command-words'
import { buildElement } from './create-element'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { StyleTab } from './style-tab'
import { validateNode } from './validate'

/*
 * B20 inspector forms: the animated icon (grouped picker searched in English and Bangla, tiles
 * that play while pointed at — still under reduced motion —, animation, when it plays, line
 * weight, own colour with the contrast hint, the Decorative switch dropping the Bangla name), the
 * illustration (picker, play, size, colours, description) and Style → Background → Moving
 * background on sections and inner rows only.
 */

// The drawings are the storefront's lazy chunks; a light stand-in records what the form asks for.
vi.mock('@/storefront/builder/graphics/animated-icon', () => ({
  default: (p: { name: string; animation: string; playing?: boolean; background?: string }) => <span data-testid="icon-art" data-name={p.name} data-animation={p.animation} data-background={p.background} data-playing={String(p.playing)} />,
}))
vi.mock('@/storefront/builder/graphics/illustration', () => ({
  default: (p: { name: string; palette: string; playing?: boolean }) => <span data-testid="illustration-art" data-name={p.name} data-palette={p.palette} data-playing={String(p.playing)} />,
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const THEME = { colors: { primary: '#0f766e', accent: '#b45309', highlight: '#15803d', text: '#475569', canvas: '#ffffff', surface: '#ffffff' } }

type AnyProps = Element & { props: Record<string, unknown> }

const node = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const base = buildElement(type, registry, new Set())!
  return { ...base, id: 'e_test01', props: { ...base.props, ...props }, ...extra } as unknown as Element
}

const section = (elements: Element[]): Section =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_sec001', type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

function setup(initial: BuilderNode, options: { locales?: string[]; enums?: Record<string, unknown> } = {}) {
  const onChange = vi.fn()
  const reg = { ...registry, enums: options.enums ?? {} }
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    return (
      <Inspector
        content={content}
        node={current}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={reg}
        locales={options.locales ?? ['en']}
        errors={[]}
        theme={THEME}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={() => undefined}
      />
    )
  }
  mockApi({ 'GET /auth/me': ok(makeCurrentUser()), 'GET /storefront/theme': ok({ settings: { colors: THEME.colors }, custom_css: null, has_custom_css: false, updated_at: null }) })
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as AnyProps }
}

describe('B20 catalogue', () => {
  it('has an icon, a plain hint and search words for both elements; new ones start valid', () => {
    for (const type of ['animated_icon', 'illustration']) {
      expect(ELEMENT_ICONS[type]).toBeDefined()
      expect(ELEMENT_HINTS[type]).toBeTruthy()
      expect(ELEMENT_WORDS[type]).toBeTruthy()
      expect(validateNode(buildElement(type, registry, new Set())!)).toEqual([])
    }
  })

  it('reports a custom colour that is missing in plain words', () => {
    const problems = validateNode(node('animated_icon', { color_role: 'custom' }) as BuilderNode)
    expect(problems).toEqual([expect.objectContaining({ path: expect.stringMatching(/props\.color$/), message: 'Choose your colour.' })])
  })
})

describe('B20 animated icon form', () => {
  it('searches in English and Bangla, previews a tile while pointed at, picks it', async () => {
    const { user, last } = setup(node('animated_icon'))
    const picker = await screen.findByTestId('animated-icon-picker')
    expect(within(picker).getByRole('group', { name: 'Delivery' })).toBeInTheDocument()
    const search = within(picker).getByLabelText('Search icons')
    await user.type(search, 'বিকাশ')
    expect(within(picker).getByTestId('animated-icon-mobile_wallet')).toBeInTheDocument()
    expect(within(picker).queryByTestId('animated-icon-delivery_truck')).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'zzzz')
    expect(within(picker).getByText(/No icon matches/)).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'gift')

    const tile = within(picker).getByTestId('animated-icon-gift')
    await user.hover(tile)
    expect(tile).toHaveAttribute('data-playing', 'true')
    expect(within(tile).getByTestId('icon-art')).toHaveAttribute('data-playing', 'true')
    await user.unhover(tile)
    expect(tile).not.toHaveAttribute('data-playing')
    await user.click(tile)
    expect(last().props.name).toBe('gift')
    expect(tile).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the tiles still under reduced motion', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query.includes('reduce'), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }) as MediaQueryList)
    const { user } = setup(node('animated_icon'))
    const tile = await screen.findByTestId('animated-icon-star')
    await user.hover(tile)
    expect(tile).not.toHaveAttribute('data-playing')
    expect(within(tile).getByTestId('icon-art')).toHaveAttribute('data-playing', 'false')
    matchMedia.mockRestore()
  })

  it('reads the groups and keywords of the registry', async () => {
    const enums = { animated_icon_groups: [{ key: 'fav', label: 'Favourites', label_bn: 'প্রিয়', icons: ['heart', 'star'] }], animated_icon_keywords: { heart: { en: ['love'], bn: ['ভালোবাসা'] } } }
    const { user } = setup(node('animated_icon'), { enums })
    const picker = await screen.findByTestId('animated-icon-picker')
    expect(within(picker).getByRole('group', { name: 'Favourites' })).toBeInTheDocument()
    expect(within(picker).getByRole('group', { name: 'More' })).toBeInTheDocument()
    await user.type(within(picker).getByLabelText('Search icons'), 'ভালোবাসা')
    expect(within(picker).getByRole('button', { name: 'Heart' })).toBeInTheDocument()
  })

  it('animation, when it plays, line weight, size and background shape', async () => {
    const { user, last } = setup(node('animated_icon'))
    await user.click(await screen.findByRole('radio', { name: 'Wiggle' }))
    expect(last().props.animation).toBe('wiggle')
    await user.click(screen.getByRole('combobox', { name: 'When it plays' }))
    await user.click(await screen.findByRole('option', { name: 'Over and over' }))
    expect(last().props.trigger).toBe('loop')
    expect(screen.getByText(/Shoppers can stop it with the pause button/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Thin' }))
    expect(last().props.stroke).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Large' }))
    expect(last().props.size).toBe(96)
    await user.click(screen.getByRole('combobox', { name: 'Background shape' }))
    await user.click(await screen.findByRole('option', { name: 'Circle' }))
    expect(last().props.background).toBe('circle')
    expect(within(screen.getByTestId('animated-icon-preview')).getByTestId('icon-art')).toHaveAttribute('data-background', 'circle')
  })

  it('own colour: lower-case hex, a contrast hint under 3:1, back to a theme colour drops it', async () => {
    const { user, last } = setup(node('animated_icon'))
    await user.click(await screen.findByRole('button', { name: 'Your own colour' }))
    expect(last().props).toMatchObject({ color_role: 'custom', color: '#0f766e' })
    const hex = screen.getByLabelText('Icon colour hex value')
    await user.clear(hex)
    await user.type(hex, '#FDE68A')
    expect(last().props.color).toBe('#fde68a')
    expect(screen.getByTestId('icon-contrast-hint')).toHaveTextContent('hard to see')
    await user.click(screen.getByRole('button', { name: 'Accent colour' }))
    expect(last().props.color_role).toBe('accent')
    expect('color' in last().props).toBe(false)
    expect(screen.queryByTestId('icon-contrast-hint')).not.toBeInTheDocument()
  })

  it('Decorative switch: off fills a name to edit, on empties it and its Bangla', async () => {
    const { user, last } = setup(node('animated_icon', { name: 'cash_on_delivery' }), { locales: ['en', 'bn'] })
    const decorative = await screen.findByRole('switch', { name: 'Decorative (no label)' })
    expect(decorative).toBeChecked()
    expect(screen.queryByLabelText('Name for screen readers')).not.toBeInTheDocument()
    await user.click(decorative)
    expect(last().props.label).toMatch(/cash on delivery/i)
    const name = screen.getByLabelText('Name for screen readers')
    await user.clear(name)
    await user.type(name, 'Pay on delivery')
    expect(last().props.label).toBe('Pay on delivery')
    await user.click(screen.getByRole('button', { name: /বাংলা/ }))
    await user.type(screen.getByLabelText('Name for screen readers in Bangla'), 'ক্যাশ অন ডেলিভারি')
    expect(last().translations).toMatchObject({ bn: { label: 'ক্যাশ অন ডেলিভারি' } })
    await user.click(screen.getByRole('switch', { name: 'Decorative (no label)' }))
    expect(last().props.label).toBe('')
    expect(last().translations).toEqual({})
  })
})

describe('B20 picker tiles take every press', () => {
  it('draw their previews in a layer that ignores the pointer (a loading placeholder can’t swallow a click)', async () => {
    setup(node('illustration'))
    const picker = await screen.findByTestId('illustration-picker')
    const layers = picker.querySelectorAll('[data-tile-art]')
    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) expect(layer).toHaveClass('pointer-events-none')
  })

  it('also on the icon and animation tiles', async () => {
    setup(node('animated_icon'))
    await screen.findByTestId('animated-icon-picker')
    const layers = document.querySelectorAll('[data-tile-art]')
    expect(layers.length).toBeGreaterThan(40)
    for (const layer of layers) expect(layer).toHaveClass('pointer-events-none')
  })
})

describe('B20 illustration form', () => {
  it('picks with labels, plays, sizes, one colour, a description', async () => {
    const enums = { illustration_labels: { gift_unwrap: { en: 'Gift opening', bn: 'উপহার খোলা' } } }
    const { user, last } = setup(node('illustration'), { enums })
    const picker = await screen.findByTestId('illustration-picker')
    const gift = within(picker).getByRole('button', { name: 'Gift opening' })
    await user.hover(gift)
    expect(within(gift).getByTestId('illustration-art')).toHaveAttribute('data-playing', 'true')
    await user.click(gift)
    expect(last().props.name).toBe('gift_unwrap')
    await user.click(screen.getByRole('combobox', { name: 'When it plays' }))
    await user.click(await screen.findByRole('option', { name: 'When pointed at' }))
    expect(last().props.play).toBe('hover')
    await user.click(within(screen.getByTestId('illustration-size')).getByRole('button', { name: 'Small' }))
    expect(last().props.size).toBe('small')
    await user.click(screen.getByRole('button', { name: 'One colour' }))
    expect(last().props.palette).toBe('mono')
    expect(within(screen.getByTestId('illustration-preview')).getByTestId('illustration-art')).toHaveAttribute('data-palette', 'mono')
    await user.click(screen.getByRole('switch', { name: 'Decorative (no description)' }))
    expect(last().props.alt).toBe('Gift opening')
    await user.click(screen.getByRole('combobox', { name: 'Position' }))
    await user.click(await screen.findByRole('option', { name: 'Left' }))
    expect(last().props.align).toBe('left')
  })
})

describe('B20 Style → Moving background', () => {
  function styleSetup(initial: BuilderNode) {
    const onChange = vi.fn()
    function Harness() {
      const [current, setCurrent] = useState<BuilderNode>(initial)
      return (
        <StyleTab
          node={current}
          device="mobile"
          theme={THEME}
          onCommand={() => undefined}
          onChange={(next) => {
            onChange(next)
            setCurrent(next)
          }}
        />
      )
    }
    const user = userEvent.setup()
    renderWithQuery(<Harness />)
    return { user, style: (): ResponsiveStyle => (onChange.mock.calls.at(-1)![0] as { style: ResponsiveStyle }).style }
  }

  it('a section chooses a type, how many, colours (1–3); written on the desktop style for every device', async () => {
    const { user, style } = styleSetup({ ...section([]), style: { base: { background: { type: 'color', color: '#ffffff' } } } } as Section)
    const control = await screen.findByTestId('moving-background')
    expect(within(control).getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
    for (const layer of control.querySelectorAll('[data-tile-art]')) expect(layer).toHaveClass('pointer-events-none')
    await user.click(within(control).getByRole('radio', { name: 'Bubbles' }))
    expect(style().base).toEqual({ background: { type: 'color', color: '#ffffff' }, background_fx: { type: 'bubbles' } })
    expect(style().mobile).toBeUndefined()
    expect(within(control).getByTestId('moving-background-note')).toHaveTextContent('pause button')

    await user.click(within(control).getByRole('button', { name: 'Many' }))
    await user.click(within(control).getByRole('button', { name: 'Normal' }))
    expect(style().base?.background_fx).toEqual({ type: 'bubbles', density: 'high', speed: 'normal' })
    // Default colours: main + card background; the last one can't be unticked.
    expect(within(control).getByRole('checkbox', { name: 'Main colour' })).toBeChecked()
    await user.click(within(control).getByRole('checkbox', { name: 'Card background' }))
    expect(style().base?.background_fx?.colors).toEqual(['primary'])
    expect(within(control).getByRole('checkbox', { name: 'Main colour' })).toBeDisabled()
    await user.click(within(control).getByRole('checkbox', { name: 'Accent colour' }))
    await user.click(within(control).getByRole('checkbox', { name: 'Second colour' }))
    expect(style().base?.background_fx?.colors).toEqual(['primary', 'accent', 'secondary'])
    expect(within(control).getByRole('checkbox', { name: 'Card background' })).toBeDisabled()

    await user.click(within(control).getByRole('radio', { name: 'None' }))
    expect(style().base).toEqual({ background: { type: 'color', color: '#ffffff' } })
  })

  it('only sections and inner rows have it', async () => {
    renderWithQuery(<StyleTab node={node('heading', { text: 'Hi', level: 2, link: null }) as BuilderNode} device="desktop" onChange={() => undefined} onCommand={() => undefined} />)
    expect(screen.queryByTestId('moving-background')).not.toBeInTheDocument()
  })
})
