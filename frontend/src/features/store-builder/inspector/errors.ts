/*
 * Problem paths → the error keys the inspector forms read. Client problems are relative to the
 * node (`props.config.limit`); server problems carry the document path
 * (`sections.0.columns.1.elements.2.props.config.limit`).
 */

import { isWrappedSectionType } from '@/storefront/builder/registry'
import { B4_TYPES, B6_TYPES, B8A_TYPES } from './validate'
import type { BuilderNode, Problem } from './types'

/** Drops the `sections.0.columns.1.elements.2.` chain of a document path. */
export function localPath(path: string): string {
  return path.replace(/^(?:(?:sections|columns|elements)\.\d+(?:\.|$))+/, '')
}

/**
 * The form key of a node-relative path: the props prefix is dropped (`props.text` → `text`);
 * wrapped sections use the homepage editor's keys (`config.limit`, `banner_ids` / `item_ids`).
 */
export function formKey(node: BuilderNode, path: string): string {
  const local = localPath(path)
  if (local.startsWith('schedule.')) return local.slice('schedule.'.length)
  if (local.startsWith('visibility')) return 'visibility'
  if (!local.startsWith('props.') && local !== 'props') return local
  const prop = local.slice('props.'.length)
  if (isWrappedSectionType(node.type)) {
    if (prop === 'items' || prop.startsWith('items.')) return node.type === 'hero_slider' || node.type === 'banner_grid' ? 'banner_ids' : 'item_ids'
    return prop
  }
  // B6: list items keep their path (`items.2.title`, `hotspots.0.product_id`, `columns.base`); a link is its field (`items.2.link`).
  if (B6_TYPES.has(node.type) || B8A_TYPES.has(node.type)) return prop.replace(/\.link\.url$/, '.link').replace(/^link\.url$/, 'link')
  const parts = prop.split('.')
  // B4: a video's derived provider / id belong to its URL field; a call to action's buttons have a label and a link each.
  if (node.type === 'video' && (parts[0] === 'provider' || parts[0] === 'video_id')) return 'url'
  if (node.type === 'cta' && (parts[0] === 'primary' || parts[0] === 'secondary') && parts.length > 1) return `${parts[0]}.${parts[1]}`
  // `link.url` → `link`
  return parts[0] ?? prop
}

/** First message per form key; server problems win over client ones for the same key. */
export function errorMap(node: BuilderNode, client: Problem[], server: Problem[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const problem of [...server, ...client]) {
    const key = formKey(node, problem.path)
    if (!(key in map)) map[key] = problem.message
  }
  return map
}

const BASIC_FIELDS: Record<string, readonly string[]> = {
  section: ['layout', 'columns'],
  heading: ['text', 'level', 'link'],
  text: ['html'],
  image: ['media_id', 'alt', 'link', 'aspect', 'fit'],
  button: ['label', 'link', 'variant', 'size'],
  divider: ['line', 'thickness', 'width', 'color', 'align'],
  inner_row: ['columns'],
}
const ADVANCED_FIELDS = ['starts_at', 'ends_at', 'visibility']

/**
 * Whether the inspector shows a problem next to a field of this node (otherwise it is listed at
 * the top of the panel). Bangla fields count only while Bangla is enabled.
 */
export function isInlineProblem(node: BuilderNode, problem: Problem, bangla: boolean): boolean {
  const key = formKey(node, problem.path)
  if (key.startsWith('translations.')) return bangla && key.startsWith('translations.bn.')
  if (node.type === 'column') return false
  if (ADVANCED_FIELDS.includes(key)) return true
  if (node.type === 'section' && (key === 'anchor' || key === 'sticky' || key === 'shape_top' || key === 'shape_bottom')) return true
  if (isWrappedSectionType(node.type)) {
    if (key === 'title' || key === 'subtitle') return node.type !== 'hero_slider'
    return key === 'banner_ids' || key === 'item_ids' || key.startsWith('config.')
  }
  // B4 elements show every prop's problem next to its field.
  if (B4_TYPES.has(node.type) || B6_TYPES.has(node.type) || B8A_TYPES.has(node.type)) return key !== '' && key !== 'id' && key !== 'type'
  return (BASIC_FIELDS[node.type] ?? []).includes(key)
}
