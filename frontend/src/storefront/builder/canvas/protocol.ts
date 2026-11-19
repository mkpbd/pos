import type { StorefrontBootstrap } from '../../types'
import type { PreviewContext } from '../audience/types'
import type { BuilderData, BuilderMedia, Device, DeviceOrder, PopupSettings, RenderPageSection } from '../types'
import type { FontSource } from '../../fonts'
import type { CanvasThemeSettings } from './theme-override'

/*
 * postMessage protocol between the store builder editor (admin, parent window) and its canvas
 * (/admin/builder-canvas, in an iframe). Both sides import this file. Every message carries
 * `source: 'pos-builder'` and `v: 1`; a receiver accepts only messages from its own origin (the
 * canvas is same-origin with the admin) and from the expected window.
 */

export const BUILDER_SOURCE = 'pos-builder'
export const PROTOCOL_VERSION = 1

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * B4 (additive, v stays 1): what kind of document the canvas draws. A page fills the canvas; a
 * header, footer or zone is drawn where it sits on the store, next to a faded sample of the page
 * around it. Absent = `page`; a value the canvas doesn't know draws as a page.
 * P1b (additive): the product page zones `product.below_price` (in the summary column, under the
 * price) and `product.bottom` (the end of the page). A targeted zone version
 * (`zone:<zone>@category:<id>`) is drawn as its zone.
 */
export type CanvasSurroundings =
  | 'page'
  | 'header'
  | 'footer'
  | 'zone:listing.top'
  | 'zone:listing.bottom'
  | 'zone:product.below_price'
  | 'zone:product.after'
  | 'zone:product.bottom'
  | 'popup'

export const CANVAS_SURROUNDINGS: readonly CanvasSurroundings[] = [
  'page',
  'header',
  'footer',
  'zone:listing.top',
  'zone:listing.bottom',
  'zone:product.below_price',
  'zone:product.after',
  'zone:product.bottom',
  'popup',
]

/**
 * P1b (additive, v stays 1): the product a product page zone is previewed with — for a version
 * targeted to a category or a product, a matching product. The faded sample around the zone
 * shows its photo, name and price instead of grey blocks. `price` is a decimal string ("120.00").
 */
export type CanvasProduct = { name: string; price: string | null; image_url: string | null }

