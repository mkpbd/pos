import { PAGE_DROP_ID, type FileDropHover, type FileDropTarget, type Rect } from './protocol'
import { imageTargetOf, type TreeNode } from './text-fields'

/*
 * B21: where picture files dragged from the computer would land on the canvas, worked out from the
 * drawn page (so it follows the device order and what is shown):
 * - over an image element → replace its picture;
 * - over a gallery-like element (gallery, image / logo carousel, photo grid, a horizontal gallery
 *   of pictures) → add the pictures as its items;
 * - near the top or bottom edge of another element, in the gap between elements or in an empty
 *   column → add picture elements there (a line shows the place);
 * - over the middle of another element, or a section's / inner row's own area → the background: of
 *   the nearest node that already has a background picture (as in B10), else of the nearest inner
 *   row or section. Holding Shift always picks the background.
 * Global sections never take pictures (they are edited in their own document).
 */

/** The item list of a gallery-like element (`props[list]` holds `{id, media_id, alt}` items). */
export const GALLERY_LISTS: Readonly<Record<string, string>> = {
  gallery: 'images',
  image_carousel: 'images',
  logo_carousel: 'logos',
  photo_grid: 'images',
  horizontal_gallery: 'items',
}

/** The list dropped pictures are added to, or null (not gallery-like; a horizontal gallery of products). */
export function galleryListOf(type: string, props: unknown): string | null {
  const list = GALLERY_LISTS[type]
  if (!list) return null
  if (type === 'horizontal_gallery' && typeof props === 'object' && props !== null && (props as { source?: unknown }).source === 'products') return null
  return list
}

const ROWS = new Set(['section', 'inner_row'])

type Hit = { el: HTMLElement; node: TreeNode }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

/** The node elements from `start` outwards (innermost first), each known to the drawn tree. */
function chainFrom(start: Element, nodes: ReadonlyMap<string, TreeNode>): Hit[] {
  const chain: Hit[] = []
  let el = start.closest<HTMLElement>('[data-b]')
  while (el) {
    const node = el.dataset.b ? nodes.get(el.dataset.b) : undefined
    if (node && !node.global) chain.push({ el, node })
    el = el.parentElement?.closest<HTMLElement>('[data-b]') ?? null
  }
  return chain
}

/** The column's drawn elements in order (direct children in the tree). */
function columnChildren(column: HTMLElement, nodes: ReadonlyMap<string, TreeNode>): Hit[] {
  return Array.from(column.querySelectorAll<HTMLElement>('[data-b]'))
    .filter((el) => el.parentElement?.closest('[data-b]') === column)
    .map((el) => ({ el, node: nodes.get(el.dataset.b ?? '') }))
    .filter((hit): hit is Hit => hit.node !== undefined)
}

/** New pictures in the column at position `index` (0 = before its first element). */
function insertAt(column: Hit, children: Hit[], index: number): FileDropHover {
  const box = rectOf(column.el)
  const before = children[index]?.node.id ?? null
  if (children.length === 0) return { node_id: column.node.id, kind: 'insert', into: 'column', index: 0, before: null, rect: box }
  const y = index < children.length ? rectOf(children[index]!.el).y : (() => {
    const last = rectOf(children[children.length - 1]!.el)
    return last.y + last.h
  })()
  return { node_id: column.node.id, kind: 'insert', into: 'column', index, before, rect: { x: box.x, y, w: box.w, h: 0 }, line: true }
}

/**
 * The background a picture would go to from this point outwards: the nearest column, inner row or
 * section that already has a background picture (as in B10), else the nearest inner row or section.
 */
function backgroundOf(chain: Hit[]): FileDropHover | null {
  const hit = chain.find(({ node }) => imageTargetOf(node) === 'background') ?? chain.find(({ node }) => ROWS.has(node.type))
  return hit ? { node_id: hit.node.id, kind: 'background', rect: rectOf(hit.el) } : null
}

/** B22a: an empty section or inner row (no background picture yet): its column under the pointer, else its first. */
function emptyRowColumn(row: Hit, point: { x: number }, nodes: ReadonlyMap<string, TreeNode>): Hit | null {
  if (!ROWS.has(row.node.type) || imageTargetOf(row.node) === 'background') return null
  const columns = columnChildren(row.el, nodes).filter((hit) => hit.node.type === 'column')
  if (columns.length === 0 || columns.some((column) => columnChildren(column.el, nodes).length > 0)) return null
  return (
    columns.find((column) => {
      const r = rectOf(column.el)
      return point.x >= r.x && point.x <= r.x + r.w
    }) ?? columns[0]!
  )
}

export function fileTargetAt(start: EventTarget | null, point: { x: number; y: number }, nodes: ReadonlyMap<string, TreeNode>, options: { background?: boolean } = {}): FileDropHover | null {
  if (!(start instanceof Element) || start.closest('[data-b-global]')) return null
  // B22a: the empty canvas — a new section.
  const empty = start.closest('[data-b-empty-page]')
  if (empty) return { node_id: PAGE_DROP_ID, kind: 'insert', into: 'page', index: 0, before: null, rect: rectOf(empty) }
  const chain = chainFrom(start, nodes)
  if (chain.length === 0) return null
  if (options.background) return backgroundOf(chain)
  const emptyColumn = emptyRowColumn(chain[0]!, point, nodes)
  if (emptyColumn) return insertAt(emptyColumn, [], 0)

  // A picture or a gallery-like element under the pointer (inside the nearest column).
  for (const { el, node } of chain) {
    if (node.type === 'column') break
    if (node.type === 'image') return { node_id: node.id, kind: 'replace', rect: rectOf(el) }
    if (galleryListOf(node.type, node.props)) return { node_id: node.id, kind: 'insert', into: 'items', rect: rectOf(el) }
  }

  const [first] = chain as [Hit, ...Hit[]]
  if (first.node.type === 'column') {
    const children = columnChildren(first.el, nodes)
    const index = children.findIndex((child) => {
      const r = rectOf(child.el)
      return r.y + r.h / 2 > point.y
    })
    return insertAt(first, children, index < 0 ? children.length : index)
  }
  if (first.node.type !== 'section') {
    // An element (or inner row): its top and bottom edges add pictures beside it; its middle is the background.
    const column = chain.find((hit) => hit.node.type === 'column')
    const r = rectOf(first.el)
    const edge = clamp(r.h * 0.25, 8, 40)
    if (column && (point.y <= r.y + edge || point.y >= r.y + r.h - edge)) {
      const children = columnChildren(column.el, nodes)
      const own = children.findIndex((child) => child.el === first.el || child.el.contains(first.el))
      if (own >= 0) return insertAt(column, children, point.y <= r.y + edge ? own : own + 1)
    }
  }
  return backgroundOf(chain)
}

/** The drop target of a hover (without what is drawn). */
export function dropTargetOf(hover: FileDropHover): FileDropTarget {
  const target: FileDropTarget = { node_id: hover.node_id, kind: hover.kind }
  if (hover.into) target.into = hover.into
  if (hover.index !== undefined) target.index = hover.index
  if (hover.before !== undefined) target.before = hover.before
  return target
}
