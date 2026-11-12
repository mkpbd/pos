import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY, formFieldDefaults } from '@/storefront/builder/registry'
import type { Column, DocumentContext, Element, FormField, FormProps, Section } from '@/storefront/builder/types'
import { renderWithQuery } from '@/test/utils'
import { ELEMENT_HINTS, ELEMENT_ICONS } from '../catalogue'
import { oneReplyTo, withKind } from './b8b-model'
import { buildElement, needsSetup } from './create-element'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import { validateNode } from './validate'

/*
 * B8b inspector forms: the form builder (field kinds, choices, number range, longest answer,
 * one reply-to e-mail, consent, an extra e-mail, Bangla per text) and the button's
 * "When clicked" inside popups.
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }

type FormNode = Element & { props: FormProps }

const node = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  const base = buildElement(type, registry, new Set())!
  return { ...base, id: 'e_test01', props: { ...base.props, ...props }, ...extra } as unknown as Element
}

const section = (elements: Element[]): Section =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, columns: [{ id: 'c_sec001', type: 'column', width: { base: 100 }, style: {}, elements } as Column] }) as Section

function setup(initial: BuilderNode, options: { locales?: string[]; context?: 'page' | 'popup' } = {}) {
  const onChange = vi.fn()
  const popup = options.context === 'popup'
  function Harness() {
    const [current, setCurrent] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section([current as Element])] }
    return (
      <Inspector
        content={content}
        node={current}
        document={popup ? { id: 'd-1', kind: 'popup', key: 'popup:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', title: 'Eid offer', path: null, published: null } : { id: 'd-1', kind: 'page', key: 'home', title: 'Home', path: '/', published: null }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={[]}
        onChange={(next, opts) => {
          onChange(next, opts)
          setCurrent(next)
        }}
        onCommand={() => undefined}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as FormNode }
}

const field = (id: string, kind: FormField['kind'], extra: Partial<FormField> = {}): FormField => ({ ...formFieldDefaults(id, kind, `Field ${id}`), ...extra })

describe('form element: catalogue and model', () => {
  it('has an icon and a hint, starts valid (no setup dialog) and is allowed in popups', () => {
    expect(ELEMENT_ICONS.form).toBeDefined()
    expect(ELEMENT_HINTS.form).toMatch(/Form submissions/)
    const form = buildElement('form', registry, new Set(), 'popup')!
    expect(validateNode(form, { context: 'popup' })).toEqual([])
    expect(needsSetup(form)).toBe(false)
    expect(registry.types.find((t) => t.type === 'form')?.allowed_in).toContain('popup')
  })

  it('a kind change keeps what applies: choices for choice kinds, a range for numbers, reply-to for e-mail only', () => {
    const email = field('f_mail', 'email', { reply_to: true, placeholder: 'you@…' })
    const select = withKind(email, 'select')
    expect(select.options).toHaveLength(2)
    expect(select.reply_to).toBe(false)
    expect(select.placeholder).toBe('you@…')
    const radio = withKind({ ...select, options: [...select.options, { id: 'o_3', label: 'Three' }] }, 'radio')
    expect(radio.options).toHaveLength(3)
    expect(radio.placeholder).toBe('')
    const number = withKind({ ...field('f_n', 'text'), max_length: 40 }, 'number')
    expect(number).toMatchObject({ options: [], max_length: null, min: null, max: null })
    expect(withKind({ ...number, min: 1, max: 5 }, 'text')).toMatchObject({ min: null, max: null })
  })

  it('keeps one reply-to e-mail field (the original over a duplicate)', () => {
    const fields = [field('f_a', 'email', { reply_to: true }), field('f_b', 'email', { reply_to: true })]
    expect(oneReplyTo(fields).map((f) => f.reply_to)).toEqual([true, false])
    expect(oneReplyTo(fields, 'f_b').map((f) => f.reply_to)).toEqual([false, true])
  })

  it('client checks: reply-to on a second e-mail, a bad extra e-mail, min above max, too few choices', () => {
    const problems = (props: Partial<FormProps>) => validateNode(node('form', props)).map((p) => [p.path, p.message])
    expect(problems({ fields: [field('f_a', 'email', { reply_to: true }), field('f_b', 'email', { reply_to: true })] })).toContainEqual(['props.fields.1.reply_to', 'Only one e-mail field can be the reply-to address.'])
    expect(problems({ notify_email: 'not-an-address' })).toContainEqual(['props.notify_email', 'Enter an e-mail address such as orders@myshop.com.'])
    expect(problems({ fields: [field('f_n', 'number', { min: 10, max: 2 })] })).toContainEqual(['props.fields.0.max', 'The largest number must not be below the smallest (at most 2 decimals).'])
    expect(problems({ fields: [field('f_s', 'select', { options: [{ id: 'o_1', label: 'Only' }] })] })).toContainEqual(['props.fields.0.options', 'Add at least 2 choices.'])
    expect(problems({ submit_label: '' })).toContainEqual(['props.submit_label', 'Enter the button text.'])
  })
})

describe('form builder', () => {
  it('adds a field, makes it a drop-down with its own choices and requires it; the canvas gets each change', async () => {
    const { user, last } = setup(node('form'))
    const fields = screen.getByTestId('item-list-fields')
    expect(within(fields).getAllByTestId('item-card')).toHaveLength(3)

    await user.click(within(fields).getByRole('button', { name: 'Add field' }))
    const cards = within(fields).getAllByTestId('item-card')
    expect(cards).toHaveLength(4)
    const card = within(cards[3]!).getByRole('group', { name: 'field 4' })
    await user.click(within(card).getByRole('radio', { name: 'Drop-down list' }))
    expect(last().props.fields[3]).toMatchObject({ kind: 'select', label: 'New question', options: [{ label: 'Option 1' }, { label: 'Option 2' }] })

    const question = within(card).getByLabelText('Question')
    await user.clear(question)
    await user.type(question, 'Which size?')
    const choices = within(card).getByTestId('item-list-options')
    await user.click(within(choices).getByRole('button', { name: 'Add choice' }))
    await user.click(within(card).getByRole('switch', { name: 'Must be filled in' }))
    const added = last().props.fields[3]!
    expect(added.label).toBe('Which size?')
    expect(added.required).toBe(true)
    expect(added.options).toHaveLength(3)
    expect(added.options[2]!.label).toBe('New choice')
  })

  it('shows the number range for numbers and moves the reply-to to the other e-mail field', async () => {
    const { user, last } = setup(node('form', { fields: [field('f_a', 'email', { reply_to: true }), field('f_b', 'email'), field('f_n', 'number')] }))
    const fields = screen.getByTestId('item-list-fields')
    const cards = within(fields).getAllByTestId('item-card')
    for (const card of cards) await user.click(within(card).getAllByRole('button', { expanded: false })[0]!)

    const second = within(fields).getByRole('group', { name: 'field 2' })
    await user.click(within(second).getByRole('switch', { name: 'Reply to this address' }))
    expect(last().props.fields.map((f) => f.reply_to)).toEqual([true, true, false].map((_, i) => i === 1))

    const number = within(fields).getByRole('group', { name: 'field 3' })
    await user.type(within(number).getByLabelText('Smallest'), '1')
    await user.type(within(number).getByLabelText('Largest'), '12.5')
    expect(last().props.fields[2]).toMatchObject({ min: 1, max: 12.5 })
    await user.clear(within(number).getByLabelText('Largest'))
    expect(last().props.fields[2]!.max).toBeNull()
  })

  it('consent with a link, an extra e-mail stored only once it is complete, and the layout', async () => {
    const { user, last, onChange } = setup(node('form'))
    await user.click(screen.getByRole('switch', { name: 'Ask the shopper to agree first' }))
    expect(last().props.consent).toEqual({ text: expect.stringMatching(/I agree/), link: { url: '/pages/privacy-policy' } })

    await user.click(screen.getByRole('switch', { name: 'Also e-mail each answer' }))
    const calls = onChange.mock.calls.length
    const email = screen.getByLabelText('E-mail address')
    await user.type(email, 'orders@')
    expect(screen.getByText(/It is saved once it is complete/)).toBeInTheDocument()
    expect(onChange.mock.calls.length).toBe(calls)
    await user.type(email, 'myshop.com')
    expect(last().props.notify_email).toBe('orders@myshop.com')
    await user.click(screen.getByRole('switch', { name: 'Also e-mail each answer' }))
    expect(last().props.notify_email).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'Layout' }))
    await user.click(await screen.findByRole('option', { name: 'Two side by side (wide screens)' }))
    expect(last().props.layout).toBe('two_columns')
  })

  it('has Bangla fields for the form texts and for each field', async () => {
    const { user, last } = setup(node('form'), { locales: ['en', 'bn'] })
    const fields = screen.getByTestId('item-list-fields')
    await user.click(within(within(fields).getAllByTestId('item-card')[0]!).getAllByRole('button', { expanded: false })[0]!)
    const first = within(fields).getByRole('group', { name: 'field 1' })
    await user.click(within(first).getByRole('button', { name: /বাংলা \(Bangla\)/ }))
    await user.type(within(first).getByLabelText('Question in Bangla'), 'আপনার নাম')
    expect(last().translations.bn?.['fields.f_name.label']).toBe('আপনার নাম')
    const toggles = screen.getAllByRole('button', { name: /বাংলা \(Bangla\)/ })
    await user.click(toggles.at(-1)!)
    expect(screen.getByLabelText('Thank-you message in Bangla')).toBeInTheDocument()
  })
})

describe('button inside a popup', () => {
  const button = () => node('button', { label: 'OK', link: { url: '/shop' } })

  it('offers “Close the popup”: stores action dismiss and hides the link; back to a page removes the key', async () => {
    const { user, last } = setup(button(), { context: 'popup' })
    expect(screen.getByLabelText('Opens')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'When clicked' }))
    await user.click(await screen.findByRole('option', { name: 'Close the popup' }))
    expect(last().props).toMatchObject({ action: 'dismiss', link: { url: '/shop' } })
    expect(screen.queryByLabelText('Opens')).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'When clicked' }))
    await user.click(await screen.findByRole('option', { name: 'Open a page' }))
    expect('action' in last().props).toBe(false)
  })

  it('is not offered on pages, and a dismiss outside a popup is flagged', () => {
    setup(button())
    expect(screen.queryByRole('combobox', { name: 'When clicked' })).toBeNull()
    const dismiss = node('button', { label: 'OK', link: { url: '/shop' }, action: 'dismiss' })
    const context: DocumentContext = 'page'
    expect(validateNode(dismiss, { context }).map((p) => p.path)).toContain('props.action')
    expect(validateNode(dismiss, { context: 'popup' })).toEqual([])
  })
})
