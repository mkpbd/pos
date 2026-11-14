import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import type { BuilderContent, Element, Section } from '@/storefront/builder/types'
import { checkDocument } from './check'
import { clearClipboardMemory, CLIPBOARD_MARKER, copyNode, copyStyle, parseClip, pasteClip, pasteStyle, readNodesClip, readStyleClip, rememberClip, serializeClip, stylesCompatible, type PasteTarget } from './clipboard'
import { makeGlobal } from './global-sections'
import { createEditorStore } from './store'
import { detail } from './test-helpers'
import { collectIds, findNode } from './tree'

const ORG = 'o-1'
const registry = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }

function target(content: BuilderContent, patch: Partial<PasteTarget> = {}): PasteTarget {
  return { content, selection: null, context: 'page', org: ORG, registry, canCustomHtml: true, single: false, noun: 'page', ...patch }
}

const empty = (): BuilderContent => ({ schema_version: 1, sections: [] })

beforeEach(() => {
  window.localStorage.clear()
  clearClipboardMemory()
})

describe('copy & paste', () => {
  it('pastes a copied section into another document with new ids, translations and references kept', () => {
    const source = cloneSample()
    const clip = copyNode(source, 's_story', ORG)!
    expect(clip.kind).toBe('section')
    const result = pasteClip(clip, target(empty()))
    if (!result.ok) throw new Error(result.message)
    const pasted = result.content.sections[0] as Section
    expect(pasted.id).toBe(result.id)
    expect(pasted.id).not.toBe('s_story')
    const original = source.sections[1] as Section
    const ids = [...collectIds(result.content)]
    expect(ids.some((id) => collectIds(source).has(id))).toBe(false)
    expect(pasted.columns[0]!.elements.map((e) => e.type)).toEqual(original.columns[0]!.elements.map((e) => e.type))
    expect(pasted.columns[0]!.elements[0]!.translations).toEqual(original.columns[0]!.elements[0]!.translations)
    // The image keeps its media reference.
    const imageOf = (s: Section) => s.columns.flatMap((c) => c.elements).find((e) => e.type === 'image') as Element & { props: { media_id: string } }
    expect(imageOf(pasted).props.media_id).toBe(imageOf(original).props.media_id)
    expect(checkDocument(result.content)).toEqual([])
  })

  it('pastes an element after the selected element, and an inner row never inside an inner row', () => {
    const content = cloneSample()
    const clip = copyNode(content, 'e_button', ORG)!
    const result = pasteClip(clip, target(content, { selection: 'e_heading' }))
    if (!result.ok) throw new Error(result.message)
    const info = findNode(result.content, result.id)!
    expect(info.parentId).toBe(findNode(content, 'e_heading')!.parentId)
    expect(info.index).toBe(1)

    const row = copyNode(content, 'e_row', ORG)!
    const innerElement = (findNode(content, 'e_row')!.node as unknown as { columns: { elements: Element[] }[] }).columns[0]!.elements[0]!.id
    const nested = pasteClip(row, target(content, { selection: innerElement }))
    if (!nested.ok) throw new Error(nested.message)
    expect(findNode(nested.content, nested.id)!.kind).toBe('element')
    expect(findNode(nested.content, nested.id)!.inner).toBe(false)
    expect(checkDocument(nested.content)).toEqual([])
  })

  it('refuses what the target cannot hold, naming the elements; another store; custom HTML without permission', () => {
    const content = cloneSample()
    const products = copyNode(content, 's_products', ORG)!
    const refused = pasteClip(products, target(empty(), { context: 'header', noun: 'header' }))
    expect(refused).toEqual({ ok: false, message: expect.stringMatching(/^This header can’t hold Product grid/) })

    const other = pasteClip({ ...products, org: 'o-2' }, target(empty()))
    expect(other.ok).toBe(false)
    expect(!other.ok && other.message).toMatch(/another store/)

    const html = copyNode(content, 'e_text', ORG)!
    const custom = { ...html, node: { ...html.node, type: 'custom_html', props: { html: '<p>x</p>' } } as Element }
    const denied = pasteClip(custom, target(empty(), { canCustomHtml: false }))
    expect(!denied.ok && denied.message).toMatch(/custom HTML/)
  })

  it('in a global section only elements are pasted, into its one section', () => {
    const global: BuilderContent = { schema_version: 1, sections: [structuredClone(cloneSample().sections[1]!)] }
    const section = copyNode(cloneSample(), 's_hero', ORG)!
    const refused = pasteClip(section, target(global, { single: true, noun: 'global section' }))
    expect(!refused.ok && refused.message).toMatch(/just one section/)
    const element = copyNode(cloneSample(), 'e_button', ORG)!
    const pasted = pasteClip(element, target(global, { single: true }))
    if (!pasted.ok) throw new Error(pasted.message)
    expect(pasted.content.sections).toHaveLength(1)
    expect(findNode(pasted.content, pasted.id)!.sectionId).toBe(global.sections[0]!.id)
  })

  it('a copied global section reference pastes only where its global fits', () => {
    const content = makeGlobal(cloneSample(), 's_story', '01a1c9d9-0000-7000-8000-0000000000aa')
    const clip = copyNode(content, 's_story', ORG, () => 'page')!
    expect(clip.global_context).toBe('page')
    const ok = pasteClip(clip, target(empty(), { context: 'cms' }))
    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.content.sections[0]).toMatchObject({ type: 'global_section', ref: '01a1c9d9-0000-7000-8000-0000000000aa' })
    const header = pasteClip(clip, target(empty(), { context: 'header', noun: 'header' }))
    expect(!header.ok && header.message).toMatch(/made for pages/)
    const popup = pasteClip(clip, target(empty(), { context: 'popup', noun: 'popup' }))
    expect(popup.ok).toBe(false)
  })

  it('a popup’s close button links again outside a popup', () => {
    const content = cloneSample()
    const clip = copyNode(content, 'e_button', ORG)!
    ;(clip.node as Element & { props: Record<string, unknown> }).props.action = 'dismiss'
    const result = pasteClip(clip, target(empty()))
    if (!result.ok) throw new Error(result.message)
    expect((findNode(result.content, result.id)!.node as Element & { props: Record<string, unknown> }).props.action).toBeUndefined()
  })

  it('keeps the clipboard per store in localStorage, in memory when storage is blocked, and reads system clipboard text', () => {
    const clip = copyNode(cloneSample(), 'e_heading', ORG)!
    rememberClip(clip)
    expect(window.localStorage.getItem('pos.builder.clipboard.o-1')).toContain(CLIPBOARD_MARKER)
    expect(readNodesClip(ORG)?.node.id).toBe('e_heading')
    expect(readNodesClip('o-2')).toBeNull()

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    rememberClip(copyNode(cloneSample(), 'e_button', ORG)!)
    expect(readNodesClip(ORG)?.node.id).toBe('e_button')
    setItem.mockRestore()
    getItem.mockRestore()

    expect(parseClip(serializeClip(clip))?.kind).toBe('element')
    expect(parseClip('just some text')).toBeNull()
    expect(parseClip(JSON.stringify({ marker: CLIPBOARD_MARKER, v: 2, org: ORG, kind: 'element', node: { id: 'x' } }))).toBeNull()
  })
})