/** Parent → canvas. */
export type ParentMessage =
  | { type: 'init'; bootstrap: StorefrontBootstrap; locale: string }
  | {
      type: 'render'
      /** B9: sections, a section drawn from a global (with `global`), or an unavailable global reference. */
      sections: RenderPageSection[]
      data: Record<string, BuilderData>
      media: Record<string, BuilderMedia>
      selection: string | null
      hover: string | null
      /** Nodes with server problems (outlined red). */
      errors: string[]
      device: Device
      /** Wrapped elements waiting for their data (drawn as skeletons). */
      pending: string[]
      /** B4: the kind of document (default `page`). */
      surroundings?: CanvasSurroundings
      /** B4: what the canvas says while the document is empty. */
      emptyText?: string
      /**
       * B8b (additive): with `surroundings: 'popup'`, the popup's settings; the canvas draws the
       * document inside that layout over a dimmed sample page (no triggers; forms don't submit).
       */
      popup?: PopupSettings
      /** P1b (additive): with a product page zone, the product its sample shows (absent = grey blocks). */
      product?: CanvasProduct
      /**
       * B12 (additive): the draft's per-device order. The canvas draws sections and column
       * elements in `device`'s order (mobile → tablet → base). Absent = base order.
       */
      device_order?: DeviceOrder | null
    }
  | { type: 'scroll-to'; id: string }
  /** B3 (additive, v stays 1): the theme draft's settings, laid over the bootstrap theme for instant previews. */
  | {
      type: 'theme'
      settings: CanvasThemeSettings
      /**
       * B10 (additive): the store's uploaded fonts (GET /storefront/fonts records as they come, or
       * theme payload `fonts.custom` entries), so a Site styles draft that picks one shows it. Absent =
       * the bootstrap theme's `fonts.custom` only.
       */
      fonts?: FontSource[]
    }
  /** Drag autoscroll near the canvas edges. */
  | { type: 'scroll-by'; dy: number }
  /** B6 (additive, v stays 1): replay a node's entrance animation once (the inspector's "Preview animation"). */
  | { type: 'play-motion'; id: string }
  /**
   * B10 (additive, v stays 1): start editing a text field in place (the inspector's "Edit on the
   * page", Enter on the selected node). `field` absent = the node's first field shown on the canvas.
   */
  | { type: 'edit-text'; id: string; field?: string }
  /** B10: finish the edit in progress (selection changed, undo, device switch …): commit or cancel it. */
  | { type: 'end-text-edit'; commit: boolean }
  /** B10: the language the canvas draws and edits in ("Edit in: English | বাংলা"); the next `render` carries that language's texts. */
  | { type: 'set-locale'; locale: string }
  /**
   * B10: the editor's answer to `text-edit-link` (its URL prompt, validated): a URL = link the
   * selected text, `''` = remove the link, null = the owner cancelled (nothing changes).
   */
  | { type: 'text-edit-link-result'; url: string | null }
  /**
   * B13 (additive, v stays 1): the toolbar's "Preview as". null = "Show everything" (every node
   * drawn as before). With a context the canvas checks each section's / element's `audience`
   * against it (../audience/evaluate.ts `evaluateAudience`) and draws the nodes that would be hidden
   * faded (`data-b-audience-out`, still clickable and selectable). Sent on change and after each `ready`.
   * The canvas never drops a node by audience or A/B arm: the editor sends only the arm it shows.
   */
  | { type: 'preview-as'; context: PreviewContext | null }

/** Canvas → parent. Rects are in the canvas viewport's CSS pixels. */
export type CanvasMessage =
  | { type: 'ready' }
  | { type: 'rects'; nodes: Record<string, Rect>; scrollY: number; height: number; viewport: { w: number; h: number } }
  /**
   * B12 (additive, v stays 1): the modifier keys held while clicking, for multi-select (Ctrl / Cmd
   * toggles, Shift selects a range). Absent = not held.
   */
  | { type: 'click'; id: string | null; ctrl?: boolean; shift?: boolean; meta?: boolean }
  | { type: 'hover'; id: string | null }
  | { type: 'key'; key: string; ctrl: boolean; shift: boolean; meta: boolean }
  /**
   * B10 (additive, v stays 1): a text field became editable on the canvas (double-click, Enter,
   * `edit-text`). The editor keeps its shortcuts away while it lasts. `field` is a translation
   * key (see TextFieldKey); `kind`: `html` (rich text with the format bar), `multiline` (Enter = new
   * line) or `line` (Enter commits).
   */
  | { type: 'text-edit-start'; id: string; field: string; locale?: string; kind?: TextFieldKind }
  /**
   * B10: the edited value (one commit = one undo step). Plain fields: the text (line breaks only in
   * multiline fields). HTML fields: sanitized to the server's tags (sanitizeRichText). The editor
   * checks the limits and applies it to `props` (the store's default language) or
   * `translations.<locale>.<field>`; the canvas shows it from the next `render`.
   */
  | { type: 'text-edit-commit'; id: string; field: string; value: string; locale: string; kind?: TextFieldKind }
  /** B10: Esc (or an edit that changed nothing): the field shows its value again. */
  | { type: 'text-edit-cancel'; id: string; field?: string }
  /** B10: the format bar's Link button; `url` = the link at the selection (null = none). The editor prompts and answers `text-edit-link-result`. */
  | { type: 'text-edit-link'; id: string; field: string; url: string | null }
  /**
   * B10: a file dropped on an image element (`target: 'image'`, sets `props.media_id`) or on a
   * section / inner row / column with a background image (`'background'`, sets the current
   * device's `background.image.media_id`). The File is structured-cloned; the editor checks the
   * type and size, uploads (drawing the progress on the node in its overlay) and applies the media id.
   */
  | { type: 'image-drop'; id: string; target: ImageDropTarget; file: File }
  /** B10: double-click on an image (or a background-image node): the editor opens the media chooser for it. */
  | { type: 'image-replace'; id: string; target?: ImageDropTarget }

