import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample, elementNode } from '@/storefront/builder/test-payload'
import type { BuilderContent, Column, Section } from '@/storefront/builder/types'
import { PAGE_DROP_ID } from '@/storefront/builder/canvas/protocol'
import { altFromFileName, applyDroppedPictures, dropLabel, type DroppedPicture } from './file-drop'
import { validateNode } from './inspector/validate'
import type { ElementsMetadata } from './inspector/types'
import { findNode } from './tree'

/* B21: what dropped pictures do to the page (after their upload). */

const registry = { types: ELEMENT_REGISTRY, limits: {}, enums: {} } as unknown as ElementsMetadata
const ctx = { breakpoint: 'base' as const, registry }
const pics = (...names: string[]): DroppedPicture[] => names.map((name, i) => ({ mediaId: `m-${i + 1}`, alt: altFromFileName(name) }))
const column = (content: BuilderContent, id: string) => findNode(content, id)!.node as Column
const props = (content: BuilderContent, id: string) => (findNode(content, id)!.node as { props: Record<string, unknown> }).props

function withGallery(type: string, extra: Record<string, unknown>): BuilderContent {
  const content = cloneSample()
  const story = content.sections.find((s) => s.id === 's_story') as Section
  ;(story.columns[1] as Column).elements.push(elementNode(type, 'e_gal', extra))
  return content
}

describe('B21 alt text from a file name', () => {
  it('keeps the words, drops camera and app noise', () => {
    expect(altFromFileName('red-saree_final (2).JPG')).toBe('Red saree')
    expect(altFromFileName('IMG_20240512_103045.jpg')).toBe('')
    expect(altFromFileName('WhatsApp Image 2024-05-12 at 10.30.45.jpeg')).toBe('')
    expect(altFromFileName('fresh_mango-box.webp')).toBe('Fresh mango box')
    expect(altFromFileName('DSC0001 Hilsa Fish.png')).toBe('Hilsa Fish')
    expect(altFromFileName('summerSaleBanner.png')).toBe('Summer Sale Banner')
    expect(altFromFileName('নকশি-কাঁথা.jpg')).toBe('নকশি কাঁথা')
    expect(altFromFileName(`${'long '.repeat(40)}.png`).length).toBeLessThanOrEqual(120)
  })
})

