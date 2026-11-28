import { isObject } from './elements/shared'
import type { BuilderPage } from './types'

/*
 * B22a: whether a header document has settings of its own for phones (a phone style, a part hidden
 * on phones, a phone column width or the phone order). Without any, phones get the default compact
 * row (./phone-header.tsx). Shared by the store, the editor canvas and its note.
 */

/** Whether a value holds something (an empty object / list or an empty string is nothing). */
function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isObject(value)) return Object.values(value).some(hasValue)
  return value !== null && value !== undefined && value !== ''
}

function nodeHasPhoneSettings(node: unknown): boolean {
  if (!isObject(node)) return false
  if (isObject(node.style) && hasValue(node.style.mobile)) return true
  if (isObject(node.visibility) && node.visibility.mobile === false) return true
  if (isObject(node.width) && typeof node.width.mobile === 'number') return true
  return ['columns', 'elements'].some((key) => Array.isArray(node[key]) && (node[key] as unknown[]).some(nodeHasPhoneSettings))
}

/** Whether the header document has settings of its own for phones (else phones get the default compact row). */
export function hasPhoneSettings(page: Pick<BuilderPage, 'sections' | 'device_order'>): boolean {
  if (isObject(page.device_order) && hasValue(page.device_order.mobile)) return true
  return Array.isArray(page.sections) && page.sections.some(nodeHasPhoneSettings)
}