describe('copy style / paste style', () => {
  it('copies every device’s style and motion to a compatible node; content stays; one undo step', () => {
    const content = cloneSample()
    const heading = findNode(content, 'e_heading')!.node as Element
    const styled = { base: { color: '#112233', motion: { entrance: 'fade' as const } }, mobile: { typography: { size: '20px' } } }
    content.sections[1]!.columns[0]!.elements[0] = { ...heading, style: styled }
    const clip = copyStyle(content, 'e_heading', ORG)!
    rememberClip(clip)
    expect(readStyleClip(ORG)?.node_type).toBe('heading')
    // A heading's style fits a text, not a button.
    expect(stylesCompatible('heading', 'text')).toBe(true)
    expect(stylesCompatible('heading', 'button')).toBe(false)
    expect(pasteStyle(content, 'e_button', clip)).toBe(content)

    const store = createEditorStore(detail(content))
    expect(store.getState().apply((c) => pasteStyle(c, 'e_text', clip))).toBe(true)
    const text = findNode(store.getState().content, 'e_text')!.node as Element
    expect(text.style).toEqual(styled)
    expect(text.props).toEqual((findNode(content, 'e_text')!.node as Element).props)
    store.getState().undo()
    expect((findNode(store.getState().content, 'e_text')!.node as Element).style).toEqual((findNode(content, 'e_text')!.node as Element).style)
  })
})
