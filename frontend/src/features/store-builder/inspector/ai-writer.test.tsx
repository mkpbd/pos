import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { authKeys } from '@/features/auth/api'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Element, Section } from '@/storefront/builder/types'
import { makeCurrentUser } from '@/test/fixtures'
import { createTestQueryClient, fail, mockApi, ok } from '@/test/utils'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata, type InspectorChangeOptions } from './index'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
const heading = { id: 'e_head01', type: 'heading', props: { text: 'Hello', level: 2, link: null }, ...common } as unknown as Element
const button = { id: 'e_btn001', type: 'button', props: { label: 'Shop', link: { url: '/shop' }, variant: 'primary', size: 'md' }, ...common } as unknown as Element
const section = { id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [heading, button] }] } as unknown as Section
const spacer = { id: 'e_spc001', type: 'spacer', props: {}, ...common } as unknown as Element

function setup(initial: BuilderNode, options: { locales?: string[]; aiEnabled?: boolean } = {}) {
  const onChange = vi.fn<(next: BuilderNode, opts?: InspectorChangeOptions) => void>()
  function Harness() {
    const [node, setNode] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [node.type === 'section' ? (node as Section) : { ...section, columns: [{ ...section.columns[0]!, elements: [node as Element] }] }] }
    return (
      <Inspector
        content={content}
        node={node}
        document={{ id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={[]}
        onChange={(next, opts) => {
          onChange(next, opts)
          setNode(next)
        }}
        onCommand={vi.fn()}
      />
    )
  }
  const client = createTestQueryClient()
  client.setQueryData(authKeys.me, makeCurrentUser({ ai_enabled: options.aiEnabled ?? true }))
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { user, onChange }
}

const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

describe('AI writer', () => {
  it('writes an element’s text: asks, shows new next to current, applies as one change', async () => {
    const requests: Record<string, unknown>[] = []
    mockApi({
      'POST /storefront/builder/ai/write': (init) => {
        requests.push(body(init))
        return ok({ source: 'ai', mode: 'element', language: 'en', target: 'base', texts: { text: 'Fresh mangoes, picked this morning' }, elements: {} })
      },
    })
    const { user, onChange } = setup(heading)
    await user.click(screen.getByRole('button', { name: 'Write with AI' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    await user.type(within(dialog).getByLabelText('What should it say?'), 'Mango season')
    await user.click(within(dialog).getByRole('radio', { name: 'Festive' }))
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    expect(await within(dialog).findByTestId('ai-writer-review')).toBeInTheDocument()
    expect(requests[0]).toEqual({ mode: 'element', document_id: 'd-1', node_id: 'e_head01', type: 'heading', instruction: 'Mango season', language: 'en', tone: 'festive', current: { text: 'Hello' } })
    expect(within(dialog).getByTestId('ai-writer-new')).toHaveTextContent('Fresh mangoes, picked this morning')
    expect(within(dialog).getByText('Hello')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Use this text' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [next, opts] = onChange.mock.calls[0]!
    expect((next as unknown as { props: { text: string } }).props.text).toBe('Fresh mangoes, picked this morning')
    // No coalesce key: its own undo step.
    expect(opts).toBeUndefined()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/1 text updated\. Undo/)).toBeInTheDocument()
  })

  it('writes a whole section from per-element answers; unticked texts are left alone', async () => {
    const requests: Record<string, unknown>[] = []
    mockApi({
      'POST /storefront/builder/ai/write': (init) => {
        requests.push(body(init))
        return ok({ source: 'ai', mode: 'section', language: 'en', target: 'base', texts: {}, elements: { e_head01: { text: 'Eid sale' }, e_btn001: { label: 'See the offers' } } })
      },
    })
    const { user, onChange } = setup(section)
    await user.click(screen.getByRole('button', { name: 'Write this section' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write this section with AI' })
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    await within(dialog).findByTestId('ai-writer-review')
    expect(requests[0]).toMatchObject({ mode: 'section', node_id: 's_sec001', current: { e_head01: { text: 'Hello' }, e_btn001: { label: 'Shop' } } })
    expect(requests[0]).not.toHaveProperty('type')
    expect(within(dialog).getByText('Heading · Text')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Button · Label' }))
    await user.click(within(dialog).getByRole('button', { name: 'Use this text' }))
    const next = onChange.mock.calls[0]![0] as Section
    const [h, b] = next.columns[0]!.elements as unknown as { props: Record<string, unknown> }[]
    expect(h!.props.text).toBe('Eid sale')
    expect(b!.props.label).toBe('Shop')
  })

  it('translates to Bangla into translations.bn; Bangla writing goes there too', async () => {
    const requests: Record<string, unknown>[] = []
    mockApi({
      'POST /storefront/builder/ai/write': (init) => {
        requests.push(body(init))
        return ok({ source: 'ai', mode: 'translate', language: 'bn', target: 'translations.bn', texts: { text: 'হ্যালো' }, elements: {} })
      },
    })
    const { user, onChange } = setup(heading, { locales: ['en', 'bn'] })
    await user.click(screen.getByRole('button', { name: 'Translate to Bangla' }))
    const dialog = await screen.findByRole('dialog', { name: 'Translate to Bangla' })
    expect(await within(dialog).findByTestId('ai-writer-new')).toHaveTextContent('হ্যালো')
    expect(requests[0]).toMatchObject({ mode: 'translate', language: 'bn', current: { text: 'Hello' } })
    await user.click(within(dialog).getByRole('button', { name: 'Use this text' }))
    const next = onChange.mock.calls[0]![0] as Element
    expect(next.translations).toEqual({ bn: { text: 'হ্যালো' } })
    expect((next as unknown as { props: { text: string } }).props.text).toBe('Hello')
  })

  it('explains why the AI could not write (budget), and offers to try again', async () => {
    mockApi({ 'POST /storefront/builder/ai/write': fail(422, 'AI_UNAVAILABLE', 'AI unavailable', { reason: 'budget_exceeded' }) })
    const { user, onChange } = setup(heading)
    await user.click(screen.getByRole('button', { name: 'Write with AI' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(/this month’s AI allowance/)
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('AI switched off: the reason instead of the buttons', () => {
    setup(heading, { aiEnabled: false })
    expect(screen.getByTestId('ai-writer-off')).toHaveTextContent(/Write with AI is off.*Organization → AI/)
    expect(screen.queryByRole('button', { name: 'Write with AI' })).not.toBeInTheDocument()
  })

  it('a server "disabled" answer offers no retry; a draft still saving says so', async () => {
    let reply = fail(422, 'AI_UNAVAILABLE', 'off', { reason: 'disabled' })
    mockApi({ 'POST /storefront/builder/ai/write': () => reply })
    const { user } = setup(heading)
    await user.click(screen.getByRole('button', { name: 'Write with AI' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('AI writing is off')
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    reply = fail(422, 'NODE_NOT_FOUND', 'not found')
    await user.click(screen.getByRole('button', { name: 'Write with AI' }))
    const again = await screen.findByRole('dialog')
    await user.click(within(again).getByRole('button', { name: 'Write' }))
    expect(await within(again).findByRole('alert')).toHaveTextContent(/still saving/)
  })

  it('is not offered on elements without text; Translate needs English text first', async () => {
    setup(spacer)
    expect(screen.queryByTestId('ai-writer-bar')).not.toBeInTheDocument()
  })

  it('Translate is disabled while there is nothing to translate', async () => {
    const empty = { ...heading, props: { text: '', level: 2, link: null } } as unknown as Element
    setup(empty, { locales: ['en', 'bn'] })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate to Bangla' })).toBeDisabled())
  })
})
