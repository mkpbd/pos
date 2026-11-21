import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { BuilderDocument, Element, ResponsiveStyle, ScrollProgress, Section } from '@/storefront/builder/types'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorCommand, type InspectorDocument } from './index'
import {
  canHaveScrollProgress,
  hasBackgroundPicture,
  scrollPreviewKeyframes,
  scrollState,
  SCROLL_EFFECTS,
  toScroll,
  withBackgroundScroll,
  withKenBurns,
  withScrollProgress,
} from './b19-scroll'
import { ScrollControl } from './b19-scroll-control'
import { validateNode } from './validate'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const MEDIA = '0198f3a0-0000-7000-8000-000000000001'
const heading = (style: ResponsiveStyle = {}) => ({ id: 'e_head01', type: 'heading', props: { text: 'Fresh food', level: 2, link: null }, style, ...common }) as unknown as Element
const image = (props: Record<string, unknown> = {}) => ({ id: 'e_img001', type: 'image', props: { media_id: MEDIA, alt: 'Basket', link: null, aspect: 'auto', fit: 'cover', ...props }, style: {}, ...common }) as unknown as Element
const pictureBackground = (extra: Record<string, unknown> = {}) => ({ base: { background: { type: 'image', image: { media_id: MEDIA, position: 'center', size: 'cover', repeat: false }, ...extra } } }) as unknown as ResponsiveStyle
const section = (props: Record<string, unknown> = {}, style: ResponsiveStyle = {}) =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null, ...props }, style, ...common, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [] }] }) as unknown as Section

function mockAnimate() {
  const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null }) as unknown as Animation)
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
  return animate
}

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList)
}

const PAGE: InspectorDocument = { id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }

