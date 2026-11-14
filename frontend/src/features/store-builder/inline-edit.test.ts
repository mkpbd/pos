import { elementMeta } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Element } from '@/storefront/builder/types'
import { applyTextEdit, cleanPlainText, firstInlineField, inlineFields, safeLinkUrl, sanitizeInlineHtml } from './inline-edit'
import { createEditorStore } from './store'
import { detail } from './test-helpers'
import { findNode } from './tree'

const props = (content: BuilderContent, id: string) => (findNode(content, id)!.node as Element).props as Record<string, unknown>
const translations = (content: BuilderContent, id: string) => (findNode(content, id)!.node as Element).translations

function withElement(type: string, id: string, extra: Record<string, unknown> = {}): BuilderContent {
  const content = cloneSample()
  const element = { id, type, props: { ...structuredClone(elementMeta(type)!.props), ...extra }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} }
  ;(content.sections[1]!.columns![0]!.elements as unknown[]).push(element)
  return content
}

describe('inline text edits (B10)', () => {
  it('writes a heading in English to its props and in Bangla to translations.bn', () => {
    const content = cloneSample()
    const en = applyTextEdit(content, { id: 'e_heading', field: 'text', value: '  Fresh from the farm ', locale: 'en' })
    expect(en.ok && en.changed).toBe(true)
    if (!en.ok) return
    expect(props(en.content, 'e_heading').text).toBe('Fresh from the farm')

    const bn = applyTextEdit(en.content, { id: 'e_heading', field: 'text', value: 'খামার থেকে তাজা', locale: 'bn' })
    if (!bn.ok) throw new Error(bn.message)
    expect(translations(bn.content, 'e_heading')?.bn?.text).toBe('খামার থেকে তাজা')
    expect(props(bn.content, 'e_heading').text).toBe('Fresh from the farm')

    // An empty Bangla text removes the translation (the English one shows again).
    const cleared = applyTextEdit(bn.content, { id: 'e_heading', field: 'text', value: '', locale: 'bn' })
    if (!cleared.ok) throw new Error(cleared.message)
    expect(translations(cleared.content, 'e_heading')?.bn).toBeUndefined()
  })

  it('an unchanged value changes nothing', () => {
    const content = cloneSample()
    const result = applyTextEdit(content, { id: 'e_heading', field: 'text', value: 'Made fresh every morning', locale: 'en' })
    expect(result).toEqual({ ok: true, content, changed: false, note: undefined })
  })

  it('cuts plain text to its limit with a note; refuses unknown fields, locales and nodes', () => {
    const content = cloneSample()
    const long = applyTextEdit(content, { id: 'e_button', field: 'label', value: 'x'.repeat(80), locale: 'en' })
    if (!long.ok) throw new Error(long.message)
    expect(props(long.content, 'e_button').label).toHaveLength(60)
    expect(long.note).toMatch(/Cut to 60 characters/)

    expect(applyTextEdit(content, { id: 'e_button', field: 'variant', value: 'ghost', locale: 'en' })).toMatchObject({ ok: false, message: expect.stringMatching(/can’t be changed on the page/) })
    expect(applyTextEdit(content, { id: 'e_button', field: 'label', value: 'Go', locale: 'fr' })).toMatchObject({ ok: false })
    expect(applyTextEdit(content, { id: 'e_button', field: 'label', value: 'Go', locale: 'bn' }, { bangla: false })).toMatchObject({ ok: false, message: expect.stringMatching(/Bangla isn’t switched on/) })
    expect(applyTextEdit(content, { id: 'nope', field: 'text', value: 'x', locale: 'en' })).toMatchObject({ ok: false })
    expect(applyTextEdit(content, { id: 's_story', field: 'text', value: 'x', locale: 'en' })).toMatchObject({ ok: false })
    expect(applyTextEdit(content, { id: 'e_button', field: 'label', value: 42, locale: 'en' })).toMatchObject({ ok: false })
  })

  it('a value the element’s own rules refuse is not applied', () => {
    const content = cloneSample()
    const result = applyTextEdit(content, { id: 'e_heading', field: 'text', value: '   ', locale: 'en' })
    expect(result.ok).toBe(false)
  })

  it('cleans HTML to the server’s tags: b → strong, i → em, no scripts, styles or unsafe links', () => {
    const content = cloneSample()
    const html = '<div>Hello <b>big</b> <i>world</i><script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="/shop" onclick="x()" style="color:red">shop</a><span style="color:red">!</span></div>'
    const result = applyTextEdit(content, { id: 'e_text', field: 'html', value: html, locale: 'en' })
    if (!result.ok) throw new Error(result.message)
    expect(props(result.content, 'e_text').html).toBe('<p>Hello <strong>big</strong> <em>world</em> <a>bad</a> <a href="/shop">shop</a>!</p>')
    expect(sanitizeInlineHtml('<ul><li>One</li><li>Two</li></ul><ol><li>A</li></ol>')).toBe('<ul><li>One</li><li>Two</li></ul><ol><li>A</li></ol>')
    expect(sanitizeInlineHtml('<p><a href="https://x.test" target="_top">x</a></p>')).toBe('<p><a href="https://x.test">x</a></p>')
  })

  it('edits nested fields by their translation key (a call to action’s main button)', () => {
    const content = withElement('cta', 'e_cta')
    expect(inlineFields(content, 'e_cta').map((f) => f.key)).toEqual(expect.arrayContaining(['title', 'text', 'primary.label']))
    const result = applyTextEdit(content, { id: 'e_cta', field: 'primary.label', value: 'Order now', locale: 'en' })
    if (!result.ok) throw new Error(result.message)
    expect((props(result.content, 'e_cta').primary as { label: string }).label).toBe('Order now')
  })

  it('finds the first editable field of an element; sections and columns have none', () => {
    const content = cloneSample()
    expect(firstInlineField(content, 'e_heading')).toBe('text')
    expect(firstInlineField(content, 'e_text')).toBe('html')
    expect(firstInlineField(content, 's_story')).toBeNull()
    expect(firstInlineField(content, 'c_story_text')).toBeNull()
    expect(firstInlineField(content, 'e_spacer')).toBeNull()
  })

  it('applies as one undo step in the editor store', () => {
    const store = createEditorStore(detail())
    const before = store.getState().content
    const result = applyTextEdit(before, { id: 'e_heading', field: 'text', value: 'New', locale: 'en' })
    if (!result.ok) throw new Error(result.message)
    store.getState().apply(() => result.content, { select: 'e_heading' })
    expect(store.getState().history.past).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().content).toBe(before)
  })

  it('plain text: single-line fields keep one line; links are checked', () => {
    expect(cleanPlainText('One\r\ntwo', false)).toBe('One two')
    expect(cleanPlainText('One\n\n\n\ntwo\u0007', true)).toBe('One\n\ntwo')
    expect(safeLinkUrl('/shop')).toBe('/shop')
    expect(safeLinkUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeLinkUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com')
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(safeLinkUrl('//evil.test')).toBeNull()
    expect(safeLinkUrl('shop page')).toBeNull()
    expect(safeLinkUrl('')).toBeNull()
  })
})
