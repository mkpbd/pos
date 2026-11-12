/*
 * Visual store builder, document format v1 (STORE_BUILDER_PLAN §4, B1 contract §1) and the render
 * payload of GET /api/v1/store/builder/pages/{home|slug} (contract §2). The backend's
 * BuilderDocumentSchema::normalize is the source of truth; ./validate.ts mirrors its value rules.
 */

import type { FaqGroup, MediaRef, ProductCard, StoreSection, StorefrontMenu, ThemeColors } from '../types'

export type Breakpoint = 'base' | 'tablet' | 'mobile'
export type Device = 'desktop' | 'tablet' | 'mobile'

/* ----------------------------------------------------------------------------------------------
 * Style values (sparse overrides; normalize drops unknown/invalid keys and never fills defaults)
 * -------------------------------------------------------------------------------------------- */

export type ThemeColorRole = keyof ThemeColors
/** `#rrggbb`, `#rrggbbaa` (lower case) or `theme:<role>`. */
export type Color = string
/** `^-?\d{1,4}(\.\d{1,2})?(px|rem|em|%|vh|vw)$`, bounded; `auto` for margins only. */
export type Length = string

export type GradientStop = { color: Color; position: number }
export type Gradient = { type: 'linear' | 'radial'; angle?: number; shape?: 'circle' | 'ellipse'; stops: GradientStop[] }

export type BackgroundPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type Background = {
  type: 'none' | 'color' | 'gradient' | 'image'
  color?: Color
  gradient?: Gradient
  image?: { media_id: string; position: BackgroundPosition; size: 'cover' | 'contain' | 'auto'; repeat: boolean }
  overlay?: Color | Gradient
}

export type Typography = {
  font?: 'theme:heading' | 'theme:body'
  size?: Length
  weight?: number
  line_height?: number
  letter_spacing?: Length
  align?: 'left' | 'center' | 'right' | 'justify'
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}

export type Sides = { top?: Length; right?: Length; bottom?: Length; left?: Length }

export type Shadow = { x: number; y: number; blur: number; spread: number; color: Color; inset: boolean }

export type Style = {
  background?: Background
  color?: Color
  typography?: Typography
  spacing?: { margin?: Sides; padding?: Sides }
  size?: { width?: Length; height?: Length; min_height?: Length; max_width?: Length }
  layout?: {
    gap?: Length
    row_gap?: Length
    align?: 'start' | 'center' | 'end' | 'stretch'
    justify?: 'start' | 'center' | 'end' | 'between' | 'around'
    wrap?: boolean
  }
  border?: {
    width?: Length
    style?: 'none' | 'solid' | 'dashed' | 'dotted'
    color?: Color
    radius?: { tl?: Length; tr?: Length; br?: Length; bl?: Length }
  }
  effects?: {
    shadow?: Shadow[]
    text_shadow?: Shadow[]
    opacity?: number
    hover?: { color?: Color; background_color?: Color; shadow?: Shadow[]; transform?: 'none' | 'lift' | 'grow' }
  }
}

export type ResponsiveStyle = Partial<Record<Breakpoint, Style>>

/* ----------------------------------------------------------------------------------------------
 * Nodes
 * -------------------------------------------------------------------------------------------- */

export type Visibility = Record<Device, boolean>
export type Schedule = null | { starts_at: string | null; ends_at: string | null }
export type Link = null | { url: string }

/** Common to sections and elements. */
type NodeCommon = {
  id: string
  style: ResponsiveStyle
  visibility: Visibility
  hidden: boolean
  schedule: Schedule
  translations: Record<string, Record<string, string>>
}

export type Column<E = Element> = {
  id: string
  type: 'column'
  /** Percent of the row (5–100, ≤ 2 decimals); tablet and mobile fall back to the wider breakpoint. */
  width: { base: number; tablet?: number; mobile?: number }
  style: ResponsiveStyle
  elements: E[]
}

export type WrappedSectionType = StoreSection['type']

export type WrappedSectionProps = {
  title: string | null
  subtitle: string | null
  config: Record<string, unknown>
  items: { item_type: string; item_id: string }[]
}

type ElementOf<T extends string, P> = NodeCommon & { type: T; props: P }

export type HeadingElement = ElementOf<'heading', { text: string; level: 1 | 2 | 3 | 4 | 5 | 6; link: Link }>
export type TextElement = ElementOf<'text', { html: string }>
export type ImageElement = ElementOf<
  'image',
  { media_id: string | null; alt: string; link: Link; aspect: 'auto' | '1:1' | '4:3' | '3:2' | '16:9' | '3:4'; fit: 'cover' | 'contain' }
