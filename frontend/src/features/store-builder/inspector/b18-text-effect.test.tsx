import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { Element, Section } from '@/storefront/builder/types'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { Inspector, type BuilderContent, type BuilderNode, type ElementsMetadata } from './index'
import {
  cardHoverOptions,
  moveWord,
  removeWord,
  revealLettersBlocked,
  textEffectBanglaFields,
  textEffectState,
  toTextEffect,
  withoutWordTranslations,
  wordProblems,
} from './b18-text-effect'
import { translationLimit, validateNode } from './validate'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const common = { visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, style: {} }
const heading = (props: Record<string, unknown> = {}, translations: Record<string, Record<string, string>> = {}) =>
  ({ id: 'e_head01', type: 'heading', props: { text: 'Fresh', level: 2, link: null, ...props }, ...common, translations }) as unknown as Element
const section = (element: Element) =>
  ({ id: 's_sec001', type: 'section', props: { layout: 'boxed', anchor: null }, ...common, translations: {}, columns: [{ id: 'c_col001', type: 'column', width: { base: 100 }, style: {}, elements: [element] }] }) as unknown as Section

function setup(initial: Element, locales = ['en', 'bn']) {
  mockApi({ 'GET /media': ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }) })
  const onChange = vi.fn()
  function Harness() {
    const [node, setNode] = useState<BuilderNode>(initial)
    const content: BuilderContent = { schema_version: 1, sections: [section(node as Element)] }
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
        onCommand={() => {}}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, last: () => onChange.mock.calls.at(-1)?.[0] as Element & { props: Record<string, unknown>; translations: Record<string, Record<string, string>> } }
}

describe('B18 text effect model', () => {
  it('writes a sparse prop: none removes it, defaults left out, words only for rotating words', () => {
    const state = textEffectState(undefined)
    expect(state).toEqual({ type: 'none', words: [], speed: 'normal', color_role: 'primary', cycles: 'default' })
    expect(toTextEffect(state)).toBeUndefined()
    expect(toTextEffect({ ...state, type: 'typewriter' })).toEqual({ type: 'typewriter' })
    expect(toTextEffect({ ...state, type: 'highlight_draw', color_role: 'accent', speed: 'fast', words: ['x'] })).toEqual({ type: 'highlight_draw', speed: 'fast', color_role: 'accent' })
    // Colour roles only where the effect draws one; cycles only where it repeats (null = until paused).
    expect(toTextEffect({ ...state, type: 'reveal_words', color_role: 'accent', cycles: 3 })).toEqual({ type: 'reveal_words' })
    expect(toTextEffect({ ...state, type: 'rotate_words', words: ['mango', 'lychee'], cycles: null })).toEqual({ type: 'rotate_words', words: ['mango', 'lychee'], cycles: null })
    expect(textEffectState({ type: 'rotate_words', words: ['a'], cycles: null }).cycles).toBeNull()
    expect(textEffectState({ type: 'typewriter', cycles: 2 }).cycles).toBe(2)
  })

  it('keeps the words’ Bangla in step when a word is removed or moved', () => {
    const tr = { bn: { text: 'তাজা', 'text_effect.words.0': 'আম', 'text_effect.words.1': 'লিচু', 'text_effect.words.2': 'খেজুর' } }
    expect(removeWord(['mango', 'lychee', 'dates'], tr, 0)).toEqual({ words: ['lychee', 'dates'], translations: { bn: { text: 'তাজা', 'text_effect.words.0': 'লিচু', 'text_effect.words.1': 'খেজুর' } } })
    expect(moveWord(['mango', 'lychee', 'dates'], tr, 2, -1)).toEqual({ words: ['mango', 'dates', 'lychee'], translations: { bn: { text: 'তাজা', 'text_effect.words.0': 'আম', 'text_effect.words.1': 'খেজুর', 'text_effect.words.2': 'লিচু' } } })
    expect(moveWord(['mango'], tr, 0, -1).words).toEqual(['mango'])
    expect(withoutWordTranslations(tr)).toEqual({ bn: { text: 'তাজা' } })
    expect(withoutWordTranslations({ bn: { 'text_effect.words.0': 'আম' } })).toEqual({})
    expect(textEffectBanglaFields({ type: 'rotate_words', words: ['mango'] })).toEqual([{ name: 'text_effect.words.0', label: 'Rotating word 1', base: 'mango', max: 40 }])
    expect(textEffectBanglaFields({ type: 'typewriter' })).toEqual([])
  })

  it('length rules: words 1–40, letter by letter ≤ 80 (Bangla too), second picture only on product cards', () => {
    expect(wordProblems(['ok', '  ', 'x'.repeat(41)])).toEqual({ 1: 'Enter a word or remove it.', 2: 'At most 40 characters.' })
    expect(revealLettersBlocked('Short', null)).toBeNull()
    expect(revealLettersBlocked('x'.repeat(81), null)).toMatch(/81/)
    expect(revealLettersBlocked('Short', 'ক'.repeat(90))).toMatch(/Bangla/)
    expect(cardHoverOptions('product_listing')).toContain('second_image')
    expect(cardHoverOptions('shop_the_look')).not.toContain('second_image')
  })

  it('validation: the server’s rules with messages, and the words’ translations up to 40', () => {
    expect(validateNode(heading({ text_effect: { type: 'rotate_words', words: ['ok', ''] } }))).toContainEqual({ path: 'props.text_effect.words.1', message: 'Enter a word or remove it.' })
    expect(validateNode(heading({ text: 'x'.repeat(90), text_effect: { type: 'reveal_letters' } }))[0]?.path).toBe('props.text_effect.type')
    expect(validateNode(heading({ text_effect: { type: 'reveal_letters' } }, { bn: { text: 'ক'.repeat(81) } }))).toContainEqual(expect.objectContaining({ path: 'translations.bn.text' }))
    expect(validateNode(heading({ text_effect: { type: 'typewriter', cycles: 2 } }))).toEqual([])
    expect(translationLimit('heading', 'text_effect.words.3')).toBe(40)
    expect(translationLimit('cta', 'text_effect.words.0')).toBe(40)
    expect(translationLimit('image', 'text_effect.words.0')).toBeUndefined()
  })
})

