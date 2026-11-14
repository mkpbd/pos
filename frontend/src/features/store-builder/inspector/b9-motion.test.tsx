import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Element, ResponsiveStyle, Section } from '@/storefront/builder/types'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorCommand } from './index'
import { motionPlays, motionState, toHover, toMotion } from './b9-motion'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const common = { visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const button = (style: ResponsiveStyle = {}) => ({ id: 'e_btn001', type: 'button', props: { label: 'Order now', link: { url: '/shop' }, variant: 'primary', size: 'md' }, style, ...common }) as unknown as Element
const section = (style: ResponsiveStyle = {}) =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, style, ...common, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [] }] }) as unknown as Section

function setup(initial: BuilderNode, device: 'desktop' | 'mobile' = 'desktop') {
  mockApi({ 'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }) })
  const onChange = vi.fn()
  const commands: InspectorCommand[] = []
  function Harness() {
    const [node, setNode] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [node.type === 'section' ? (node as Section) : { ...section(), columns: [{ ...section().columns[0]!, elements: [node as Element] }] }] }
    return (
      <Inspector
        content={content}
        node={node}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={['en']}
        errors={[]}
        device={device}
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

describe('B9 motion model', () => {
  it('writes a sparse group: defaults left out, nothing moving = no group', () => {
    expect(toMotion(motionState(undefined))).toBeUndefined()
    expect(toMotion({ ...motionState(undefined), entrance: 'flip-up' })).toEqual({ entrance: 'flip-up', duration: 600, delay: 0 })
    expect(toMotion({ ...motionState(undefined), entrance: 'blur-in', repeat: 'every_time', loop: 'glow' })).toEqual({ entrance: 'blur-in', duration: 600, delay: 0, repeat: 'every_time', loop: 'glow' })
    // A loop alone keeps the group with entrance none; loop_forever only with a loop.
    expect(toMotion({ ...motionState(undefined), loop: 'pulse', loop_forever: true })).toEqual({ entrance: 'none', loop: 'pulse', loop_forever: true })
    expect(toMotion({ ...motionState(undefined), loop_forever: true })).toBeUndefined()
    expect(toMotion({ ...motionState(undefined), stagger_children: 150, repeat: 'every_time' })).toEqual({ entrance: 'none', repeat: 'every_time', stagger_children: 150 })
    expect(motionPlays({ entrance: 'none', loop: 'shake' })).toBe(true)
    expect(motionPlays(undefined)).toBe(false)
    expect(toHover('none', 300)).toBeUndefined()
    expect(toHover('lift', 250)).toEqual({ effect: 'lift' })
    expect(toHover('tilt', 400)).toEqual({ effect: 'tilt', duration: 400 })
  })
})

describe('B9 Animation group', () => {
  it('a button: new entrances, every time, an attention loop and Preview animation (desktop value on any device)', async () => {
    const { user, last, commands } = setup(button(), 'mobile')
    const group = await openAnimation(user)
    const preview = within(group).getByRole('button', { name: 'Preview animation' })
    expect(preview).toBeDisabled()
    // Elements have no "one after another"; sections have no loop.
    expect(within(group).queryByLabelText('Elements inside, one after another')).not.toBeInTheDocument()

    await user.selectOptions(within(group).getByLabelText('Entrance'), 'bounce-in')
    expect(last().style).toEqual({ base: { motion: { entrance: 'bounce-in', duration: 600, delay: 0 } } })
    await user.click(within(group).getByRole('radio', { name: 'Every time' }))
    expect(last().style.base?.motion).toEqual({ entrance: 'bounce-in', duration: 600, delay: 0, repeat: 'every_time' })

    await user.selectOptions(within(group).getByLabelText('Attention loop'), 'pulse')
    expect(last().style.base?.motion?.loop).toBe('pulse')
    await user.click(within(group).getByRole('switch', { name: 'Keep repeating' }))
    expect(last().style.base?.motion?.loop_forever).toBe(true)

    await user.selectOptions(within(group).getByLabelText('Entrance'), 'none')
    expect(last().style.base?.motion).toEqual({ entrance: 'none', loop: 'pulse', loop_forever: true })
    await user.click(preview)
    expect(commands).toContainEqual({ type: 'preview-motion', nodeId: 'e_btn001' })

    await user.selectOptions(within(group).getByLabelText('Attention loop'), 'none')
    expect(last().style).toEqual({})
  })

  it('hover effect with its speed (base only)', async () => {
    const { user, last } = setup(button())
    const group = await openAnimation(user)
    const hover = within(group).getByTestId('hover-effect-control')
    await user.selectOptions(within(hover).getByLabelText('Hover effect'), 'tilt')
    expect(last().style).toEqual({ base: { hover: { effect: 'tilt' } } })
    fireEvent.change(within(hover).getByLabelText('Hover speed'), { target: { value: '400' } })
    expect(last().style.base?.hover).toEqual({ effect: 'tilt', duration: 400 })
    await user.selectOptions(within(hover).getByLabelText('Hover effect'), 'none')
    expect(last().style).toEqual({})
  })

  it('a section: elements inside one after another, no loop or hover; parallax needs a background picture', async () => {
    const { user, last } = setup(section())
    const group = await openAnimation(user)
    expect(within(group).queryByLabelText('Attention loop')).not.toBeInTheDocument()
    expect(within(group).queryByTestId('hover-effect-control')).not.toBeInTheDocument()
    fireEvent.change(within(group).getByLabelText('Elements inside, one after another'), { target: { value: '150' } })
    expect(last().style).toEqual({ base: { motion: { entrance: 'none', stagger_children: 150 } } })
    expect(within(group).getByRole('button', { name: 'Preview animation' })).toBeEnabled()

    const parallax = within(group).getByTestId('parallax-control')
    expect(within(parallax).getByRole('radio', { name: 'Slow' })).toBeDisabled()
    expect(parallax).toHaveTextContent(/Choose a background picture/)
  })

  it('a section with a background picture: parallax is written into the desktop background and kept when the picture changes', async () => {
    const image = { media_id: UUID, position: 'center', size: 'cover', repeat: false } as const
    const { user, last } = setup(section({ base: { background: { type: 'image', image } } }))
    const group = await openAnimation(user)
    await user.click(within(within(group).getByTestId('parallax-control')).getByRole('radio', { name: 'Slow' }))
    expect(last().style).toEqual({ base: { background: { type: 'image', image, parallax: 'slow' } } })
    await user.click(within(within(group).getByTestId('parallax-control')).getByRole('radio', { name: 'Normal' }))
    expect(last().style).toEqual({ base: { background: { type: 'image', image } } })
  })
})
