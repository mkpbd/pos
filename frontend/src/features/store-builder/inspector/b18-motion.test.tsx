import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Element, ResponsiveStyle, Section } from '@/storefront/builder/types'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorCommand } from './index'
import { motionState, toMotion } from './b9-motion'
import { cssEasing, cubicBezier, EASING_FUNCTIONS, easingPath, linearEasing } from './b18-motion'
import { CardHoverPicker } from './b18-card-hover'
import { MotionControl } from './b9-motion-control'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const heading = (style: ResponsiveStyle = {}) => ({ id: 'e_head01', type: 'heading', props: { text: 'Fresh food', level: 2, link: null }, style, ...common }) as unknown as Element
const button = () => ({ id: 'e_btn001', type: 'button', props: { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false }, style: {}, ...common }) as unknown as Element
const section = (props: Record<string, unknown> = {}) =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null, ...props }, style: {}, ...common, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [] }] }) as unknown as Section

/** Web Animations in jsdom: a spy that returns a finished-able animation. */
function mockAnimate() {
  const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null }) as unknown as Animation)
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
  return animate
}

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList)
}

function setup(initial: BuilderNode, locales = ['en']) {
  mockApi({ 'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }) })
  const commands: InspectorCommand[] = []
  const onChange = vi.fn()
  function Harness() {
    const [node, setNode] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [node.type === 'section' ? (node as Section) : { ...section(), columns: [{ ...section().columns[0]!, elements: [node as Element] }] }] }
    return (
      <Inspector
        content={content}
        node={node}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={locales}
        errors={[]}
        device="desktop"
        onChange={(next, opts) => {
          onChange(next, opts)
          setNode(next)
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
  return { user, commands, last: () => onChange.mock.calls.at(-1)?.[0] as BuilderNode }
}

async function openAnimation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Style' }))
  await user.click(screen.getByRole('button', { name: 'Animation' }))
  return screen.getByTestId('motion-control')
}

let animate: ReturnType<typeof mockAnimate>
beforeEach(() => {
  animate = mockAnimate()
})
afterEach(() => {
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

describe('B18 motion model', () => {
  it('keeps the easing sparse: only when not smooth and something enters', () => {
    const base = motionState(undefined)
    expect(base.easing).toBe('smooth')
    expect(toMotion({ ...base, entrance: 'mask-up', easing: 'spring' })).toEqual({ entrance: 'mask-up', duration: 600, delay: 0, easing: 'spring' })
    expect(toMotion({ ...base, entrance: 'drop-in', easing: 'smooth' })).toEqual({ entrance: 'drop-in', duration: 600, delay: 0 })
    // A loop alone has no easing; a staggered section keeps it for its children.
    expect(toMotion({ ...base, loop: 'heartbeat', easing: 'bounce' })).toEqual({ entrance: 'none', loop: 'heartbeat' })
    expect(toMotion({ ...base, stagger_children: 100, easing: 'gentle' })).toEqual({ entrance: 'none', easing: 'gentle', stagger_children: 100 })
    expect(motionState({ entrance: 'swing', easing: 'snappy' }).easing).toBe('snappy')
  })

  it('draws and plays the curves: cubic-bezier ends, spring overshoot, linear() where supported', () => {
    const smooth = cubicBezier(0.22, 1, 0.36, 1)
    expect(smooth(0)).toBe(0)
    expect(smooth(1)).toBe(1)
    expect(smooth(0.5)).toBeGreaterThan(0.8)
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASING_FUNCTIONS.spring(i / 50)))).toBeGreaterThan(1)
    expect(easingPath('linear', 40, 24, 2)).toBe('M0 19.2 L20 12 L40 4.8')
    expect(linearEasing((t) => t, 2)).toBe('linear(0, 0.5, 1)')
    expect(cssEasing('smooth', true)).toBe('cubic-bezier(0.22, 1, 0.36, 1)')
    expect(cssEasing('bounce', true)).toMatch(/^linear\(/)
    expect(cssEasing('spring', false)).toMatch(/^cubic-bezier/)
  })
})

describe('B18 Motion group', () => {
  it('entrance tiles: click and arrow keys choose; easing chips, sliders and Play appear', async () => {
    const { user, last, commands } = setup(heading())
    const group = await openAnimation(user)
    const tiles = within(within(group).getByTestId('entrance-tiles'))
    expect(tiles.getAllByRole('radio')).toHaveLength(17)
    // Roving focus: only the chosen tile is in the Tab order.
    expect(tiles.getByRole('radio', { name: 'None' })).toHaveAttribute('tabindex', '0')
    expect(tiles.getByRole('radio', { name: 'Wipe up' })).toHaveAttribute('tabindex', '-1')
    expect(within(group).queryByTestId('easing-chips')).not.toBeInTheDocument()

    await user.click(tiles.getByRole('radio', { name: 'Wipe up' }))
    expect(last().style).toEqual({ base: { motion: { entrance: 'mask-up', duration: 600, delay: 0 } } })
    expect(tiles.getByRole('radio', { name: 'Wipe up' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(last().style.base?.motion?.entrance).toBe('mask-left')
    expect(tiles.getByRole('radio', { name: 'Wipe sideways' })).toHaveFocus()

    const chips = within(within(group).getByTestId('easing-chips'))
    expect(chips.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Smooth', 'Snappy', 'Gentle', 'Spring', 'Bounce', 'Even'])
    await user.click(chips.getByRole('radio', { name: 'Spring' }))
    expect(last().style.base?.motion).toEqual({ entrance: 'mask-left', duration: 600, delay: 0, easing: 'spring' })
    fireEvent.change(within(group).getByLabelText('Delay'), { target: { value: '300' } })
    expect(last().style.base?.motion).toEqual({ entrance: 'mask-left', duration: 600, delay: 300, easing: 'spring' })

    await user.click(within(group).getByRole('button', { name: 'Play animation' }))
    expect(commands).toContainEqual({ type: 'preview-motion', nodeId: 'e_head01', scope: 'node' })
  })

  it('attention loops: the new ones, and Keep looping tells about the shoppers’ pause button', async () => {
    const { user, last } = setup(button())
    const group = await openAnimation(user)
    const loops = within(within(group).getByTestId('loop-tiles'))
    for (const name of ['Wiggle', 'Heartbeat', 'Breathe', 'Shine', 'Slow spin']) expect(loops.getByRole('radio', { name })).toBeInTheDocument()
    await user.click(loops.getByRole('radio', { name: 'Heartbeat' }))
    expect(last().style).toEqual({ base: { motion: { entrance: 'none', loop: 'heartbeat' } } })
    await user.click(within(group).getByRole('switch', { name: 'Keep looping' }))
    expect(last().style.base?.motion).toEqual({ entrance: 'none', loop: 'heartbeat', loop_forever: true })
    expect(group).toHaveTextContent(/Pause animations/)
  })

  it('hover tiles: the new effects are written; pointing at a tile plays its preview', async () => {
    reducedMotion(false)
    const { user, last } = setup(button())
    const group = await openAnimation(user)
    const hover = within(within(group).getByTestId('hover-tiles'))
    for (const name of ['3D tilt', 'Zoom picture', 'Glare', 'Pop', 'Lift + shadow', 'Shine']) expect(hover.getByRole('radio', { name })).toBeInTheDocument()
    animate.mockClear()
    await user.hover(hover.getByRole('radio', { name: 'Pop' }))
    expect(animate).toHaveBeenCalled()
    await user.click(hover.getByRole('radio', { name: 'Lift + shadow' }))
    expect(last().style).toEqual({ base: { hover: { effect: 'lift-shadow' } } })
  })

  it('previews stay still when the admin asked for reduced motion', async () => {
    reducedMotion(true)
    const { user } = setup(button())
    const group = await openAnimation(user)
    animate.mockClear()
    await user.hover(within(within(group).getByTestId('entrance-tiles')).getByRole('radio', { name: 'Bounce in' }))
    await user.hover(within(within(group).getByTestId('loop-tiles')).getByRole('radio', { name: 'Pulse' }))
    await user.click(within(within(group).getByTestId('entrance-tiles')).getByRole('radio', { name: 'Drop in' }))
    expect(animate).not.toHaveBeenCalled()
  })

  it('a section: Play plays the section in order; Open timeline asks for the timeline', async () => {
    const { user, commands } = setup(section())
    const group = await openAnimation(user)
    fireEvent.change(within(group).getByLabelText('Elements inside, one after another'), { target: { value: '150' } })
    await user.click(within(group).getByRole('button', { name: 'Play animation' }))
    expect(commands).toContainEqual({ type: 'preview-motion', nodeId: 's_sec001', scope: 'section' })
    await user.click(within(group).getByRole('button', { name: 'Open timeline' }))
    expect(commands).toContainEqual({ type: 'open-motion-timeline', sectionId: 's_sec001' })
  })

  it('no timeline button for elements, nor without a handler', () => {
    render(<MotionControl nodeType="section" value={undefined} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Open timeline' })).not.toBeInTheDocument()
  })
})

describe('B18 card hover and animated dividers', () => {
  it('card hover: second picture only where cards have one; none removes the prop', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const grid = { id: 'e_grid01', type: 'product_grid', props: { title: null, subtitle: null, config: {}, items: [] }, style: {}, ...common } as unknown as BuilderNode
    const { unmount } = render(<CardHoverPicker node={grid} onChange={onChange} />)
    const tiles = within(screen.getByTestId('card-hover-tiles'))
    expect(tiles.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['None', 'Lift up', 'Zoom the picture', '3D tilt', 'Glare', 'Show the second picture'])
    await user.click(tiles.getByRole('radio', { name: 'Show the second picture' }))
    expect(onChange.mock.calls.at(-1)?.[0].props).toEqual({ title: null, subtitle: null, config: {}, items: [], card_hover: 'second_image' })
    unmount()

    const card = { id: 'e_card01', type: 'category_card', props: { category_id: null, card_hover: 'glare' }, style: {}, ...common } as unknown as BuilderNode
    render(<CardHoverPicker node={card} onChange={onChange} />)
    expect(screen.queryByRole('radio', { name: 'Show the second picture' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Glare' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'None' }))
    expect(onChange.mock.calls.at(-1)?.[0].props).toEqual({ category_id: null })
  })

  it('section dividers: the two new shapes and Animate (kept when the shape changes)', async () => {
    const { user, last } = setup(section())
    const top = screen.getByTestId('shape-top')
    await user.click(within(top).getByRole('radio', { name: 'Layered waves' }))
    expect((last() as Section).props.shape_top).toEqual({ shape: 'layered_waves', color: 'theme:canvas', height: 48, flip: false })
    await user.click(within(top).getByRole('radio', { name: 'Flow' }))
    expect((last() as Section).props.shape_top).toEqual({ shape: 'layered_waves', color: 'theme:canvas', height: 48, flip: false, animate: 'flow' })
    await user.click(within(top).getByRole('radio', { name: 'Blob' }))
    expect((last() as Section).props.shape_top).toMatchObject({ shape: 'blob', animate: 'flow' })
    await user.click(within(top).getByRole('radio', { name: 'Still' }))
    expect((last() as Section).props.shape_top).toEqual({ shape: 'blob', color: 'theme:canvas', height: 48, flip: false })
  })
})
