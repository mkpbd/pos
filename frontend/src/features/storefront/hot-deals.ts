import { useCan } from '@/features/auth/use-auth'
import { usePromotionsQuery, type PromotionListParams, type PromotionRow } from '@/features/promotions/api'
import type { SectionConfigs } from '@/features/storefront/api'
import { isSafeLink } from '@/features/storefront/menu-tree'

export type HotDealsConfig = SectionConfigs['hot_deals']

export const HOT_DEALS_LIMIT = { min: 4, max: 12 } as const

/** Active promotions offered by the hot-deals picker (filtered to countdown ones on the client). */
export const ACTIVE_PROMOTIONS_PARAMS: PromotionListParams = { page: 1, per_page: 100, status: 'active' }

/**
 * Flash sales: promotions showing a countdown. Rows from an API that does not send
 * `show_countdown` fall back to the conditions a countdown needs.
 */
export function isFlashSale(p: PromotionRow): boolean {
  if (typeof p.show_countdown === 'boolean') return p.show_countdown
  return p.trigger === 'automatic' && p.type !== 'free_shipping' && p.scope !== 'order' && p.ends_at !== null
}

/** Client checks, keyed like the API's validation errors. */
export function validateHotDeals(c: HotDealsConfig): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!Number.isInteger(c.limit) || c.limit < HOT_DEALS_LIMIT.min || c.limit > HOT_DEALS_LIMIT.max) errors['config.limit'] = `Between ${HOT_DEALS_LIMIT.min} and ${HOT_DEALS_LIMIT.max}.`
  if (c.view_all_url && !isSafeLink(c.view_all_url)) errors['config.view_all_url'] = 'Use a site path such as /shop or an http(s) URL.'
  return errors
}

export function normalizeHotDeals(c: HotDealsConfig): HotDealsConfig {
  return { promotion_id: c.promotion_id || null, limit: c.limit, view_all_url: c.view_all_url?.trim() || null }
}

/** Active flash sales for the picker and the row summary; only fetched for staff who may see promotions. */
export function useFlashSales(): { items: PromotionRow[]; allowed: boolean; isPending: boolean; error: Error | null } {
  const can = useCan()
  const allowed = can('promotions.view')
  const query = usePromotionsQuery(ACTIVE_PROMOTIONS_PARAMS, allowed)
  return { items: (query.data?.items ?? []).filter(isFlashSale), allowed, isPending: allowed && query.isPending, error: query.error }
}
