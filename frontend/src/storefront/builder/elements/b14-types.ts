import type { B14Element } from '../types'

export type B14Type = B14Element['type']

/** The B14 element types: live text and the store page templates' main parts (props: ../templates/types.ts). */
export const B14_TYPES = ['dynamic_text', 'product_listing', 'blog_post_body', 'order_summary', 'not_found_message'] as const satisfies readonly B14Type[]

export function isB14Type(type: string): type is B14Type {
  return (B14_TYPES as readonly string[]).includes(type)
}
