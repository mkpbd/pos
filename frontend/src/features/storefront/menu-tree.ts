import type { MenuItemNode } from '@/features/storefront/api'

/**
 * Pure operations for the menu tree editor. Nodes are addressed by their index path
 * from the root ([2, 0] = first child of the third top-level item). Every operation
 * returns a new tree. `key` identifies nodes for React only and is never sent.
 */
export const MAX_MENU_DEPTH = 3
export const MAX_MENU_ITEMS = 200

export type EditorNode = Omit<MenuItemNode, 'id' | 'type' | 'children'> & { key: string; children: EditorNode[] }
export type NodePath = number[]

let sequence = 0
const nextKey = () => `n${++sequence}`

export function emptyNode(): EditorNode {
  return { key: nextKey(), label: '', url: '', open_in_new_tab: false, is_visible: true, is_mega: false, mega_columns: null, image_media_id: null, children: [] }
}

export function fromApi(items: MenuItemNode[]): EditorNode[] {
  return items.map((i) => ({
    key: nextKey(),
    label: i.label,
    url: i.url,
    open_in_new_tab: i.open_in_new_tab,
    is_visible: i.is_visible,
    is_mega: i.is_mega,
    mega_columns: i.mega_columns,
    image_media_id: i.image_media_id,
    children: fromApi(i.children),
  }))
}

/** The PUT payload: mega fields only on mega items, trimmed text. */
export function toApi(nodes: EditorNode[]): MenuItemNode[] {
  return nodes.map((n) => ({
    type: 'custom',
    label: n.label.trim(),
    url: n.url.trim(),
    open_in_new_tab: n.open_in_new_tab,
    is_visible: n.is_visible,
    is_mega: n.is_mega,
    mega_columns: n.is_mega ? (n.mega_columns ?? 4) : null,
    image_media_id: n.is_mega ? n.image_media_id : null,
    children: toApi(n.children),
  }))
}

export function countNodes(nodes: EditorNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0)
}

export function nodeAt(nodes: EditorNode[], path: NodePath): EditorNode | undefined {
  let current: EditorNode | undefined
  let level = nodes
  for (const index of path) {
    current = level[index]
    if (!current) return undefined
    level = current.children
  }
  return current
}

/** Applies `change` to the children list at `parentPath` ([] = top level). */
function withSiblings(nodes: EditorNode[], parentPath: NodePath, change: (siblings: EditorNode[]) => EditorNode[]): EditorNode[] {
  if (parentPath.length === 0) return change(nodes)
  const [head, ...rest] = parentPath
  return nodes.map((n, i) => (i === head ? { ...n, children: withSiblings(n.children, rest, change) } : n))
}

/** Appends a new item at the top level (parentPath = []) or under the item at parentPath. */
export function addNode(nodes: EditorNode[], parentPath: NodePath, node: EditorNode = emptyNode()): EditorNode[] {
  if (parentPath.length >= MAX_MENU_DEPTH) return nodes
  return withSiblings(nodes, parentPath, (siblings) => [...siblings, node])
}

export function removeNode(nodes: EditorNode[], path: NodePath): EditorNode[] {
  const index = path.at(-1) ?? 0
  return withSiblings(nodes, path.slice(0, -1), (siblings) => siblings.filter((_, i) => i !== index))
}

/** Moves an item up (-1) or down (+1) among its siblings; no-op at the edges. */
export function moveNode(nodes: EditorNode[], path: NodePath, direction: -1 | 1): EditorNode[] {
  const index = path.at(-1) ?? 0
  return withSiblings(nodes, path.slice(0, -1), (siblings) => {
    const target = index + direction
    if (target < 0 || target >= siblings.length) return siblings
    const copy = [...siblings]
    const [moved] = copy.splice(index, 1)
    if (moved) copy.splice(target, 0, moved)
    return copy
  })
}

export function updateNode(nodes: EditorNode[], path: NodePath, patch: Partial<Omit<EditorNode, 'key' | 'children'>>): EditorNode[] {
  const index = path.at(-1) ?? 0
  return withSiblings(nodes, path.slice(0, -1), (siblings) => siblings.map((n, i) => (i === index ? { ...n, ...patch } : n)))
}

/** The API's error key prefix for a node: [1, 0] → "items.1.children.0". */
export function errorKey(path: NodePath): string {
  return `items.${path.join('.children.')}`
}

/** Mirrors the API's link rule: a site path "/sale" or an absolute http(s) URL. */
export function isSafeLink(link: string): boolean {
  const value = link.trim()
  if (!value || value.length > 255 || /\s/.test(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//') && !value.includes('\\')
  return /^https?:\/\/[^/\s]+/i.test(value)
}

/**
 * Client-side checks before saving, keyed like the API's validation errors
 * ("items.0.children.1.url").
 */
export function validateTree(nodes: EditorNode[], allowsMega: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  const walk = (level: EditorNode[], parent: NodePath) =>
    level.forEach((n, i) => {
      const path = [...parent, i]
      const key = errorKey(path)
      if (!n.label.trim()) errors[`${key}.label`] = 'Enter a label.'
      else if (n.label.trim().length > 80) errors[`${key}.label`] = 'At most 80 characters.'
      if (!isSafeLink(n.url)) errors[`${key}.url`] = 'Use a site path such as /sale or an http(s) URL.'
      if (n.is_mega && (path.length > 1 || !allowsMega)) errors[`${key}.is_mega`] = 'Only top-level items of the main navigation can open a mega menu.'
      walk(n.children, path)
    })
  walk(nodes, [])
  return errors
}
