import { galleryListOf } from '@/storefront/builder/canvas/file-targets'
import type { FileDropTarget } from '@/storefront/builder/canvas/protocol'
import { B19_LIMITS, B6_LIMITS, B8A_LIMITS } from '@/storefront/builder/validate'
import type { Background, BuilderContent, BuilderNode, Column, DocumentContext, Element, ResponsiveStyle } from '@/storefront/builder/types'
import { buildElement } from './inspector/create-element'
import { newItemId } from './inspector/b6-model'
import type { ElementsMetadata } from './inspector/types'
import { dropTargetOf, setNodePicture } from './media-upload'
import { collectIds, findNode, insertElement, setNode } from './tree'

/*
 * B21 pictures dragged from the computer onto the canvas (contract §4), after the upload: what the
 * page becomes. One call = one undo step. Pure — the editor uploads (use-file-drop.ts) and applies.
 */

type Breakpoint = 'base' | 'tablet' | 'mobile'

/** An uploaded picture: its media id, the alt text suggested for it (from its file name). */
export type DroppedPicture = { mediaId: string; alt: string }

export type DropOutcome = {
  content: BuilderContent
  /** What to select afterwards (the first new picture, the gallery, the replaced image…). */
  select: string | null
  /** Pictures that went onto the page. */
  placed: number
  /** A plain note when some could not be used (a full gallery, a full column, a background takes one). */
  note: string | null
}

/** The most items each gallery-like element holds (the validator's limits). */
const LIST_MAX: Record<string, number> = {
  gallery: B6_LIMITS.galleryImages.max,
  image_carousel: B6_LIMITS.carouselImages.max,
  logo_carousel: B6_LIMITS.logos.max,
  photo_grid: B8A_LIMITS.photoImages.max,
  horizontal_gallery: B19_LIMITS.horizontalGalleryItems.max,
}

const ALT_MAX = 120
const STOP_WORDS = new Set(['a', 'an', 'the', 'at', 'on', 'of', 'in', 'by', 'and', 'from', 'to', 'pm', 'am'])
/** Camera and app file name noise: IMG_2034, DSC0001, PXL_2024…, WhatsApp Image, Screenshot, copy, final, (1). */
const NOISE = /^(img|image|dsc|dscn|dscf|pxl|photo|pic|picture|screenshot|screen shot|whatsapp|wa|copy|final|edited|scaled|large|small|thumb|thumbnail|untitled|new|(img|dsc[nf]?|pxl|mvimg|gopr|dji)\d+|\d+x\d+|[0-9a-f]{12,}|\d+)$/i

/**
 * A plain description from a file name ("red-saree_final (2).JPG" → "Red saree"), or '' when only
 * noise is left. The owner confirms it in the inspector (Check page flags pictures without one).
 */
export function altFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '')
  const words = base
    .replace(/whats\s?app\s+(image|video)|screen\s?shot|camera\s+roll/gi, ' ')
    .replace(/\(\d+\)/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.+,~]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '' && !NOISE.test(word) && !/^\d{4}[-_]?\d{2}[-_]?\d{2}/.test(word) && !/^\d+[a-z]?$/i.test(word))
  const text = words.join(' ').replace(/\s+/g, ' ').trim()
  // Only small words left ("at" from "… 2024-05-12 at 10.30.45"): nothing worth saying.
  if (text === '' || words.every((word) => STOP_WORDS.has(word.toLowerCase()))) return ''
  const sentence = text.toLowerCase() === text || text.toUpperCase() === text ? text.toLowerCase() : text
  const clipped = sentence.length > ALT_MAX ? sentence.slice(0, ALT_MAX).replace(/\s+\S*$/, '') : sentence
  return clipped.charAt(0).toUpperCase() + clipped.slice(1)
}

const unchanged = (content: BuilderContent, note: string): DropOutcome => ({ content, select: null, placed: 0, note })

/** The node's background picture set (replaced where one is set for the device, else for every device). */
function setBackground(content: BuilderContent, node: BuilderNode, mediaId: string, breakpoint: Breakpoint): BuilderContent {
  if (dropTargetOf(node, breakpoint) === 'background') return setNodePicture(content, node.id, mediaId, breakpoint)
  const style: ResponsiveStyle = (node as { style?: ResponsiveStyle }).style ?? {}
  const current: Partial<Background> = style.base?.background ?? {}
  const background: Background = { ...current, type: 'image', image: { media_id: mediaId, position: 'center', size: 'cover', repeat: false } }
  return setNode(content, { ...node, style: { ...style, base: { ...style.base, background } } } as BuilderNode)
}