describe('B18 Text effect form', () => {
  it('a heading: rotating words with Bangla in the Bangla section, speed and cycles; switching away drops the words', async () => {
    const { user, last } = setup(heading())
    const form = screen.getByTestId('text-effect-form')
    const tiles = within(within(form).getByTestId('text-effect-tiles'))
    expect(tiles.getAllByRole('radio')).toHaveLength(8)
    await user.click(tiles.getByRole('radio', { name: 'Rotating words' }))
    expect(last().props.text_effect).toEqual({ type: 'rotate_words', words: [''] })
    expect(within(form).getByText('Enter a word or remove it.')).toBeInTheDocument()

    await user.type(within(form).getByLabelText('Rotating word 1'), 'mango')
    await user.click(within(form).getByRole('button', { name: 'Add a word' }))
    await user.type(within(form).getByLabelText('Rotating word 2'), 'lychee')
    expect(last().props.text_effect).toEqual({ type: 'rotate_words', words: ['mango', 'lychee'] })

    // The Bangla words sit in the element's Bangla section.
    await user.click(screen.getByRole('button', { name: /বাংলা \(Bangla\)/ }))
    await user.type(screen.getByLabelText('Rotating word 1 in Bangla'), 'আম')
    await user.type(screen.getByLabelText('Rotating word 2 in Bangla'), 'লিচু')
    expect(last().translations.bn).toEqual({ 'text_effect.words.0': 'আম', 'text_effect.words.1': 'লিচু' })
    await user.click(within(form).getByRole('button', { name: 'Remove word 1' }))
    expect(last().props.text_effect).toEqual({ type: 'rotate_words', words: ['lychee'] })
    expect(last().translations.bn).toEqual({ 'text_effect.words.0': 'লিচু' })
    expect(within(form).getByRole('button', { name: 'Remove word 1' })).toBeDisabled()

    await user.click(within(form).getByRole('radio', { name: 'Fast' }))
    await user.selectOptions(within(form).getByLabelText('Change the words'), '3')
    expect(last().props.text_effect).toEqual({ type: 'rotate_words', words: ['lychee'], speed: 'fast', cycles: 3 })
    await user.selectOptions(within(form).getByLabelText('Change the words'), 'forever')
    expect(last().props.text_effect).toMatchObject({ cycles: null })
    expect(form).toHaveTextContent(/Pause animations/)

    await user.click(tiles.getByRole('radio', { name: 'Highlight' }))
    expect(last().props.text_effect).toEqual({ type: 'highlight_draw', speed: 'fast' })
    expect(last().translations).toEqual({})
    await user.click(within(form).getByRole('radio', { name: 'Accent colour' }))
    expect(last().props.text_effect).toEqual({ type: 'highlight_draw', speed: 'fast', color_role: 'accent' })
    await user.click(tiles.getByRole('radio', { name: 'None' }))
    expect(last().props).not.toHaveProperty('text_effect')
  })

  it('letter by letter can’t be chosen for a long heading (the reason is shown)', () => {
    setup(heading({ text: 'A very long heading that goes on and on about the fresh fruit and vegetables we sell' }))
    const form = screen.getByTestId('text-effect-form')
    expect(within(form).getByRole('radio', { name: 'Letter by letter' })).toBeDisabled()
    expect(form).toHaveTextContent(/Letter by letter is for short texts/)
  })

  it('a call to action and a text element have the form too', () => {
    setup({ id: 'e_cta001', type: 'cta', props: { title: 'Fresh', text: '', primary: { label: 'Shop', link: { url: '/shop' } }, secondary: null, align: 'center' }, ...common, translations: {} } as unknown as Element, ['en'])
    expect(screen.getByTestId('text-effect-form')).toBeInTheDocument()
  })
})
