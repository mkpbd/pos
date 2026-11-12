import type { B6Element } from '../types'

export type B6Type = B6Element['type']

/** The B6 element types (contract §1). */
export const B6_TYPES = [
  'accordion',
  'tabs',
  'icon_box',
  'icon_list',
  'quote',
  'notice',
  'counter',
  'steps',
  'chart',
  'gallery',
  'image_carousel',
  'logo_carousel',
  'map',
  'category_card',
  'product_spotlight',
  'shop_the_look',
  'trust_badges',
  'recently_viewed',
  'marquee',
] as const satisfies readonly B6Type[]

export function isB6Type(type: string): type is B6Type {
  return (B6_TYPES as readonly string[]).includes(type)
}