describe('B21 pictures placed on the page', () => {
  it('replace: the picture and its description change; more pictures go under it', () => {
    const content = cloneSample()
    const one = applyDroppedPictures(content, { node_id: 'e_image', kind: 'replace' }, pics('basket.png'), ctx)
    expect(props(one.content, 'e_image')).toMatchObject({ media_id: 'm-1', alt: 'Basket' })
    expect(one).toMatchObject({ select: 'e_image', placed: 1, note: null })
    expect(column(one.content, 'c_story_media').elements).toHaveLength(1)

    const three = applyDroppedPictures(content, { node_id: 'e_image', kind: 'replace' }, pics('a-cat.png', 'b-dog.png', 'c-cow.png'), ctx)
    const elements = column(three.content, 'c_story_media').elements
    expect(elements.map((e) => e.type)).toEqual(['image', 'image', 'image'])
    expect(elements.map((e) => (e.props as { media_id: string }).media_id)).toEqual(['m-1', 'm-2', 'm-3'])
    expect(elements.slice(1).map((e) => (e.props as { alt: string }).alt)).toEqual(['B dog', 'C cow'])
    expect(three.placed).toBe(3)
    // The original is untouched (pure).
    expect(props(content, 'e_image').media_id).not.toBe('m-1')
    // An empty name keeps the old description.
    expect(props(applyDroppedPictures(content, { node_id: 'e_image', kind: 'replace' }, pics('IMG_1234.jpg'), ctx).content, 'e_image').alt).toBe(props(content, 'e_image').alt)
  })

  it('background: set for every device on a section without one; one picture only', () => {
    const content = cloneSample()
    const out = applyDroppedPictures(content, { node_id: 's_story', kind: 'background' }, pics('wall.png', 'more.png'), ctx)
    const style = (findNode(out.content, 's_story')!.node as Section).style
    expect(style.base?.background).toMatchObject({ type: 'image', image: { media_id: 'm-1', position: 'center', size: 'cover', repeat: false } })
    expect(out.placed).toBe(1)
    expect(out.note).toMatch(/A background takes one picture/)
    expect(applyDroppedPictures(content, { node_id: 'e_heading', kind: 'background' }, pics('x.png'), ctx).placed).toBe(0)
  })

  it('insert: new image elements before the element named, else at the index, in drop order', () => {
    const content = cloneSample()
    const out = applyDroppedPictures(content, { node_id: 'c_story_text', kind: 'insert', into: 'column', index: 1, before: 'e_text' }, pics('one.png', 'two.png'), ctx)
    const types = column(out.content, 'c_story_text').elements.map((e) => (e.type === 'image' ? `image:${(e.props as { alt: string }).alt}` : e.id))
    expect(types).toEqual(['e_heading', 'image:One', 'image:Two', 'e_text', 'e_button'])
    expect(out.select).toBe(column(out.content, 'c_story_text').elements[1]!.id)
    // At the end.
    const end = applyDroppedPictures(content, { node_id: 'c_story_text', kind: 'insert', into: 'column', index: 3, before: null }, pics('z.png'), ctx)
    expect(column(end.content, 'c_story_text').elements.at(-1)!.type).toBe('image')
    // An empty column (inner row).
    const empty = applyDroppedPictures(content, { node_id: 'c_feat_c', kind: 'insert', into: 'column', index: 0, before: null }, pics('q.png'), ctx)
    expect(column(empty.content, 'c_feat_c').elements.map((e) => e.type)).toEqual(['image'])
    // Gone meanwhile.
    expect(applyDroppedPictures(content, { node_id: 'c_gone', kind: 'insert', into: 'column' }, pics('q.png'), ctx)).toMatchObject({ placed: 0, content })
  })

  it('a gallery-like element takes the pictures as items, up to its limit; empty places fill first', () => {
    const gallery = withGallery('gallery', { images: [{ id: 'i_one', media_id: 'm-0', alt: 'Old', caption: '' }] })
    const out = applyDroppedPictures(gallery, { node_id: 'e_gal', kind: 'insert', into: 'items' }, pics('apple.png', 'b.png'), ctx)
    const images = props(out.content, 'e_gal').images as { id: string; media_id: string; alt: string; caption: string }[]
    expect(images.map((i) => i.media_id)).toEqual(['m-0', 'm-1', 'm-2'])
    expect(images[1]).toMatchObject({ alt: 'Apple', caption: '' })
    expect(new Set(images.map((i) => i.id)).size).toBe(3)
    expect(out.select).toBe('e_gal')

    const logos = withGallery('logo_carousel', { logos: Array.from({ length: 23 }, (_, i) => ({ id: `l_${i}`, media_id: `x-${i}`, alt: '', link: null })) })
    const full = applyDroppedPictures(logos, { node_id: 'e_gal', kind: 'insert', into: 'items' }, pics('a.png', 'b.png', 'c.png'), ctx)
    expect((props(full.content, 'e_gal').logos as unknown[]).length).toBe(24)
    expect(full).toMatchObject({ placed: 1, note: expect.stringMatching(/2 pictures didn’t fit/) })

    const strip = withGallery('horizontal_gallery', { source: 'images', items: [{ id: 'i_1', media_id: null, alt: '', caption: '', link: null }, { id: 'i_2', media_id: null, alt: '', caption: '', link: null }], product_ids: [] })
    const filled = applyDroppedPictures(strip, { node_id: 'e_gal', kind: 'insert', into: 'items' }, pics('x.png', 'y.png', 'z.png'), ctx)
    expect((props(filled.content, 'e_gal').items as { id: string; media_id: string; link: null }[]).map((i) => [i.id.startsWith('i_'), i.media_id, i.link])).toEqual([
      [true, 'm-1', null],
      [true, 'm-2', null],
      [true, 'm-3', null],
    ])
    const products = withGallery('horizontal_gallery', { source: 'products', items: [], product_ids: ['a', 'b'] })
    expect(applyDroppedPictures(products, { node_id: 'e_gal', kind: 'insert', into: 'items' }, pics('x.png'), ctx).placed).toBe(0)
  })

  it('labels say what happens', () => {
    expect(dropLabel({ kind: 'replace' })).toBe('Replace picture')
    expect(dropLabel({ kind: 'background' }, 1)).toBe('Use as background')
    expect(dropLabel({ kind: 'insert', into: 'column' }, 3)).toBe('Add 3 pictures here')
    expect(dropLabel({ kind: 'insert', into: 'items' })).toBe('Add to the gallery')
  })
})

