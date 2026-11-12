import type { ReactNode } from 'react'
import type { RenderElement } from '../types'
import { isB8aType, type B8aType } from './b8a-types'
import { ReviewWallElement, StoreHoursElement, TeamElement, PhotoGridElement } from './b8a-people'
import { BeforeAfterElement, BundleElement, ComparisonTableElement, FlashSaleBarElement, PricingTableElement } from './b8a-selling'
import { ProgressBarsElement } from './progress-bars'

/*
 * Renderers of the B8a elements (contract §1). Each draws its root with `data-b={id}`. Progress
 * bars are drawn by ./progress-bars (the chart agent's slot).
 */

const RENDERERS: { [T in B8aType]: (props: { element: Extract<RenderElement, { type: T }> }) => ReactNode } = {
  pricing_table: PricingTableElement,
  before_after: BeforeAfterElement,
  comparison_table: ComparisonTableElement,
  flash_sale_bar: FlashSaleBarElement,
  bundle: BundleElement,
  team: TeamElement,
  review_wall: ReviewWallElement,
  photo_grid: PhotoGridElement,
  store_hours: StoreHoursElement,
  progress_bars: ProgressBarsElement,
}

/** One B8a element (the caller has checked its visibility). */
export function B8aElementContent({ element }: { element: RenderElement }) {
  if (!isB8aType(element.type)) return null
  const Render = RENDERERS[element.type] as (props: { element: RenderElement }) => ReactNode
  return <Render element={element} />
}
