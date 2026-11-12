import type { ReactNode } from 'react'
import type { RenderElement } from '../types'
import { isB6Type, type B6Type } from './b6-types'
import { AccordionElement, CounterElement, IconBoxElement, IconListElement, NoticeElement, QuoteElement, StepsElement, TabsElement, TrustBadgesElement } from './b6-content'
import { GalleryElement, ImageCarouselElement, LogoCarouselElement, MapElement, MarqueeElement } from './b6-media'
import { CategoryCardElement, ProductSpotlightElement, RecentlyViewedElement, ShopTheLookElement } from './b6-shop'
import { ChartElement } from './chart'

/*
 * Renderers of the B6 elements (contract §1). Each draws its root with `data-b={id}`; the chart
 * is drawn by ./chart (its own lazily loaded chunk).
 */

const RENDERERS: { [T in B6Type]: (props: { element: Extract<RenderElement, { type: T }> }) => ReactNode } = {
  accordion: AccordionElement,
  tabs: TabsElement,
  icon_box: IconBoxElement,
  icon_list: IconListElement,
  quote: QuoteElement,
  notice: NoticeElement,
  counter: CounterElement,
  steps: StepsElement,
  chart: ChartElement,
  gallery: GalleryElement,
  image_carousel: ImageCarouselElement,
  logo_carousel: LogoCarouselElement,
  map: MapElement,
  category_card: CategoryCardElement,
  product_spotlight: ProductSpotlightElement,
  shop_the_look: ShopTheLookElement,
  trust_badges: TrustBadgesElement,
  recently_viewed: RecentlyViewedElement,
  marquee: MarqueeElement,
}

/** One B6 element (the caller has checked its visibility). */
export function B6ElementContent({ element }: { element: RenderElement }) {
  if (!isB6Type(element.type)) return null
  const Render = RENDERERS[element.type] as (props: { element: RenderElement }) => ReactNode
  return <Render element={element} />
}