describe('B22a pictures dropped on an empty page, section or column', () => {
  const page = { node_id: PAGE_DROP_ID, kind: 'insert' as const, into: 'page' as const, index: 0 }
  const empty = (): BuilderContent => ({ schema_version: 1, sections: [] })
  /** Media ids as the server gives them (the validator wants UUIDs). */
  const uuids = (...names: string[]): DroppedPicture[] => pics(...names).map((p, i) => ({ ...p, mediaId: `0b6f2e3c-1a2b-4c3d-8e9f-01234567890${i}` }))

  it('the empty canvas: one picture becomes a new section with an image', () => {
    const out = applyDroppedPictures(empty(), page, uuids('fresh-mango.png'), ctx)
    expect(out.content.sections).toHaveLength(1)
    const elements = (out.content.sections[0]!.columns[0] as Column).elements
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ type: 'image', props: { media_id: '0b6f2e3c-1a2b-4c3d-8e9f-012345678900', alt: 'Fresh mango' } })
    expect(out).toMatchObject({ select: elements[0]!.id, placed: 1, note: null })
    expect(validateNode(elements[0]!)).toEqual([])
  })

  it('the empty canvas: several pictures become a new section with one valid gallery', () => {
    const out = applyDroppedPictures(empty(), page, uuids('a-cat.png', 'b-dog.png', 'c-cow.png'), ctx)
    const elements = (out.content.sections[0]!.columns[0] as Column).elements
    expect(elements.map((e) => e.type)).toEqual(['gallery'])
    const images = (elements[0]!.props as { images: { id: string; media_id: string; alt: string; caption: string }[] }).images
    expect(images.map((i) => [i.media_id.slice(-1), i.alt, i.caption])).toEqual([
      ['0', 'A cat', ''],
      ['1', 'B dog', ''],
      ['2', 'C cow', ''],
    ])
    expect(new Set(images.map((i) => i.id)).size).toBe(3)
    expect(out).toMatchObject({ select: elements[0]!.id, placed: 3 })
    expect(validateNode(elements[0]!)).toEqual([])
  })

  it('no gallery where galleries aren’t allowed (a header): one image each', () => {
    const out = applyDroppedPictures(empty(), page, pics('a.png', 'b.png'), { ...ctx, context: 'header' })
    expect((out.content.sections[0]!.columns[0] as Column).elements.map((e) => e.type)).toEqual(['image', 'image'])
  })

  it('an empty column: several pictures make a gallery, one an image; a filled column keeps one image each', () => {
    const content = cloneSample()
    const story = content.sections.find((s) => s.id === 's_story') as Section
    const emptyId = (story.columns[1] as Column).id
    ;(story.columns[1] as Column).elements = []
    const target = { node_id: emptyId, kind: 'insert' as const, into: 'column' as const, index: 0, before: null }
    expect(column(applyDroppedPictures(content, target, pics('a.png', 'b.png'), ctx).content, emptyId).elements.map((e) => e.type)).toEqual(['gallery'])
    expect(column(applyDroppedPictures(content, target, pics('a.png'), ctx).content, emptyId).elements.map((e) => e.type)).toEqual(['image'])
    const filledId = (story.columns[0] as Column).id
    const before = column(content, filledId).elements.length
    const filled = applyDroppedPictures(content, { node_id: filledId, kind: 'insert', into: 'column', index: 0, before: null }, pics('a.png', 'b.png'), ctx)
    expect(column(filled.content, filledId).elements).toHaveLength(before + 2)
    expect(column(filled.content, filledId).elements.slice(-2).map((e) => e.type)).toEqual(['image', 'image'])
  })
})