>
export type ButtonElement = ElementOf<
  'button',
  { label: string; link: { url: string }; variant: 'primary' | 'accent' | 'outline' | 'link'; size: 'sm' | 'md' | 'lg'; full_width: boolean }
>
export type SpacerElement = ElementOf<'spacer', Record<string, never>>
export type DividerElement = ElementOf<
  'divider',
  { line: 'solid' | 'dashed' | 'dotted'; thickness: number; width: number; color: Color; align: 'left' | 'center' | 'right' }
>
export type InnerRowElement = ElementOf<'inner_row', Record<string, never>> & { columns: Column<Exclude<Element, InnerRowElement>>[] }
export type WrappedElement = NodeCommon & { type: WrappedSectionType; props: WrappedSectionProps }

/* B4 elements (contract §2). Text props marked ✱ in the contract are translatable (registry `translatable`). */

export type VideoProvider = 'youtube' | 'vimeo'
export type VideoAspect = '16:9' | '4:3' | '1:1' | '9:16'
/** `provider` and `video_id` are derived from `url` by normalize (validate.ts `parseVideoUrl` mirrors it). */
export type VideoElement = ElementOf<
  'video',
  { url: string; provider: VideoProvider; video_id: string; title: string; aspect: VideoAspect; autoplay: boolean; start: number }
>
/** `name` ∈ ICON_NAMES (./icons.tsx); `label` empty = decorative; `size` in px (16–128). */
export type IconElement = ElementOf<'icon', { name: string; size: number; color: Color | null; label: string; link: Link }>
export type CountdownElement = ElementOf<
  'countdown',
  {
    source: 'date' | 'promotion'
    /** ISO date-time (date source). */
    ends_at: string | null
    /** An organization countdown promotion (promotion source). */
    promotion_id: string | null
    title: string
    /** Shown once the time is up; empty = the element disappears. */
    expired_text: string
    style: 'boxes' | 'inline'
  }
>
export type DiscountElement = ElementOf<'discount', { promotion_id: string | null; title: string; text: string; show_code: boolean; button_label: string; link: Link }>
export type CtaButton = { label: string; link: { url: string } }
export type CtaElement = ElementOf<'cta', { title: string; text: string; primary: CtaButton; secondary: CtaButton | null; align: 'left' | 'center' | 'right' }>
export type SearchBoxElement = ElementOf<'search_box', { placeholder: string; button_label: string }>
/** `title` null = the product's name. */
export type PromoCardElement = ElementOf<'promo_card', { product_id: string | null; badge: string; title: string | null; text: string; button_label: string }>
export type LogoElement = ElementOf<'logo', { height: number; link: Link }>
/** `show_children`: none | dropdown | mega (header), none | list (footer). */
export type MenuElement = ElementOf<'menu', { menu_id: string | null; layout: 'horizontal' | 'vertical'; show_children: 'none' | 'dropdown' | 'mega' | 'list' }>
export type AccountLinkElement = ElementOf<'account_link', { show_label: boolean }>
export type WishlistLinkElement = ElementOf<'wishlist_link', { show_label: boolean }>
export type CartIconElement = ElementOf<'cart_icon', { show_count: boolean; show_total: boolean }>
export type LanguageSwitchElement = ElementOf<'language_switch', { style: 'links' | 'select' }>
/** The theme's announcement (text, link, colours, schedule). */
export type AnnouncementElement = ElementOf<'announcement', Record<string, never>>
export type SocialIconsElement = ElementOf<'social_icons', { size: number; style: 'plain' | 'circle' | 'square'; color: Color | null }>
export type PaymentIconsElement = ElementOf<'payment_icons', { height: number }>
export type ContactBlockElement = ElementOf<'contact_block', { show_phone: boolean; show_email: boolean; show_address: boolean; layout: 'stacked' | 'inline' }>
/** `text` null = the theme's footer copyright; `{year}` becomes the current year. */
export type CopyrightElement = ElementOf<'copyright', { text: string | null }>
export type NewsletterFormElement = ElementOf<'newsletter_form', { title: string; text: string; button_label: string; layout: 'stacked' | 'inline' }>
export type FaqListElement = ElementOf<'faq_list', { title: string | null; style: 'accordion' | 'list' }>
export type ContactFormElement = ElementOf<'contact_form', { title: string | null; show_details: boolean }>
/** Server-sanitized HTML (≤ 20 000 characters); adding or changing one needs `storefront.custom_html`. */
export type CustomHtmlElement = ElementOf<'custom_html', { html: string }>

