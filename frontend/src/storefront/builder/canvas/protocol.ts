import type { StorefrontBootstrap } from '../../types'
import type { BuilderData, BuilderMedia, Device, RenderSection } from '../types'
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
 * around it. Absent = `page`.
 */
export type CanvasSurroundings = 'page' | 'header' | 'footer' | 'zone:listing.top' | 'zone:listing.bottom' | 'zone:product.after'

export const CANVAS_SURROUNDINGS: readonly CanvasSurroundings[] = ['page', 'header', 'footer', 'zone:listing.top', 'zone:listing.bottom', 'zone:product.after']

/** Parent → canvas. */
export type ParentMessage =
  | { type: 'init'; bootstrap: StorefrontBootstrap; locale: string }
  | {
      type: 'render'
      sections: RenderSection[]
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
    }
  | { type: 'scroll-to'; id: string }
  /** B3 (additive, v stays 1): the theme draft's settings, laid over the bootstrap theme for instant previews. */
  | { type: 'theme'; settings: CanvasThemeSettings }
  /** Drag autoscroll near the canvas edges. */
  | { type: 'scroll-by'; dy: number }

/** Canvas → parent. Rects are in the canvas viewport's CSS pixels. */
export type CanvasMessage =
  | { type: 'ready' }
  | { type: 'rects'; nodes: Record<string, Rect>; scrollY: number; height: number; viewport: { w: number; h: number } }
  | { type: 'click'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'key'; key: string; ctrl: boolean; shift: boolean; meta: boolean }

type Envelope = { source: typeof BUILDER_SOURCE; v: typeof PROTOCOL_VERSION }

export function envelope<M extends ParentMessage | CanvasMessage>(message: M): M & Envelope {
  return { ...message, source: BUILDER_SOURCE, v: PROTOCOL_VERSION }
}

const PARENT_TYPES = new Set(['init', 'render', 'scroll-to', 'scroll-by', 'theme'])
const CANVAS_TYPES = new Set(['ready', 'rects', 'click', 'hover', 'key'])

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

/** Shortcut keys the canvas hands to the editor (so they work while focus is in the iframe). */
export function isEditorShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }): boolean {
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && (key === 'z' || key === 'y' || key === 'd')) return true
  return !mod && ['delete', 'backspace', 'escape', 'arrowup', 'arrowdown'].includes(key)
}
