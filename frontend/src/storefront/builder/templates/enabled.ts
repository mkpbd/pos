import { useStorefront } from '../../api'
import { useDraftPreview } from '../api'
import type { RenderElement, RenderPageSection } from '../types'
import type { StoreTemplateKey } from './types'

/** Whether this store page uses its template: published (bootstrap `builder.templates`), or a staff draft preview. */
export function useTemplateEnabled(key: StoreTemplateKey): boolean {
  const { builder } = useStorefront()
  const draft = useDraftPreview()
  return builder?.templates?.[key] === true || draft
}

const OWN_H1_TYPES = new Set(['blog_post_body', 'order_summary', 'not_found_message'])

function elementHasH1(element: RenderElement): boolean {
  if (element.hidden === true) return false
  if (OWN_H1_TYPES.has(element.type)) return true
  if (element.type === 'heading') return element.props?.level === 1
  if (element.type === 'dynamic_text') return element.props?.tag === 'h1'
  if (element.type === 'inner_row') return (element.columns ?? []).some((column) => (column.elements ?? []).some(elementHasH1))
  return false
}

/** Whether a template draws its own h1 (a heading or live text set to h1, or a main part with its own title). */
export function templateHasH1(sections: readonly RenderPageSection[] | undefined): boolean {
  return (sections ?? []).some(
    (section) => section.type !== 'global_section' && section.hidden !== true && (section.columns ?? []).some((column) => (column.elements ?? []).some(elementHasH1)),
  )
}
