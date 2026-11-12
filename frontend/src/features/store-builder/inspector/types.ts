/*
 * Contract types between the editor (agent A: shell, state, canvas) and the inspector (B2 plan
 * §4). The document types themselves are the B1 ones from `storefront/builder/types.ts`.
 */

import type { MediaRef } from '@/storefront/types'
import type { ElementMeta } from '@/storefront/builder/registry'
import type { BuilderDocument, Column, Device, Element, PopupSettings, Section } from '@/storefront/builder/types'

/** The whole draft content (schema v1). */
export type BuilderContent = BuilderDocument

/** Anything the editor can select: a section, a column (of a section or an inner row) or an element. */
export type BuilderNode = Section | Column | Element

/** GET /storefront/builder/elements (backend ElementRegistry::metadata). */
export type ElementsMetadata = {
  types: ElementMeta[]
  limits: Record<string, unknown>
  enums: Record<string, unknown>
}

/**
 * A validation problem. `path` is relative to the node (`props.config.limit`, `props.items`,
 * `translations.bn.title`); document paths (`sections.0.columns.1.elements.2.props.text`) are
 * accepted too. Server problems may carry a `code` (e.g. BANNER_NOT_FOUND) and the offending `ids`.
 */
export type Problem = { path: string; message: string; code?: string; ids?: string[] }

export type ColumnPreset = '1' | '1-1' | '1-2' | '2-1' | '1-1-1' | '1-1-1-1' | '1-2-1'

export type InspectorCommand =
  | { type: 'set-column-preset'; nodeId: string; preset: ColumnPreset }
  | { type: 'select'; nodeId: string | null }
  /** B3: the device being styled (the toolbar's device toggle). */
  | { type: 'set-device'; device: Device }
  /** B3: a column's width on a device (the neighbour adjusts, see column-resize.ts); null = back to the wider device's width. */
  | { type: 'set-column-width'; columnId: string; device: Device; width: number | null }
  /** B3: open the Site styles drawer (theme draft). */
  | { type: 'open-site-styles' }
  /** B6: replay the node's entrance animation on the canvas ("Preview animation"). */
  | { type: 'preview-motion'; nodeId: string }
  /**
   * A banner of the page was edited from the inspector: in place (`replaced` null) or copied by
   * the server (swap `old_id` for `new_id` in the draft, one undo step). Either way the canvas
   * re-resolves the elements showing it (their input may be unchanged, the banner is not).
   */
  | { type: 'banner-edited'; bannerId: string; replaced: { old_id: string; new_id: string } | null }
  /** B8b: the popup's settings changed (`content.popup`; one undo step per coalesce key). */
  | { type: 'set-popup'; settings: PopupSettings; coalesceKey?: string }
  /** B8b: switch the popup on or off on the store (not versioned; needs `storefront.publish`). */
  | { type: 'set-popup-active'; active: boolean }

export type InspectorChangeOptions = {
  /** Edits with the same key within a short time are one undo step (typing). */
  coalesceKey?: string
  /** Media chosen in this edit, so the canvas can draw it before the next resolve. */
  media?: Record<string, MediaRef>
}

export type InspectorDocument = {
  id: string
  /** B4: page (default), header, footer or zone, and its key (`cms:<uuid>`, `zone:listing.top`, …). B8b: popup (`popup:<uuid>`). */
  kind?: 'page' | 'header' | 'footer' | 'theme' | 'zone' | 'popup'
  key?: string
  title: string
  /** null for the header, footer and zones. */
  path: string | null
  published: { number: number; published_at: string } | null
  /** B8b popups: switched on on the store. */
  active?: boolean
  /** B8b popups: the person may switch it on or off (`storefront.publish`). */
  canPublish?: boolean
  /** B8b popups: the on / off switch is waiting for the server. */
  activePending?: boolean
}

export type InspectorProps = {
  /** The whole draft. */
  content: BuilderContent
  /** The selected node, or null for the page settings. */
  node: BuilderNode | null
  document: InspectorDocument
  registry: ElementsMetadata
  /** Enabled storefront languages; `bn` adds the Bangla fields. */
  locales: string[]
  /** Server problems for this node (from a 422 on save). */
  errors: Problem[]
  /** Replace the node (same id); the editor records history. */
  onChange(next: BuilderNode, opts?: InspectorChangeOptions): void
  onCommand(cmd: InspectorCommand): void
  /** B3: the device the Style tab edits (Desktop = `style.base`); default desktop. */
  device?: Device
  /** B3: the draft theme's colours and the store palette, for the colour controls. */
  theme?: { colors?: Record<string, string>; palette?: readonly { name: string; hex: string }[] }
  /** B4: the user may add or change custom HTML (`storefront.custom_html`); default false (read only). */
  canCustomHtml?: boolean
}
