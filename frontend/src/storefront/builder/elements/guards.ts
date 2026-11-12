import type { BuilderData, CountdownData, DiscountData, FaqListData, MenuData, PromoCardData } from '../types'
import { isObject } from './shared'

/* Type guards of the B4 elements' `data[id]` (a payload is checked before it is drawn). */

export function isCountdownData(data: BuilderData): data is CountdownData {
  return isObject(data) && !('type' in data) && 'promotion' in data && 'ends_at' in data && !('kind' in data)
}

export function isDiscountData(data: BuilderData): data is DiscountData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && (d.kind === 'percent' || d.kind === 'fixed') && typeof d.value === 'string'
}

export function isPromoCardData(data: BuilderData): data is PromoCardData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && typeof d.slug === 'string' && typeof d.url === 'string' && typeof d.name === 'string' && typeof d.price === 'string'
}

export function isMenuData(data: BuilderData): data is MenuData {
  return isObject(data) && !('type' in data) && Array.isArray((data as Record<string, unknown>).items)
}

export function isFaqListData(data: BuilderData): data is FaqListData {
  return isObject(data) && !('type' in data) && Array.isArray((data as Record<string, unknown>).groups)
}
