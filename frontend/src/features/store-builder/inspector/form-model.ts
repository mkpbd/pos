/*
 * Pure helpers of the B6 / B8a element forms: writing props and list props (moving the items'
 * Bangla texts along), per-item errors and text limits.
 */

import type { DocumentContext, Element } from '@/storefront/builder/types'
import type { MediaRef } from '@/storefront/types'
import { moveItemTranslations, type ItemListChange } from './b6-model'
import type { Errors } from './fields'
import type { InspectorChangeOptions } from './types'

export type AnyElement = Element & { props: Record<string, unknown> }

export type OnChange<N> = (next: N, opts?: InspectorChangeOptions) => void

/** Props of a B6 / B8a element form. */
export type ElementFormProps<N> = {
  node: N
  onChange: OnChange<N>
  errors: Errors
  /** Bangla is enabled for the store. */
  bangla: boolean
  context?: DocumentContext
  /** Icon names the server accepts (GET /elements `enums.icons`). */
  icons?: readonly string[]
  /** Shown in the setup dialog (insert): the same form, without the Bangla fields. */
  setup?: boolean
}

/** Writes some props; `key` coalesces typing into one undo step, `media` lets the canvas draw a chosen image at once. */
export function patch<N extends AnyElement>(node: N, onChange: OnChange<N>, values: Partial<N['props']>, key?: string, media?: Record<string, MediaRef>) {
  const opts: InspectorChangeOptions = { ...(key ? { coalesceKey: `${node.id}:${key}` } : {}), ...(media ? { media } : {}) }
  onChange({ ...node, props: { ...node.props, ...values } }, Object.keys(opts).length > 0 ? opts : undefined)
}

/** Writes a list prop, moving the items' Bangla texts along and coalescing typing. */
export function setList<N extends AnyElement>(node: N, onChange: OnChange<N>, list: string, items: unknown[], change?: ItemListChange, media?: Record<string, MediaRef>) {
  const opts: InspectorChangeOptions = { ...(change?.typing ? { coalesceKey: `${node.id}:${list}:${change.typing}` } : {}), ...(media ? { media } : {}) }
  onChange({ ...node, props: { ...node.props, [list]: items }, translations: moveItemTranslations(node.translations, list, change) }, Object.keys(opts).length > 0 ? opts : undefined)
}

/** Errors of one list item, keyed by its field (`items.2.title` → `title`). */
export function itemErrors(errors: Errors, list: string, index: number): Errors {
  const prefix = `${list}.${index}.`
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]))
}

/** The text limit of a prop (`title`, `items.*.title`) in a limits table; 255 when unknown. */
export function limitIn(table: Record<string, Record<string, number>>, type: string, field: string): number {
  return table[type]?.[field] ?? 255
}
