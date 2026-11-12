import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { Column, Device, Element, Section } from '@/storefront/builder/types'
import { renderWithQuery } from '@/test/utils'
import { findNode } from '../tree'
import { Inspector, type BuilderNode, type ElementsMetadata, type InspectorCommand } from './index'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const THEME = { colors: { primary: '#f59e0b', accent: '#6f55c2', canvas: '#f3f7fa', surface: '#ffffff', text: '#5f6368', heading: '#3d3d3d' }, palette: [{ name: 'Mango', hex: '#ffb300' }] }

function setup(id: string, device: Device = 'desktop') {
  const content = cloneSample()
  const initial = findNode(content, id)!.node
  const onChange = vi.fn()
  const commands: InspectorCommand[] = []
  function Harness() {
    const [node, setNode] = useState<BuilderNode>(initial)
    const [current, setDevice] = useState<Device>(device)
    return (
      <Inspector
        content={content}
        node={node}
        document={{ id: 'd-1', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={['en']}
        errors={[]}
        device={current}
        theme={THEME}
        onChange={(next, opts) => {
          onChange(next, opts)
          setNode(next)
        }}
        onCommand={(cmd) => {
          commands.push(cmd)
          if (cmd.type === 'set-device') setDevice(cmd.device)
        }}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(<Harness />)
  return { user, onChange, commands, last: () => onChange.mock.calls.at(-1)?.[0] as BuilderNode }
}

async function openStyle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Style' }))
}

describe('Style tab', () => {
  it('shows the groups of the node type and which device is being styled', async () => {
    const { user } = setup('e_heading', 'mobile')
    await openStyle(user)
    expect(screen.getByTestId('style-device-banner')).toHaveTextContent('Styling for Mobile')
    expect(screen.getByTestId('style-group-typography')).toBeInTheDocument()
    expect(screen.getByTestId('style-group-color')).toBeInTheDocument()
    expect(screen.queryByTestId('style-group-background')).toBeNull()
  })

  it('on mobile: shows inherited values, writes only the mobile override, and resets it', async () => {
    const { user, last } = setup('e_heading', 'mobile')
    await openStyle(user)
    const group = within(screen.getByTestId('style-group-typography'))
    // Size is set for mobile (28px), weight comes from desktop.
    expect(group.getByLabelText('Text size')).toHaveValue('28')
    expect(group.getByRole('img', { name: 'Text size: set for Mobile' })).toBeInTheDocument()
    expect(group.getByRole('img', { name: 'Weight: inherited from Desktop' })).toBeInTheDocument()

    await user.selectOptions(group.getByLabelText('Weight'), '600')
    let style = (last() as Element).style
    expect(style.mobile?.typography).toEqual({ size: '28px', align: 'center', weight: 600 })
    expect(style.base?.typography?.weight).toBe(800)

    await user.click(group.getByRole('button', { name: 'Reset Weight to the Desktop value' }))
    style = (last() as Element).style
    expect(style.mobile?.typography).toEqual({ size: '28px', align: 'center' })
    expect(group.getByLabelText('Weight')).toHaveValue('800')
  })

  it('on desktop: edits base; the device switch in the banner changes device', async () => {
    const { user, last, commands } = setup('e_heading')
    await openStyle(user)
    const size = screen.getByLabelText('Text size')
    await user.clear(size)
    await user.type(size, '48')
    expect((last() as Element).style.base?.typography?.size).toBe('48px')
    expect((last() as Element).style.mobile?.typography?.size).toBe('28px')
    await user.click(screen.getByRole('button', { name: 'Style for Tablet' }))
    expect(commands).toContainEqual({ type: 'set-device', device: 'tablet' })
    expect(screen.getByTestId('style-device-banner')).toHaveTextContent('Styling for Tablet')
  })

  it('sets a gradient background on a section (valid, sparse)', async () => {
    const { user, last } = setup('s_hero')
    await openStyle(user)
    const bg = within(screen.getByTestId('style-group-background'))
    await user.click(bg.getByRole('radio', { name: 'Gradient' }))
    expect((last() as Section).style.base?.background).toEqual({
      type: 'gradient',
      gradient: { type: 'linear', angle: 135, stops: [{ color: 'theme:primary', position: 0 }, { color: 'theme:accent', position: 100 }] },
    })
    await user.click(bg.getByRole('button', { name: 'Top to bottom' }))
    expect((last() as Section).style.base?.background?.gradient?.angle).toBe(180)
    expect((last() as Section).style.tablet).toBeUndefined()
  })

  it('section spacing on mobile keeps sides sparse', async () => {
    const { user, last } = setup('s_story', 'mobile')
    await openStyle(user)
    const spacing = within(screen.getByTestId('spacing-padding'))
    // Mixed effective sides (top 32 / right 0 …) start unlinked.
    expect(spacing.getByRole('button', { name: 'Same padding on all sides' })).toHaveAttribute('aria-pressed', 'false')
    const left = spacing.getByLabelText('Padding left')
    await user.clear(left)
    await user.type(left, '8')
    expect((last() as Section).style.mobile?.spacing?.padding).toEqual({ top: '32px', bottom: '32px', left: '8px' })
  })

  it('button colours and hover; invalid input is never written', async () => {
    const { user, onChange } = setup('e_button')
    await openStyle(user)
    await user.click(screen.getByRole('button', { name: /^Button colour: .*Change colour/ }))
    await user.click(screen.getByRole('button', { name: 'Theme colour: Secondary' }))
    expect((onChange.mock.calls.at(-1)![0] as Element).style.base?.background).toEqual({ type: 'color', color: 'theme:accent' })
    // The store palette is offered.
    expect(screen.getByRole('button', { name: 'Store palette: Mango' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    const calls = onChange.mock.calls.length
    const hoverGroup = screen.getByTestId('style-group-hover')
    await user.click(within(hoverGroup).getByRole('button', { name: /^Hover/ }))
    await user.click(within(hoverGroup).getByRole('radio', { name: 'Grow' }))
    expect((onChange.mock.calls.at(-1)![0] as Element).style.base?.effects?.hover?.transform).toBe('grow')
    expect(onChange.mock.calls.length).toBe(calls + 1)
  })

  it('column width per device goes through a command; reset on tablet', async () => {
    const { user, commands } = setup('c_story_text', 'tablet')
    await openStyle(user)
    const input = screen.getByLabelText('Column width on tablet')
    expect(input).toHaveValue('50')
    fireEvent.change(input, { target: { value: '70' } })
    fireEvent.blur(input)
    expect(commands).toContainEqual({ type: 'set-column-width', columnId: 'c_story_text', device: 'tablet', width: 70 })
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    expect(screen.getByText('Use 5 to 100 %.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset Column width to the Desktop value' }))
    expect(commands.at(-1)).toEqual({ type: 'set-column-width', columnId: 'c_story_text', device: 'tablet', width: null })
    void (findNode(cloneSample(), 'c_story_text')!.node as Column)
  })

  it('the page panel opens Site styles', async () => {
    const commands: InspectorCommand[] = []
    renderWithQuery(
      <Inspector content={cloneSample()} node={null} document={{ id: 'd', title: 'Home', path: '/', published: null }} registry={registry} locales={['en']} errors={[]} onChange={() => {}} onCommand={(c) => commands.push(c)} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Site styles' }))
    expect(commands).toEqual([{ type: 'open-site-styles' }])
  })
})
