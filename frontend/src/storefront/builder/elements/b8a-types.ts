import type { B8aElement } from '../types'

export type B8aType = B8aElement['type']

/** The B8a element types (contract §1). */
export const B8A_TYPES = [
  'pricing_table',
  'before_after',
  'comparison_table',
  'flash_sale_bar',
  'bundle',
  'team',
  'review_wall',
  'photo_grid',
  'store_hours',
  'progress_bars',
] as const satisfies readonly B8aType[]

export function isB8aType(type: string): type is B8aType {
  return (B8A_TYPES as readonly string[]).includes(type)
}