/** B10: how a text field is edited in place. */
export type TextFieldKind = 'line' | 'multiline' | 'html'

/**
 * B10: a text field of a node, named like its translation key: `text`, `primary.label`,
 * `items.<item_id>.title`, `plans.<plan_id>.features.<feature_id>.text`, `labels.<index>` — the
 * registry's translatable patterns (`items.*.title`) with the item ids filled in.
 */
export type TextFieldKey = string

export type ImageDropTarget = 'image' | 'background'

type Envelope = { source: typeof BUILDER_SOURCE; v: typeof PROTOCOL_VERSION }

export function envelope<M extends ParentMessage | CanvasMessage>(message: M): M & Envelope {
  return { ...message, source: BUILDER_SOURCE, v: PROTOCOL_VERSION }
}

const PARENT_TYPES = new Set(['init', 'render', 'scroll-to', 'scroll-by', 'theme', 'play-motion', 'edit-text', 'end-text-edit', 'set-locale', 'text-edit-link-result', 'preview-as'])
const CANVAS_TYPES = new Set(['ready', 'rects', 'click', 'hover', 'key', 'text-edit-start', 'text-edit-commit', 'text-edit-cancel', 'text-edit-link', 'image-drop', 'image-replace'])

function accepted(event: MessageEvent, origin: string, from: MessageEventSource | null | undefined, types: Set<string>): boolean {
  if (event.origin !== origin) return false
  if (from !== undefined && event.source !== from) return false
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return false
  const message = data as Record<string, unknown>
  return message.source === BUILDER_SOURCE && message.v === PROTOCOL_VERSION && typeof message.type === 'string' && types.has(message.type)
}

/** A message for the canvas, or null (wrong origin, sender, source or version). `from`: the parent window (undefined = any sender). */
export function readParentMessage(event: MessageEvent, origin: string, from?: MessageEventSource | null): ParentMessage | null {
  return accepted(event, origin, from, PARENT_TYPES) ? (event.data as ParentMessage) : null
}

/** A message for the editor, or null. `from`: the canvas iframe's window. */
export function readCanvasMessage(event: MessageEvent, origin: string, from?: MessageEventSource | null): CanvasMessage | null {
  return accepted(event, origin, from, CANVAS_TYPES) ? (event.data as CanvasMessage) : null
}

const PRICE = /^\d{1,12}(\.\d{1,4})?$/

/** An image the canvas may load: a path on this origin or an http(s) URL. */
function isImageUrl(url: string): boolean {
  if (url.length > 2048) return false
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\')
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** P1b: the `product` of a render message as the canvas may draw it, or null (absent or not well-formed). */
export function readCanvasProduct(value: unknown): CanvasProduct | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { name, price, image_url: image } = value as Record<string, unknown>
  if (typeof name !== 'string' || name.trim() === '' || name.length > 255) return null
  return {
    name: name.trim(),
    price: typeof price === 'string' && PRICE.test(price) ? price : null,
    image_url: typeof image === 'string' && isImageUrl(image) ? image : null,
  }
}

/** Shortcut keys the canvas hands to the editor (so they work while focus is in the iframe). */
export function isEditorShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }): boolean {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  // B9: c / v (copy and paste nodes) too, so they work while focus is in the canvas. B12: k (the command box).
  if (mod && ['z', 'y', 'd', 'c', 'v', 'k'].includes(key)) return true
  // B12: `?` opens the shortcut sheet (typed with Shift on most layouts, so Shift is not checked).
  return !mod && ['delete', 'backspace', 'escape', 'arrowup', 'arrowdown', '?'].includes(key)
}