/** New image elements in the column, before `before` (null = at the end; missing = `index`). */
function insertPictures(
  content: BuilderContent,
  columnId: string,
  before: string | null | undefined,
  index: number | undefined,
  pictures: DroppedPicture[],
  ctx: { registry: ElementsMetadata; context?: DocumentContext },
): { content: BuilderContent; ids: string[] } {
  const column = findNode(content, columnId)
  if (!column || column.kind !== 'column') return { content, ids: [] }
  const elements = (column.node as Column).elements
  const at = before ? elements.findIndex((e) => e.id === before) : -1
  let position = at >= 0 ? at : before === null || index === undefined ? elements.length : Math.min(Math.max(0, index), elements.length)
  let next = content
  const ids: string[] = []
  const existing = collectIds(content)
  for (const picture of pictures) {
    const element = buildElement('image', ctx.registry, existing, ctx.context)
    if (!element) break
    existing.add(element.id)
    const image = { ...element, props: { ...(element.props as Record<string, unknown>), media_id: picture.mediaId, alt: picture.alt } } as Element
    const after = insertElement(next, image, { kind: 'column', columnId, index: position }, new Set(existing))
    if (after === next) break
    next = after
    ids.push(image.id)
    position += 1
  }
  return { content: next, ids }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The page with the uploaded pictures placed at the drop target. */
export function applyDroppedPictures(
  content: BuilderContent,
  target: FileDropTarget,
  pictures: DroppedPicture[],
  ctx: { breakpoint: Breakpoint; registry: ElementsMetadata; context?: DocumentContext },
): DropOutcome {
  if (pictures.length === 0) return unchanged(content, 'No pictures to add.')
  const info = findNode(content, target.node_id)
  if (!info) return unchanged(content, 'That part of the page is gone. Drop the pictures again.')
  const node = info.node
  const [first, ...rest] = pictures as [DroppedPicture, ...DroppedPicture[]]

  if (target.kind === 'replace') {
    if (node.type !== 'image') return unchanged(content, 'Drop the picture on a picture to replace it.')
    const props = node.props as { media_id: string | null; alt: string }
    // A new picture gets the new description (the old one described the old picture).
    let next = setNode(content, { ...node, props: { ...props, media_id: first.mediaId, alt: first.alt || props.alt } } as BuilderNode)
    let note: string | null = null
    let placed = 1
    if (rest.length > 0 && info.parentId) {
      // The other pictures go under it.
      const column = findNode(next, info.parentId)?.node as Column | undefined
      const own = column?.elements.findIndex((e) => e.id === node.id) ?? -1
      const added = insertPictures(next, info.parentId, column?.elements[own + 1]?.id ?? null, own + 1, rest, ctx)
      next = added.content
      placed += added.ids.length
      if (added.ids.length < rest.length) note = `${plural(rest.length - added.ids.length, 'picture', 'pictures')} didn’t fit in this column.`
    }
    return { content: next, select: node.id, placed, note }
  }

  if (target.kind === 'background') {
    if (node.type !== 'section' && node.type !== 'inner_row' && node.type !== 'column') return unchanged(content, 'Drop the picture on a section to use it as the background.')
    const next = setBackground(content, node, first.mediaId, ctx.breakpoint)
    const note = rest.length > 0 ? `A background takes one picture. ${rest.length === 1 ? 'The other one is' : `The other ${rest.length} are`} in your media library.` : null
    return { content: next, select: node.id, placed: 1, note }
  }

  if (target.into === 'items') {
    const props = ((node as { props?: unknown }).props ?? {}) as Record<string, unknown>
    const list = galleryListOf(node.type, props)
    if (!list) return unchanged(content, 'This part can’t hold pictures.')
    const items = [...((props[list] as { id: string; media_id: string | null; alt: string }[] | undefined) ?? [])]
    const max = LIST_MAX[node.type] ?? 12
    let placed = 0
    for (const picture of pictures) {
      // Empty places first (a new horizontal gallery starts with two), then new items.
      const empty = items.findIndex((item) => !item.media_id)
      if (empty >= 0) {
        items[empty] = { ...items[empty]!, media_id: picture.mediaId, alt: items[empty]!.alt || picture.alt }
      } else {
        if (items.length >= max) break
        items.push(newListItem(node.type, newItemId(items), picture))
      }
      placed += 1
    }
    if (placed === 0) return unchanged(content, `This ${GALLERY_NOUN[node.type] ?? 'gallery'} is full (${max} pictures at most).`)
    const next = setNode(content, { ...node, props: { ...props, [list]: items } } as BuilderNode)
    const note = placed < pictures.length ? `${plural(pictures.length - placed, 'picture', 'pictures')} didn’t fit: this ${GALLERY_NOUN[node.type] ?? 'gallery'} holds ${max} at most.` : null
    return { content: next, select: node.id, placed, note }
  }

  // New picture elements in a column.
  if (info.kind !== 'column') return unchanged(content, 'Drop the pictures between the parts of a section.')
  const added = insertPictures(content, node.id, target.before, target.index, pictures, ctx)
  if (added.ids.length === 0) return unchanged(content, 'There’s no room for more parts here. Drop the pictures somewhere else.')
  const note = added.ids.length < pictures.length ? `${plural(pictures.length - added.ids.length, 'picture', 'pictures')} didn’t fit here.` : null
  return { content: added.content, select: added.ids[0] ?? null, placed: added.ids.length, note }
}

const GALLERY_NOUN: Record<string, string> = { gallery: 'gallery', image_carousel: 'carousel', logo_carousel: 'logo carousel', photo_grid: 'photo grid', horizontal_gallery: 'gallery' }

/** A new item of a gallery-like list, shaped like the inspector's (B6 / B8a / B19 forms). */
function newListItem(type: string, id: string, picture: DroppedPicture): Record<string, unknown> & { id: string; media_id: string; alt: string } {
  const base = { id, media_id: picture.mediaId, alt: picture.alt }
  switch (type) {
    case 'gallery':
      return { ...base, caption: '' }
    case 'image_carousel':
    case 'horizontal_gallery':
      return { ...base, caption: '', link: null }
    default:
      // logo_carousel, photo_grid
      return { ...base, link: null }
  }
}

/** What a drop target is called on the canvas ("Replace picture", "Add 3 pictures here" …). */
export function dropLabel(target: Pick<FileDropTarget, 'kind' | 'into'>, count?: number): string {
  const many = count !== undefined && count > 1
  if (target.kind === 'replace') return many ? `Replace picture (+${count - 1} below)` : 'Replace picture'
  if (target.kind === 'background') return 'Use as background'
  if (target.into === 'items') return many ? `Add ${count} pictures to the gallery` : 'Add to the gallery'
  return many ? `Add ${count} pictures here` : 'Add a picture here'
}