export type B4Element =
  | VideoElement
  | IconElement
  | CountdownElement
  | DiscountElement
  | CtaElement
  | SearchBoxElement
  | PromoCardElement
  | LogoElement
  | MenuElement
  | AccountLinkElement
  | WishlistLinkElement
  | CartIconElement
  | LanguageSwitchElement
  | AnnouncementElement
  | SocialIconsElement
  | PaymentIconsElement
  | ContactBlockElement
  | CopyrightElement
  | NewsletterFormElement
  | FaqListElement
  | ContactFormElement
  | CustomHtmlElement

export type Element = HeadingElement | TextElement | ImageElement | ButtonElement | SpacerElement | DividerElement | InnerRowElement | WrappedElement | B4Element

export type ElementType = Element['type']

export type Section = NodeCommon & {
  type: 'section'
  props: { layout: 'boxed' | 'full' | 'full-bleed'; anchor: string | null }
  columns: Column[]
}

/** A stored document (draft or published version content). */
export type BuilderDocument = { schema_version: 1; sections: Section[] }

/** The editor's names (B2): the whole draft, and any node of it (section, column or element). */
export type BuilderContent = BuilderDocument
export type BuilderNode = Section | Column | Element

/* ----------------------------------------------------------------------------------------------
 * Render payload
 * -------------------------------------------------------------------------------------------- */

/** Draft preview only: why a node is not shown to visitors. */
export type NodeState = 'hidden' | 'scheduled' | 'expired' | 'empty'

/** A document node as rendered: translations resolved and removed; `state` only in draft previews. */
type Rendered<N> = N extends unknown ? Omit<N, 'translations' | 'hidden' | 'schedule'> & { hidden?: boolean; schedule?: Schedule; state?: NodeState } : never

export type RenderColumn = Omit<Column, 'elements'> & { elements: RenderElement[] }
export type RenderInnerRow = Rendered<Omit<InnerRowElement, 'columns'>> & { columns: RenderColumn[] }
export type RenderElement = Rendered<Exclude<Element, InnerRowElement>> | RenderInnerRow
export type RenderSection = Rendered<Omit<Section, 'columns'>> & { columns: RenderColumn[] }

export type BuilderMedia = Omit<MediaRef, 'id'>

/** Draft preview only: why a data element would not show to visitors (public payloads drop the element instead). */
export type ElementDataState = 'expired' | 'inactive' | 'unavailable'

/** `data[id]` of a countdown: the end (the date, or the promotion's end) and the promotion when it is one. */
export type CountdownData = { ends_at: string | null; title?: string | null; promotion: { id: string; name: string } | null; state?: ElementDataState }
/** `data[id]` of a discount. Amounts are decimal strings; `coupon_code` only when the element shows the code. */
export type DiscountData = {
  name: string
  kind: 'percent' | 'fixed'
  value: string
  coupon_code: string | null
  min_subtotal: string | null
  ends_at: string | null
  state?: ElementDataState
}
/** `data[id]` of a promo card: the storefront product card (catalog listing shape). */
export type PromoCardData = ProductCard & { state?: ElementDataState }
/** `data[id]` of a menu: the menu tree as bootstrap serves menus. */
export type MenuData = StorefrontMenu & { state?: ElementDataState }
/** `data[id]` of an FAQ list: the CMS FAQ items by group (the shape of /store/pages/{slug} `faq`). */
export type FaqListData = { groups: FaqGroup[]; state?: ElementDataState }

export type ElementData = CountdownData | DiscountData | PromoCardData | MenuData | FaqListData

/** One entry of a payload's `data` map. */
export type BuilderData = StoreSection | ElementData

export type BuilderPage = {
  document: { id: string; key: string; title: string; version: number | null; source: 'published' | 'draft' }
  sections: RenderSection[]
  media: Record<string, BuilderMedia>
  /**
   * For each wrapped-section element: the object /store/homepage returns for that section (id =
   * element id). B4: for countdown, discount, promo_card, menu and faq_list elements, their data.
   */
  data: Record<string, BuilderData>
}

/* ----------------------------------------------------------------------------------------------
 * B4: document contexts, zones and the bootstrap's builder block
 * -------------------------------------------------------------------------------------------- */

/** Where an element may be used (registry `allowed_in`): home / landing pages, CMS pages, header, footer, zones. */
export type DocumentContext = 'page' | 'cms' | 'header' | 'footer' | 'zone'

export type ZoneKey = 'listing.top' | 'listing.bottom' | 'product.after'

export const ZONE_KEYS = ['listing.top', 'listing.bottom', 'product.after'] as const satisfies readonly ZoneKey[]

/** bootstrap `builder`: published documents (staff `?preview=draft`: drafts); null / absent = the classic rendering. */
export type BootstrapBuilder = {
  home: boolean
  header?: BuilderPage | null
  footer?: BuilderPage | null
  zones?: Partial<Record<ZoneKey, BuilderPage | null>>
}
