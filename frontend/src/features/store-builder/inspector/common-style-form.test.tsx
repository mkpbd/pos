import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderDocument, Column, Device, Element } from '@/storefront/builder/types'
import { renderWithQuery } from '@/test/utils'
import { findNode, setNode } from '../tree'
import { Inspector, type BuilderNode, type ElementsMetadata, type InspectorCommand } from './index'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }

/** The inspector with several items selected; `calls` records each onChangeMany (= one undo step each). */
function setup(ids: string[], device: Device = 'desktop', prepare?: (content: BuilderDocument) => BuilderDocument) {
  const start = prepare ? prepare(cloneSample()) : cloneSample()
  const calls: BuilderNode[][] = []
  const commands: InspectorCommand[] = []
  let latest = start
  function Harness() {
    const [content, setContent] = useState(start)
    const [current, setDevice] = useState<Device>(device)
    const nodes = ids.map((id) => findNode(content, id)!.node)
    return (
      <Inspector
        content={content}
        node={nodes[nodes.length - 1]!}
        nodes={nodes}
        document={{ id: 'd-1', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={['en']}
        errors={[]}
        device={current}
        onChange={() => {
          throw new Error('single onChange must not be used')
        }}
        onChangeMany={(next) => {
          calls.push(next)
          latest = next.reduce((acc, n) => setNode(acc, n), latest)
          setContent(latest)
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
  return { user, calls, commands, content: () => latest }
}

const styleOf = (content: BuilderDocument, id: string) => (findNode(content, id)!.node as Element).style

describe('Common style (B12)', () => {
  it('shows "N selected", only shared parts, and "Mixed" where the items differ', async () => {
    setup(['e_heading', 'e_text'])
    expect(screen.getByRole('heading', { name: '2 selected' })).toBeInTheDocument()
    const form = screen.getByTestId('common-style')
    expect(within(form).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Text', 'Colour', 'Spacing', 'See-through'])
    // Text size differs (40 / 18 px), the colours too.
    expect(within(screen.getByTestId('common-group-typography')).getAllByRole('img', { name: /the selected items differ/ }).length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('common-group-color')).getByRole('img', { name: 'Text colour: the selected items differ' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Content' })).not.toBeInTheDocument()
  })

  it('a change goes to every item for the device being styled, as one change', async () => {
    const { user, calls, content } = setup(['e_heading', 'e_text'], 'mobile')
    fireEvent.change(screen.getByRole('textbox', { name: 'Text size' }), { target: { value: '22' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.map((n) => n.id)).toEqual(['e_heading', 'e_text'])
    expect(styleOf(content(), 'e_heading').mobile?.typography?.size).toBe('22px')
    expect(styleOf(content(), 'e_text').mobile?.typography?.size).toBe('22px')
    expect(styleOf(content(), 'e_heading').base?.typography?.size).toBe('40px')
    // Reset for all (this device).
    await user.click(screen.getByRole('button', { name: 'Reset Text size on mobile for all selected items' }))
    expect(styleOf(content(), 'e_text').mobile?.typography?.size).toBeUndefined()
    expect(calls).toHaveLength(2)
  })

  it('items with nothing in common say so', () => {
    setup(['e_heading', 'e_image'], 'desktop')
    // Only see-through is shared.
    expect(within(screen.getByTestId('common-style')).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['See-through'])
  })
})

describe('Line up (B12)', () => {
  it('aligns text and places blocks of siblings, each one change', async () => {
    const { user, calls, content } = setup(['e_heading', 'e_text', 'e_button'], 'tablet')
    await user.click(within(screen.getByTestId('align-text')).getByRole('button', { name: 'Align text: Centre' }))
    expect(calls).toHaveLength(1)
    expect(['e_heading', 'e_text', 'e_button'].map((id) => styleOf(content(), id).tablet?.typography?.align)).toEqual(['center', 'center', 'center'])
    expect(within(screen.getByTestId('align-text')).getByRole('button', { name: 'Align text: Centre' })).toHaveAttribute('aria-pressed', 'true')
    // Only the button is a block with a width of its own.
    const blocks = screen.getByTestId('align-blocks')
    expect(within(blocks).getByText('Place blocks (1 of 3)')).toBeInTheDocument()
    await user.click(within(blocks).getByRole('button', { name: /Right$/ }))
    expect(styleOf(content(), 'e_button').tablet?.spacing?.margin).toEqual({ left: 'auto', right: '0px' })
  })

  it('equal spacing asks for a value and checks it', async () => {
    const { user, calls, content } = setup(['e_heading', 'e_text', 'e_button'])
    const field = screen.getByRole('textbox', { name: 'Equal space between them' })
    await user.clear(field)
    await user.type(field, '999')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByText('Use 0 to 400 px.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    await user.clear(field)
    await user.type(field, '40{Enter}')
    expect(calls).toHaveLength(1)
    expect(styleOf(content(), 'e_heading').base?.spacing?.margin).toEqual({ bottom: '40px' })
    expect(styleOf(content(), 'e_button').base?.spacing?.margin?.top).toBe('0px')
  })

  it('same width for columns shares the row; not siblings → the reason', async () => {
    const { user, content } = setup(['c_feat_a', 'c_feat_b'], 'tablet')
    expect(screen.queryByTestId('equal-spacing')).not.toBeInTheDocument()
    expect(screen.getByText('Each column gets 50 % of the row.')).toBeInTheDocument()
    // Already equal on tablets (50 / 50): nothing to change. Desktop has 33.33 each too.
    await user.click(screen.getByRole('button', { name: 'Same width' }))
    expect((findNode(content(), 'c_feat_a')!.node as Column).width.tablet).toBe(50)
  })

  it('items from different places cannot be lined up', () => {
    setup(['e_heading', 'e_feat_a'])
    expect(within(screen.getByTestId('line-up')).getByText(/Pick items that sit side by side/)).toBeInTheDocument()
  })

  it('same width is off, with the reason, when it can’t apply', () => {
    setup(['s_story', 's_features'])
    expect(screen.getByRole('button', { name: 'Same width' })).toBeDisabled()
    expect(screen.getByText(/Same width works for columns/)).toBeInTheDocument()
  })
})
