import type { CompareNode, CompareResult, FieldChange } from '../publishing-api'

/*
 * B11: the compare endpoint's change list in plain words for a shop owner: "Added: Heading
 * “Eid sale”", "Changed: Button — Button text: “Shop now” → “Buy now”", "Design changed".
 */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved'

export type ChangeItem = {
  key: string
  kind: ChangeKind
  /** The node to show on the canvases (null: not on the page, e.g. page settings). */
  nodeId: string | null
  /** "Heading “Eid sale”". */
  title: string
  /** One line per changed field. */
  details: string[]
  /** B12: the badge text when it isn't the kind's own ("Moved on phones"). */
  badge?: string
}

const FIELD_LABELS: Record<string, string> = {
  text: 'Text',
  html: 'Text',
  label: 'Button text',
  button_label: 'Button text',
  title: 'Title',
  subtitle: 'Subtitle',
  placeholder: 'Placeholder',
  link: 'Link',
  url: 'Link',
  media_id: 'Picture',
  media_ids: 'Pictures',
  alt: 'Picture description',
  style: 'Design (colours, sizes, spacing)',
  visibility: 'Devices it shows on',
  hidden: 'Hidden',
  schedule: 'Show dates',
  motion: 'Animation',
  level: 'Heading size',
  items: 'Items',
  seo: 'Search & sharing',
  popup: 'Popup settings',
  columns: 'Columns',
  width: 'Column width',
}

const LANGUAGE_NAMES: Record<string, string> = { bn: 'Bangla', en: 'English' }

/** "props.primary.label" → "Button text"; "translations.bn.text" → "Text (Bangla)". */
export function fieldLabel(field: string): string {
  const parts = field.split('.').filter((p) => p !== 'props' && p !== '')
  let language: string | null = null
  if (parts[0] === 'translations' && parts.length >= 3) {
    language = LANGUAGE_NAMES[parts[1]!] ?? parts[1]!
    parts.splice(0, 2)
  }
  // The most specific part with a name wins ("primary.label" → label, "link.url" → link).
  const named = [...parts].reverse().find((p) => FIELD_LABELS[p] !== undefined)
  const base = named ? FIELD_LABELS[named]! : humanize(parts.at(-1) ?? field)
  return language ? `${base} (${language})` : base
}

function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Setting'
}

const MAX = 60

/** A value as a short phrase: texts quoted (tags removed), empty as "(empty)". */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const plain = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!plain) return '(empty)'
    return `“${plain.length > MAX ? `${plain.slice(0, MAX - 1)}…` : plain}”`
  }
  if (typeof value === 'object' && 'url' in (value as Record<string, unknown>)) return valueText((value as { url: unknown }).url)
  return '(changed)'
}

function fieldLine(change: FieldChange): string {
  const label = fieldLabel(change.field)
  // Styles come as a flag only.
  if (/(^|\.)style(\.|$)/.test(change.field) || /(^|\.)motion(\.|$)/.test(change.field)) return `${label} changed`
  const before = valueText(change.before)
  const after = valueText(change.after)
  if (before === '(changed)' || after === '(changed)') return `${label} changed`
  return `${label}: ${before} → ${after}`
}

/** "Heading “Eid sale”" from the node's label and type. */
export function nodeTitle(node: CompareNode, typeLabel: (type: string) => string): string {
  const kind = typeLabel(node.type)
  const label = node.label?.trim()
  if (!label) return kind
  return `${kind} ${valueText(label)}`
}

/** `lookup` names a node the server gave only by id (moved nodes), from the drawn pages. */
export function changeItems(result: CompareResult, typeLabel: (type: string) => string, lookup: (id: string) => CompareNode | null = () => null): ChangeItem[] {
  const items: ChangeItem[] = []
  for (const node of result.added) items.push({ key: `a:${node.node_id}`, kind: 'added', nodeId: node.node_id, title: nodeTitle(node, typeLabel), details: [] })
  for (const node of result.removed) items.push({ key: `r:${node.node_id}`, kind: 'removed', nodeId: node.node_id, title: nodeTitle(node, typeLabel), details: [] })
  for (const node of result.changed) {
    const id = node.node_id
    const page = !id || node.type === 'document'
    items.push({ key: `c:${id || 'page'}`, kind: 'changed', nodeId: page ? null : id, title: page ? 'Page settings' : nodeTitle({ ...node, node_id: id }, typeLabel), details: node.fields.map(fieldLine) })
  }
  for (const node of result.moved) {
    const id = typeof node === 'string' ? node : node.node_id
    const known = typeof node === 'string' ? lookup(node) : node
    items.push({ key: `m:${id}`, kind: 'moved', nodeId: id, title: known ? nodeTitle(known, typeLabel) : 'A part of the page', details: [] })
  }
  // B12: the order on phones or tablets changed.
  for (const entry of result.device_moved ?? []) {
    const root = entry.id === 'root'
    const known = root ? null : lookup(entry.id)
    items.push({
      key: `d:${entry.device}:${entry.id}`,
      kind: 'moved',
      badge: entry.device === 'mobile' ? 'Moved on phones' : 'Moved on tablets',
      nodeId: root ? null : entry.id,
      title: root ? 'The order of the sections' : `The order inside ${known ? nodeTitle(known, typeLabel).toLowerCase() : 'a column'}`,
      details: [],
    })
  }
  return items
}

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' }

/** "3 changes" / "No changes". */
export function changeCountText(count: number): string {
  return count === 0 ? 'No changes' : count === 1 ? '1 change' : `${count} changes`
}
