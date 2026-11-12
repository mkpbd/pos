import type {
  BuilderData,
  BundleData,
  CategoryCardData,
  ChartStoreData,
  ComparisonTableData,
  CountdownData,
  DiscountData,
  FaqListData,
  FlashSaleBarData,
  MenuData,
  ProductSpotlightData,
  PromoCardData,
  ReviewWallData,
  ShopTheLookData,
  StoreHoursData,
} from '../types'
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

/* B6 */

export function isCategoryCardData(data: BuilderData): data is CategoryCardData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && typeof d.name === 'string' && typeof d.url === 'string' && 'product_count' in d
}

export function isProductSpotlightData(data: BuilderData): data is ProductSpotlightData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && typeof d.slug === 'string' && typeof d.name === 'string' && Array.isArray(d.images) && Array.isArray(d.variants) && Array.isArray(d.options)
}

export function isShopTheLookData(data: BuilderData): data is ShopTheLookData {
  return isObject(data) && !('type' in data) && isObject((data as Record<string, unknown>).products)
}

/* B8a */

function productsMap(value: unknown): boolean {
  return isObject(value) || (Array.isArray(value) && value.length === 0)
}

export function isComparisonTableData(data: BuilderData): data is ComparisonTableData {
  return isObject(data) && !('type' in data) && productsMap((data as Record<string, unknown>).products) && !('promotion' in data) && !('reviews' in data)
}

export function isFlashSaleBarData(data: BuilderData): data is FlashSaleBarData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && isObject(d.promotion) && typeof (d.promotion as Record<string, unknown>).id === 'string' && Array.isArray(d.products)
}

export function isBundleData(data: BuilderData): data is BundleData {
  return isObject(data) && !('type' in data) && productsMap((data as Record<string, unknown>).products)
}

export function isReviewWallData(data: BuilderData): data is ReviewWallData {
  return isObject(data) && !('type' in data) && Array.isArray((data as Record<string, unknown>).reviews)
}

export function isStoreHoursData(data: BuilderData): data is StoreHoursData {
  return isObject(data) && !('type' in data) && typeof (data as Record<string, unknown>).timezone === 'string'
}

/** A store-source chart's counts (`labels` + one series). */
export function isChartStoreData(data: BuilderData): data is ChartStoreData {
  const d = data as Record<string, unknown>
  return isObject(data) && !('type' in data) && Array.isArray(d.labels) && Array.isArray(d.series)
}
