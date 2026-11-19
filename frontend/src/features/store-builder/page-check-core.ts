import { elementMeta } from '@/storefront/builder/registry'
import type { ResponsiveStyle } from '@/storefront/builder/types'
import type { PageCheckFix, PageCheckIssue, PageCheckTab } from './page-check'

/*
 * The shared, runtime part of the page check: small readers, the issue collector, where a node
 * sits (its column share, a drawn global section) and the pictures an element shows. Used by the
 * B10 checks (./page-check.ts) and the B15 speed check (./page-check-speed.ts).
 */

export type Obj = Record<string, unknown>
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type StyledNode = { id: string; type: string; style?: ResponsiveStyle; props?: unknown }

export type Place = {
  /** The nodes around the element, nearest first (column, inner row, column, section). */
  chain: StyledNode[]
  /** The share of the content width (columns, inner rows). */
  fraction: number
  /** The section is full width. */
  wide: boolean
  /** The id issues are reported on when the node is inside a drawn global section (the reference). */
  owner: string | null
  /** The global's name, for messages. */
  ownerTitle: string | null
}

export class Collector {
  issues: PageCheckIssue[] = []
  private keys = new Set<string>()

  add(issue: Omit<PageCheckIssue, 'key' | 'source'>, place: Place | null): void {
    let { node_id, fix, message } = issue
    // Inside a global section: report on the reference; it's changed in the global itself.
    if (place?.owner) {
      node_id = place.owner
      fix = { kind: 'focus', label: 'Select the global section', node_id: place.owner, tab: 'content', field: null }
      message = `${message} It is inside the global section${place.ownerTitle ? ` “${place.ownerTitle}”` : ''}: change it there.`
    }
    const key = `${issue.code}:${issue.node_id ?? ''}:${issue.field ?? ''}`
    if (this.keys.has(key)) return
    this.keys.add(key)
    this.issues.push({ ...issue, node_id, fix, message, key, source: 'client' })
  }
}

export const focus = (label: string, node_id: string | null, field: string | null, tab: PageCheckTab = 'content'): PageCheckFix => ({ kind: 'focus', label, node_id, tab, field })

export function label(type: string): string {
  if (type === 'section') return 'section'
  if (type === 'inner_row') return 'inner row'
  return (elementMeta(type)?.label ?? type).toLowerCase()
}

export const visibleAnywhere = (node: { visibility?: Partial<Record<string, boolean>> }) =>
  !node.visibility || node.visibility.desktop !== false || node.visibility.tablet !== false || node.visibility.mobile !== false

export type PictureRef = { field: string; itemId: string | null; media_id: string; alt: string | null; slot: number; linked: boolean; altField: string | null }

/** The pictures an element shows, with the alt text field and the width of their slot (px). */
export function pictures(element: StyledNode, slot: number): PictureRef[] {
  const p = isObj(element.props) ? element.props : {}
  const out: PictureRef[] = []
  const one = (media: unknown, alt: string | null, field: string, altField: string | null, linked = false, width = slot) => {
    if (typeof media === 'string' && media !== '') out.push({ field, itemId: null, media_id: media, alt, slot: width, linked, altField })
  }
  const items = (key: string, columns: number, altKey = 'alt') => {
    for (const item of list(p[key])) {
      const id = str(item.id)
      if (typeof item.media_id === 'string' && item.media_id !== '') {
        out.push({ field: `${key}.${id}.media_id`, itemId: id, media_id: item.media_id, alt: str(item[altKey]), slot: slot / columns, linked: isObj(item.link), altField: `${key}.${id}.${altKey}` })
      }
    }
  }
  const cols = (value: unknown, fallback: number) => (isObj(value) && typeof value.base === 'number' ? value.base : fallback)
  switch (element.type) {
    case 'image':
      one(p.media_id, str(p.alt), 'media_id', 'alt', isObj(p.link))
      break
    case 'shop_the_look':
      one(p.media_id, str(p.alt), 'media_id', 'alt')
      break
    case 'gallery':
      items('images', cols(p.columns, 3))
      break
    case 'photo_grid':
      items('images', cols(p.columns, 4))
      break
    case 'image_carousel':
      items('images', 1)
      break
    case 'logo_carousel':
      items('logos', 6)
      break
    case 'before_after':
      for (const side of ['before', 'after'] as const) {
        const value = isObj(p[side]) ? (p[side] as Obj) : {}
        one(value.media_id, str(value.alt), `${side}.media_id`, `${side}.alt`)
      }
      break
    case 'category_card':
      one(p.media_id, null, 'media_id', null)
      break
    case 'team':
      for (const member of list(p.members)) {
        if (typeof member.media_id === 'string' && member.media_id) out.push({ field: `members.${str(member.id)}.media_id`, itemId: str(member.id), media_id: member.media_id, alt: null, slot: slot / cols(p.columns, 3), linked: false, altField: null })
      }
      break
  }
  return out
}
