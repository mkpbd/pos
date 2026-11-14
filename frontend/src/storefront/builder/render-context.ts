import { createContext, useContext, type ReactNode } from 'react'
import type { MessageKey } from '../i18n/en'
import type { BuilderData, BuilderPage, ElementDataState, NodeState, RenderElement } from './types'

/*
 * What every node of a builder page can read while it renders: the payload (data, media), whether
 * it is a draft preview, and the editor canvas's placeholder hook. Shared by PageRenderer and the
 * element renderers in ./elements.
 */

export type PageContext = { page: BuilderPage; draft: boolean; placeholder?: (element: RenderElement) => ReactNode }

export const PageCtx = createContext<PageContext | null>(null)

export function usePage(): PageContext {
  const value = useContext(PageCtx)
  if (!value) throw new Error('builder nodes render inside PageRenderer')
  return value
}

/**
 * B9: the global document a node belongs to when it sits in a section drawn from a global section
 * (`section.global.id`), else null. Forms and order forms inside a global submit to that document.
 */
export const GlobalDocumentCtx = createContext<string | null>(null)

/** The document a form or order form submits to: the enclosing global section's document, else the page's. */
export function useOwnerDocumentId(): string | undefined {
  const { page } = usePage()
  return useContext(GlobalDocumentCtx) ?? page.document?.id
}

/** The column an element sits in (image `sizes`). */
export const ColumnWidthCtx = createContext<{ base: number; tablet?: number; mobile?: number }>({ base: 100 })

/** The resolved data of an element (`data[id]`), or undefined. */
export function useElementData(id: string): BuilderData | undefined {
  const { page } = usePage()
  return Object.hasOwn(page.data ?? {}, id) ? page.data[id] : undefined
}

/** A draft-preview mark: the node's own state, or why its data keeps it from visitors. */
export type MarkState = NodeState | ElementDataState

export const MARK_LABELS: Record<MarkState, MessageKey> = {
  hidden: 'content.builder.hidden',
  scheduled: 'content.preview.scheduled',
  expired: 'content.preview.expired',
  empty: 'content.builder.empty',
  inactive: 'content.builder.inactive',
  unavailable: 'content.builder.unavailable',
}

export function isMarkState(value: unknown): value is MarkState {
  return typeof value === 'string' && Object.hasOwn(MARK_LABELS, value)
}