function setup(initial: BuilderNode | null, options: { document?: InspectorDocument; content?: Partial<BuilderDocument> } = {}) {
  mockApi({ 'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }) })
  const commands: InspectorCommand[] = []
  const onChange = vi.fn()
  function Harness() {
    const [node, setNode] = useState<BuilderNode | null>(initial)
    const [extra, setExtra] = useState<Partial<BuilderDocument>>(options.content ?? {})
    const sections = node === null ? [] : [node.type === 'section' ? (node as Section) : { ...section(), columns: [{ ...section().columns[0]!, elements: [node as Element] }] }]
    const content: BuilderContent = { schema_version: 1, sections, ...extra } as BuilderContent
    return (
      <Inspector
        content={content}
        node={node}
        document={options.document ?? PAGE}
        registry={registry}
        locales={['en']}
        errors={[]}
        device="desktop"
        theme={{ colors: { primary: '#0a7d4f', accent: '#f59e0b', secondary: '#334155' } }}
        onChange={(next, opts) => {
          onChange(next, opts)
          setNode(next)
        }}
        onCommand={(cmd) => {
          commands.push(cmd)
          if (cmd.type === 'set-scroll-progress') setExtra((c) => withScrollProgress(c, cmd.value))
        }}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, commands, last: () => onChange.mock.calls.at(-1)?.[0] as BuilderNode }
}

async function openScroll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Style' }))
  await user.click(screen.getByRole('button', { name: 'Scroll' }))
  return screen.getByTestId('scroll-control')
}

let animate: ReturnType<typeof mockAnimate>
beforeEach(() => {
  animate = mockAnimate()
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

describe('B19 scroll model', () => {
  it('keeps the scroll group sparse: defaults left out, None removes it', () => {
    const base = scrollState(undefined)
    expect(base).toEqual({ effect: 'none', intensity: 'medium', range: 'enter' })
    expect(toScroll(base)).toBeUndefined()
    expect(toScroll({ ...base, effect: 'rise' })).toEqual({ effect: 'rise' })
    expect(toScroll({ effect: 'reveal_circle', intensity: 'strong', range: 'enter_exit' })).toEqual({ effect: 'reveal_circle', intensity: 'strong', range: 'enter_exit' })
    expect(scrollState({ effect: 'blur', range: 'exit' })).toEqual({ effect: 'blur', intensity: 'medium', range: 'exit' })
    expect(SCROLL_EFFECTS).toHaveLength(12)
  })

  it('previews move the square through the tile; intensity scales the distance; ranges play in, across, out', () => {
    const enter = scrollPreviewKeyframes('rise', 'medium', 'enter')
    expect(enter[0]).toMatchObject({ offset: 0, transform: 'translateY(110%) translateY(60%)', opacity: 0.2 })
    expect(enter.at(-1)).toMatchObject({ offset: 1, transform: 'translateY(0%) translateY(0%)', opacity: 1 })
    expect(scrollPreviewKeyframes('rise', 'subtle')[0]!.transform).toBe('translateY(110%) translateY(30%)')
    expect(scrollPreviewKeyframes('rise', 'strong')[0]!.transform).toBe('translateY(110%) translateY(96%)')
    const exit = scrollPreviewKeyframes('fade', 'medium', 'exit')
    expect(exit[0]).toMatchObject({ opacity: 1 })
    expect(exit.at(-1)).toMatchObject({ transform: 'translateY(-110%)', opacity: 0.2 })
    expect(scrollPreviewKeyframes('reveal_up', 'medium', 'enter_exit').map((k) => k.clipPath)).toEqual(['inset(100% 0 0 0)', 'inset(0% 0 0 0)', 'inset(0% 0 0 0)', 'inset(100% 0 0 0)'])
    expect(scrollPreviewKeyframes('reveal_circle', 'medium', 'cover').map((k) => k.clipPath)).toEqual(['circle(0% at 50% 50%)', 'circle(37.5% at 50% 50%)', 'circle(75% at 50% 50%)'])
    // Only transform, opacity, clip-path and filter.
    for (const effect of SCROLL_EFFECTS) {
      for (const k of scrollPreviewKeyframes(effect, 'strong', 'enter_exit')) expect(Object.keys(k).every((key) => ['offset', 'transform', 'opacity', 'clipPath', 'filter'].includes(key))).toBe(true)
    }
  })

  it('background scroll needs a chosen picture without a video, and replaces the parallax in the same edit', () => {
    expect(hasBackgroundPicture(section({}, pictureBackground()))).toBe(true)
    expect(hasBackgroundPicture(section({}, pictureBackground({ video: { media_id: MEDIA } })))).toBe(false)
    expect(hasBackgroundPicture(section({}, { base: { background: { type: 'color', color: '#fff' } } } as ResponsiveStyle))).toBe(false)
    const withParallax = section({}, pictureBackground({ parallax: 'slow' }))
    const zoomed = withBackgroundScroll(withParallax, 'zoom_in')
    expect(zoomed.props.background_scroll).toBe('zoom_in')
    expect(zoomed.style.base?.background).not.toHaveProperty('parallax')
    const off = withBackgroundScroll(zoomed, 'none')
    expect(off.props).not.toHaveProperty('background_scroll')
  })

  it('Ken Burns props: off removes both keys, the direction only when not alternate', () => {
    expect(withKenBurns({ media_id: MEDIA }, 'slow')).toEqual({ media_id: MEDIA, ken_burns: 'slow' })
    expect(withKenBurns({ media_id: MEDIA }, 'normal', 'out')).toEqual({ media_id: MEDIA, ken_burns: 'normal', ken_burns_direction: 'out' })
    expect(withKenBurns({ media_id: MEDIA, ken_burns: 'normal', ken_burns_direction: 'in' }, 'none')).toEqual({ media_id: MEDIA })
  })

  it('reading progress: pages, content pages and store page templates only; null removes it', () => {
    expect(canHaveScrollProgress({ kind: 'page', key: 'home' })).toBe(true)
    expect(canHaveScrollProgress({ kind: 'page', key: 'cms:abc' })).toBe(true)
    expect(canHaveScrollProgress({ kind: 'page', key: 'template:product' })).toBe(true)
    expect(canHaveScrollProgress({ kind: 'zone', key: 'zone:listing.top' })).toBe(false)
    expect(canHaveScrollProgress({ kind: 'header', key: 'header' })).toBe(false)
    expect(canHaveScrollProgress({ kind: 'popup', key: 'popup:1' })).toBe(false)
    const bar: ScrollProgress = { position: 'bottom', color_role: 'accent', thickness: 4 }
    const content: { schema_version: 1; sections: never[]; scroll_progress?: ScrollProgress } = { schema_version: 1, sections: [] }
    expect(withScrollProgress(content, bar)).toEqual({ ...content, scroll_progress: bar })
    expect(withScrollProgress({ ...content, scroll_progress: bar }, null)).toEqual(content)
    expect(withScrollProgress(content, null)).toBe(content)
  })
})

describe('B19 Scroll group', () => {
  it('effect tiles, how strong, when it plays and ▶ Preview', async () => {
    const { user, last, commands } = setup(heading())
    const group = await openScroll(user)
    const tiles = within(within(group).getByTestId('scroll-effect-tiles'))
    expect(tiles.getAllByRole('radio')).toHaveLength(13)
    expect(within(group).getByRole('button', { name: 'Preview the scroll effect' })).toBeDisabled()
    expect(within(group).queryByText('How strong')).not.toBeInTheDocument()

    await user.click(tiles.getByRole('radio', { name: 'Rise' }))
    expect(last().style).toEqual({ base: { scroll: { effect: 'rise' } } })
    await user.keyboard('{ArrowRight}')
    expect(last().style.base?.scroll).toEqual({ effect: 'sink' })
    expect(tiles.getByRole('radio', { name: 'Sink' })).toHaveFocus()

    await user.click(within(group).getByRole('radio', { name: 'Subtle' }))
    expect(last().style.base?.scroll).toEqual({ effect: 'sink', intensity: 'subtle' })
    fireEvent.change(within(group).getByLabelText('When it plays'), { target: { value: 'enter_exit' } })
    expect(last().style.base?.scroll).toEqual({ effect: 'sink', intensity: 'subtle', range: 'enter_exit' })
    expect(within(group).getByLabelText('When it plays')).toHaveDisplayValue('Both: comes in and leaves')

    await user.click(within(group).getByRole('button', { name: 'Preview the scroll effect' }))
    expect(commands).toContainEqual({ type: 'preview-scroll', nodeId: 'e_head01' })

    await user.click(tiles.getByRole('radio', { name: 'None' }))
    expect(last().style).toEqual({})
  })

  it('tiles play their preview while pointed at, and stay still under reduced motion', async () => {
    reducedMotion(false)
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<ScrollControl value={{ effect: 'rise', intensity: 'strong' }} onChange={onChange} />)
    animate.mockClear()
    await user.hover(screen.getByRole('radio', { name: 'Circle reveal' }))
    expect(animate).toHaveBeenCalledWith(scrollPreviewKeyframes('reveal_circle', 'strong', 'enter'), expect.objectContaining({ easing: 'linear' }))
    unmount()

    reducedMotion(true)
    render(<ScrollControl value={undefined} onChange={onChange} />)
    animate.mockClear()
    await user.hover(screen.getByRole('radio', { name: 'Grow' }))
    expect(animate).not.toHaveBeenCalled()
  })

  it('a section: the background moves while scrolling once there is a picture, replacing the parallax', async () => {
    const { user, last } = setup(section({}, pictureBackground({ parallax: 'slow' })))
    const group = await openScroll(user)
    const bg = within(within(group).getByTestId('background-scroll-tiles'))
    expect(within(group).getByTestId('background-scroll-replaces')).toHaveTextContent('replaces the background picture scrolling')
    await user.click(bg.getByRole('radio', { name: 'Zoom in' }))
    expect((last() as Section).props.background_scroll).toBe('zoom_in')
    expect(last().style.base?.background).not.toHaveProperty('parallax')

    // Choosing a parallax again (Animation) turns the background scroll off.
    await user.click(screen.getByRole('button', { name: 'Animation' }))
    expect(screen.getByTestId('parallax-replaced')).toBeInTheDocument()
    await user.click(within(screen.getByTestId('parallax-control')).getByRole('radio', { name: 'Slower' }))
    expect((last() as Section).props).not.toHaveProperty('background_scroll')
    expect(last().style.base?.background).toMatchObject({ parallax: 'medium' })
  })

  it('a section without a background picture: the background motions are off with a hint', async () => {
    const { user } = setup(section())
    const group = await openScroll(user)
    const bg = within(within(group).getByTestId('background-scroll-tiles'))
    expect(bg.getByRole('radio', { name: 'Zoom in' })).toBeDisabled()
    expect(group).toHaveTextContent('Choose a background picture for Desktop first')
  })

  it('elements have no background motion', async () => {
    const { user } = setup(heading())
    const group = await openScroll(user)
    expect(within(group).queryByTestId('background-scroll-control')).not.toBeInTheDocument()
  })
})

describe('B19 Slow zoom (Ken Burns) and Reading progress bar', () => {
  it('pictures: off, slow or normal, and the direction', async () => {
    const { user, last } = setup(image())
    const picker = within(screen.getByTestId('ken-burns-picker'))
    expect(picker.queryByText('Direction')).not.toBeInTheDocument()
    await user.click(picker.getByRole('radio', { name: 'Slow' }))
    expect((last() as Element).props).toMatchObject({ ken_burns: 'slow' })
    expect((last() as Element).props).not.toHaveProperty('ken_burns_direction')
    await user.click(picker.getByRole('radio', { name: 'Zoom out' }))
    expect((last() as Element).props).toMatchObject({ ken_burns: 'slow', ken_burns_direction: 'out' })
    expect(screen.getByTestId('ken-burns-picker')).toHaveTextContent('Pause animations')
    await user.click(picker.getByRole('radio', { name: 'Off' }))
    expect((last() as Element).props).not.toHaveProperty('ken_burns')
    expect((last() as Element).props).not.toHaveProperty('ken_burns_direction')
  })

  it('the hero slider has it at the top level of its props; other elements don’t', () => {
    const slider = { id: 'e_hero01', type: 'hero_slider', props: { title: null, subtitle: null, config: { autoplay_seconds: 6, height: 'large' }, items: [] }, style: {}, ...common } as unknown as Element
    setup(slider)
    expect(screen.getByTestId('ken-burns-picker')).toBeInTheDocument()
  })

  it('no slow zoom on headings', () => {
    setup(heading())
    expect(screen.queryByTestId('ken-burns-picker')).not.toBeInTheDocument()
  })

  it('page settings: switch on, then position, colour and thickness (all three keys kept)', async () => {
    const { user, commands } = setup(null)
    const panel = within(screen.getByTestId('reading-progress'))
    await user.click(panel.getByRole('switch', { name: 'Show a reading progress bar' }))
    expect(commands.at(-1)).toEqual({ type: 'set-scroll-progress', value: { position: 'top', color_role: 'primary', thickness: 3 }, coalesceKey: 'scroll_progress:on' })
    await user.click(panel.getByRole('radio', { name: 'Bottom' }))
    expect(commands.at(-1)).toMatchObject({ value: { position: 'bottom', color_role: 'primary', thickness: 3 } })
    await user.click(panel.getByRole('radio', { name: 'Accent' }))
    fireEvent.change(panel.getByLabelText('Thickness'), { target: { value: '5' } })
    expect(commands.at(-1)).toEqual({ type: 'set-scroll-progress', value: { position: 'bottom', color_role: 'accent', thickness: 5 }, coalesceKey: 'scroll_progress:thickness' })
    expect(screen.getByTestId('reading-progress-sample').querySelector('span')).toHaveStyle({ height: '5px', backgroundColor: '#f59e0b' })
    await user.click(panel.getByRole('switch', { name: 'Show a reading progress bar' }))
    expect(commands.at(-1)).toEqual({ type: 'set-scroll-progress', value: null, coalesceKey: 'scroll_progress:on' })
  })

  it('no reading progress bar on headers and shop areas', () => {
    setup(null, { document: { id: 'd-2', kind: 'zone', key: 'zone:listing.top', title: 'Above the list', path: null, published: null } })
    expect(screen.queryByTestId('reading-progress')).not.toBeInTheDocument()
  })
})

describe('B19 slow zoom: inspector validation', () => {
  it('plain messages for an unknown speed or direction, and on elements without it', () => {
    expect(validateNode(image({ ken_burns: 'fast' }))).toEqual([{ path: 'props.ken_burns', message: 'Choose Off, Slow or Normal for the slow zoom.' }])
    expect(validateNode(image({ ken_burns: 'slow', ken_burns_direction: 'sideways' }))).toEqual([{ path: 'props.ken_burns_direction', message: 'Choose In and out, Zoom in or Zoom out.' }])
    expect(validateNode(image({ ken_burns: 'normal', ken_burns_direction: 'out' }))).toEqual([])
    const slider = { id: 'e_hero01', type: 'hero_slider', props: { title: null, subtitle: null, config: { autoplay_seconds: 6, height: 'large' }, items: [{ item_type: 'banner', item_id: MEDIA }], ken_burns: 'warp' }, style: {}, ...common } as unknown as Element
    expect(validateNode(slider)).toContainEqual({ path: 'props.ken_burns', message: 'Choose Off, Slow or Normal for the slow zoom.' })
    const text = { ...heading(), props: { text: 'Fresh', level: 2, link: null, ken_burns: 'slow' } } as unknown as Element
    expect(validateNode(text)).toEqual([{ path: 'props.ken_burns', message: 'Only pictures, image carousels and hero sliders can zoom slowly.' }])
  })

  it('the picker shows the problem', () => {
    setup(image({ ken_burns: 'fast' }))
    expect(screen.getByTestId('ken-burns-picker')).toHaveTextContent('Choose Off, Slow or Normal for the slow zoom.')
  })
})
