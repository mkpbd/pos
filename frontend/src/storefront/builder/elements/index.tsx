import type { ReactNode } from 'react'
import type { RenderElement } from '../types'
import { isB4Type, type B4Type } from './b4-types'
import { ContactFormElement, FaqListElement } from './content'
import { CountdownElement, CtaElement, DiscountElement, NewsletterFormElement, PromoCardElement } from './marketing'
import { CustomHtmlElement, IconElement, VideoElement } from './media'
import {
  AccountLinkElement,
  AnnouncementElement,
  CartIconElement,
  ContactBlockElement,
  CopyrightElement,
  LanguageSwitchElement,
  LogoElement,
  MenuElement,
  PaymentIconsElement,
  SearchBoxElement,
  SocialIconsElement,
  WishlistLinkElement,
} from './site'

/*
 * Renderers of the B4 elements (contract §2), reusing the storefront's own components. Each draws
 * its root with `data-b={id}` (compiled styles and the editor canvas find it there). Exported for
 * the editor canvas, which renders documents through PageRenderer.
 */

export { CouponCode } from './marketing'


const RENDERERS: { [T in B4Type]: (props: { element: Extract<RenderElement, { type: T }> }) => ReactNode } = {
  video: VideoElement,
  icon: IconElement,
  countdown: CountdownElement,
  discount: DiscountElement,
  cta: CtaElement,
  search_box: SearchBoxElement,
  promo_card: PromoCardElement,
  logo: LogoElement,
  menu: MenuElement,
  account_link: AccountLinkElement,
  wishlist_link: WishlistLinkElement,
  cart_icon: CartIconElement,
  language_switch: LanguageSwitchElement,
  announcement: AnnouncementElement,
  social_icons: SocialIconsElement,
  payment_icons: PaymentIconsElement,
  contact_block: ContactBlockElement,
  copyright: CopyrightElement,
  newsletter_form: NewsletterFormElement,
  faq_list: FaqListElement,
  contact_form: ContactFormElement,
  custom_html: CustomHtmlElement,
}

/** One B4 element (the caller has checked its visibility). */
export function B4ElementContent({ element }: { element: RenderElement }) {
  if (!isB4Type(element.type)) return null
  const Render = RENDERERS[element.type] as (props: { element: RenderElement }) => ReactNode
  return <Render element={element} />
}
