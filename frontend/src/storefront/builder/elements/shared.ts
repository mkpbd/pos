import type { RenderElement } from '../types'

/** A rendered element of one type. */
export type El<T extends RenderElement['type']> = Extract<RenderElement, { type: T }>

/** A string prop, or '' (payload values are checked again here: the renderer never trusts their shape). */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** "10.00" → "10", "12.50" → "12.5" (decimal strings, no float maths). */
export function trimDecimalString(value: string): string {
  return /^\d+\.\d+$/.test(value) ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}

export const ALIGN_ITEMS = { left: 'items-start text-left', center: 'items-center text-center', right: 'items-end text-right' } as const
export const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const

/** The theme button, as the homepage sections draw it (`sf-button` follows the theme's button colours and hover). */
export const PRIMARY_BUTTON =
  'sf-button inline-flex min-h-11 items-center justify-center gap-2 rounded-sf-button bg-sf-button px-6 py-3 text-sm font-bold tracking-wide text-sf-button-foreground transition hover:brightness-105'
export const SECONDARY_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sf-button border-2 border-current px-6 py-3 text-sm font-bold tracking-wide text-sf-heading transition hover:bg-sf-surface'
