/*
 * Visual store builder, document format v1 (STORE_BUILDER_PLAN §4, B1 contract §1) and the render
 * payload of GET /api/v1/store/builder/pages/{home|slug} (contract §2). The backend's
 * BuilderDocumentSchema::normalize is the source of truth; ./validate.ts mirrors its value rules.
 */

import type { CatalogImage, FaqGroup, MediaRef, ProductCard, ProductDetail, ShippingMethod, StoreSection, StorefrontMenu, ThemeColors } from '../types'

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
  /**
   * B6: a muted, looping YouTube / Vimeo video behind a section's (or inner row's) content. `url`
   * goes through parseVideoUrl like the video element; normalize derives `provider` and
   * `video_id`. The poster shows first, and alone under reduced motion, Save-Data and below 768 px.
   * Read from the `base` breakpoint only.
   */
  video?: BackgroundVideo
}

/** B6 `background.video` (sections and inner rows). */
/** `poster` is absent when none was chosen (never null). Kept on the `base` breakpoint of sections and inner rows only. */
export type BackgroundVideo = { url: string; provider: VideoProvider; video_id: string; poster?: { media_id: string } }

/** B6 style group `motion` (any node, `base` only): an entrance animation played once on entering the viewport. */
export type MotionEntrance = 'none' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'zoom'
/** `duration` 200–2000 ms (default 600), `delay` 0–2000 ms (default 0). */
export type Motion = { entrance: MotionEntrance; duration?: number; delay?: number }

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
  /** B6: `base` breakpoint only (normalize drops it from tablet / mobile). */
  motion?: Motion
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
/**
 * B8b `action` (context popup only; absent = link — the server normalizes `link` to absent):
 * `dismiss` closes the popup it sits in (and counts as the visitor's action for
 * `stop_after_action`); its `link` stays required but is not followed.
 */
export type ButtonAction = 'link' | 'dismiss'
export type ButtonElement = ElementOf<
  'button',
  { label: string; link: { url: string }; variant: 'primary' | 'accent' | 'outline' | 'link'; size: 'sm' | 'md' | 'lg'; full_width: boolean; action?: ButtonAction }
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

/* ----------------------------------------------------------------------------------------------
 * B6 elements (contract §1). ✱ text props are translatable; an item field is translated under
 * `<list>.<item_id>.<field>` (registry `translatable` spells it `<list>.*.<field>`).
 * -------------------------------------------------------------------------------------------- */

/** Every list item carries an id (`^[a-z][a-z0-9_-]{1,31}$`), unique within its list. */
export type AccordionItem = { id: string; title: string; html: string }
export type AccordionElement = ElementOf<'accordion', { items: AccordionItem[]; open_first: boolean; allow_multiple: boolean; style: 'plain' | 'boxed' }>

export type TabItem = { id: string; title: string; html: string }
export type TabsElement = ElementOf<'tabs', { items: TabItem[]; layout: 'horizontal' | 'vertical' }>

export type IconBoxElement = ElementOf<
  'icon_box',
  { icon: string; title: string; text: string; link: Link; layout: 'top' | 'left'; icon_style: 'plain' | 'circle' | 'square' }
>

export type IconListItem = { id: string; icon: string; text: string; link: Link }
export type IconListElement = ElementOf<'icon_list', { items: IconListItem[]; layout: 'vertical' | 'inline' }>

export type QuoteElement = ElementOf<'quote', { text: string; author: string; role: string; style: 'plain' | 'card' | 'large' }>

export type NoticeTone = 'info' | 'success' | 'warning' | 'promo'
export type NoticeElement = ElementOf<'notice', { tone: NoticeTone; title: string; text: string; show_icon: boolean }>

/** `value` 0–1e9 with at most two decimals; `prefix` ≤ 4 (not translated), `suffix` ✱ ≤ 8, `label` ✱ ≤ 60. */
export type CounterItem = { id: string; value: number; prefix: string; suffix: string; label: string }
export type CounterElement = ElementOf<'counter', { items: CounterItem[]; animate: boolean }>

export type StepItem = { id: string; title: string; text: string; icon: string | null }
export type StepsElement = ElementOf<'steps', { items: StepItem[]; layout: 'horizontal' | 'vertical'; numbered: boolean }>

/* Chart (contract §3; drawn by ./elements/chart). */
/** B8a: `stacked-column` / `stacked-bar` (2–6 series, every value ≥ 0). */
export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'pie' | 'donut' | 'stacked-column' | 'stacked-bar'
/**
 * B8a chart data source: `manual` (the authored labels / series) or a store count the server
 * resolves into `data[id]` (ChartStoreData): top-level categories' product counts, or approved
 * reviews per star (all products, or `source_product_id`).
 */
export type ChartDataSource = 'manual' | 'store.products_per_category' | 'store.rating_breakdown'
export type ChartSeries = { id: string; name: string; values: number[] }
export type ChartUnitPosition = 'before' | 'after'
export type ChartShowValues = 'none' | 'last' | 'all-small'
export type ChartProps = {
  kind: ChartKind
  title: string
  /** Shown under the title; also the figure caption. */
  description: string
  /** Category names, 1–24, each ≤ 40 (✱ `labels.<index>`). */
  labels: string[]
  /** 1–6 series (pie / donut: exactly one, ≤ 8 labels); `values` as long as `labels`. */
  series: ChartSeries[]
  /** ≤ 8 characters ("৳", "%", "pcs"). */
  unit: string
  unit_position: ChartUnitPosition
  y_starts_at_zero: boolean
  show_values: ChartShowValues
  show_legend: boolean
  show_table: boolean
  /** px, 200–600. */
  height: number
  /** B8a: normalize always fills it (`manual` for older documents). A store source is never stacked. */
  data_source: ChartDataSource
  /** B8a: `store.rating_breakdown` only — one product's reviews (null = all products); null for every other source. */
  source_product_id: string | null
}
/** The chart element node (the renderer component is elements/chart's `ChartElement`). */
export type ChartElementNode = ElementOf<'chart', ChartProps>

export type GalleryAspect = 'square' | '4:3' | '3:4' | '16:9' | 'auto'
export type GalleryImage = { id: string; media_id: string; alt: string; caption: string }
/** `columns.base` 2–6; tablet / mobile fall back to the wider breakpoint. */
export type GalleryColumns = { base: number; tablet?: number; mobile?: number }
export type GalleryElement = ElementOf<'gallery', { images: GalleryImage[]; columns: GalleryColumns; aspect: GalleryAspect; lightbox: boolean; gap: 'sm' | 'md' | 'lg' }>

export type CarouselImage = { id: string; media_id: string; alt: string; caption: string; link: Link }
/** `autoplay` in seconds (0 = off, ≤ 15). */
export type ImageCarouselElement = ElementOf<'image_carousel', { images: CarouselImage[]; autoplay: number; show_dots: boolean; show_arrows: boolean; aspect: GalleryAspect }>

export type MotionSpeed = 'slow' | 'normal' | 'fast'
export type LogoItem = { id: string; media_id: string; alt: string; link: Link }
export type LogoCarouselElement = ElementOf<'logo_carousel', { logos: LogoItem[]; grayscale: boolean; speed: MotionSpeed }>

/** `query`: an address or "lat,lng"; `height` px 200–600; `zoom` 3–20. Google Maps loads only after a click. */
export type MapElement = ElementOf<'map', { query: string; title: string; height: number; zoom: number }>

/** `title` null = the category's name; `media_id` overrides the category image. */
export type CategoryCardElement = ElementOf<
  'category_card',
  { category_id: string | null; media_id: string | null; title: string | null; button_label: string; layout: 'overlay' | 'below' }
>
export type ProductSpotlightElement = ElementOf<'product_spotlight', { product_id: string | null; layout: 'image-left' | 'image-right'; show_description: boolean; badge: string }>

/** `x` / `y` in percent of the image (0–100, ≤ 2 decimals). */
export type Hotspot = { id: string; x: number; y: number; product_id: string }
export type ShopTheLookElement = ElementOf<'shop_the_look', { media_id: string | null; alt: string; title: string; hotspots: Hotspot[] }>

export type TrustBadgeItem = { id: string; icon: string; title: string; text: string }
export type TrustBadgesElement = ElementOf<'trust_badges', { items: TrustBadgeItem[]; style: 'row' | 'grid' }>

/** Client-side only: this browser's recently viewed products (hidden when there are none). `limit` 4–12. */
export type RecentlyViewedElement = ElementOf<'recently_viewed', { title: string; limit: number }>

export type MarqueeItem = { id: string; text: string }
export type MarqueeSeparator = 'dot' | 'star' | 'leaf' | 'none'
export type MarqueeElement = ElementOf<'marquee', { items: MarqueeItem[]; speed: MotionSpeed; direction: 'left' | 'right'; separator: MarqueeSeparator }>

/* ----------------------------------------------------------------------------------------------
 * B8a elements (contract §1): selling blocks, trust & people, progress bars. ✱ text props are
 * translatable (`<list>.<item_id>.<field>` for list items; nested lists
 * `plans.<plan_id>.features.<feature_id>.text`). Money values are NUMERIC strings ("1250.00").
 * -------------------------------------------------------------------------------------------- */

/** B8a buttons: a label and a link target (site path or http(s) URL), flat — unlike the B4 `CtaButton`. */
export type B8aButton = { label: string; url: string }
/** A feature row of a plan: shown with an icon and "Included" / "Not included" text, never colour alone. */
export type PricingFeature = { id: string; text: string; included: boolean }
/** `price` null = show `price_text` ("Free", "Ask us"); money as a NUMERIC string (≥ 0, ≤ 2 decimals). */
export type PricingPlan = {
  id: string
  name: string
  price: string | null
  price_text: string
  period: string
  description: string
  features: PricingFeature[]
  button: B8aButton | null
  highlighted: boolean
  badge: string
}
export type PricingTableElement = ElementOf<'pricing_table', { plans: PricingPlan[] }>

export type BeforeAfterImage = { media_id: string | null; alt: string }
export type BeforeAfterAspect = '1:1' | '4:3' | '3:2' | '16:9'
export type BeforeAfterElement = ElementOf<
  'before_after',
  {
    before: BeforeAfterImage
    after: BeforeAfterImage
    before_label: string
    after_label: string
    /** Handle position in percent (0–100). */
    start: number
    orientation: 'horizontal' | 'vertical'
    aspect: BeforeAfterAspect
  }
>

export type ComparisonColumn = { id: string; title: string; product_id: string | null; highlighted: boolean }
export type ComparisonCellKind = 'yes' | 'no' | 'text'
export type ComparisonCell = { kind: ComparisonCellKind; text: string }
/** `cells` has one entry per column id (normalize fills a missing one with `{kind: 'no', text: ''}`). */
export type ComparisonRow = { id: string; label: string; cells: Record<string, ComparisonCell> }
export type ComparisonTableElement = ElementOf<'comparison_table', { columns: ComparisonColumn[]; rows: ComparisonRow[]; show_prices: boolean; show_buttons: boolean }>

export type FlashSaleBarElement = ElementOf<
  'flash_sale_bar',
  {
    /** null = the active countdown promotion that ends soonest. */
    promotion_id: string | null
    title: string
    text: string
    show_products: boolean
    /** 2–8. */
    product_limit: number
    style: 'bar' | 'card'
    button: B8aButton | null
  }
>

export type BundleItem = { id: string; product_id: string }
export type BundleElement = ElementOf<'bundle', { items: BundleItem[]; title: string; text: string; button_label: string }>

export type TeamLinkKind = 'facebook' | 'instagram' | 'linkedin' | 'x' | 'youtube' | 'tiktok' | 'website' | 'email'
/** `email` links are `mailto:<address>` (no query); `website` an absolute http(s) URL; social kinds https only; ≤ 255 characters. */
export type TeamLink = { id: string; kind: TeamLinkKind; url: string }
/** `name` is not translated (a person's name); `role` ✱ and `bio` ✱ are. */
export type TeamMember = { id: string; media_id: string | null; name: string; role: string; bio: string; links: TeamLink[] }
/** `columns.base` 2–4; tablet / mobile fall back to the wider breakpoint. */
export type TeamColumns = { base: number; tablet?: number; mobile?: number }
export type TeamStyle = 'card' | 'plain' | 'circle'
export type TeamElement = ElementOf<'team', { members: TeamMember[]; columns: TeamColumns; style: TeamStyle }>

export type ReviewWallSource = 'latest' | 'top_rated' | 'product'
export type ReviewWallElement = ElementOf<
  'review_wall',
  {
    source: ReviewWallSource
    /** Required for `source: product`. */
    product_id: string | null
    /** 1–5 (default 4). */
    min_rating: number
    /** 3–12. */
    limit: number
    layout: 'grid' | 'carousel'
    show_product: boolean
    show_summary: boolean
    title: string
  }
>

export type PhotoGridImage = { id: string; media_id: string; alt: string; link: Link }
/** `columns.base` 3–6. */
export type PhotoGridColumns = { base: number; tablet?: number; mobile?: number }
export type PhotoGridElement = ElementOf<
  'photo_grid',
  { images: PhotoGridImage[]; columns: PhotoGridColumns; gap: 'none' | 'sm' | 'md'; profile: { label: string; url: string } | null; hover: 'none' | 'zoom' | 'overlay' }
>

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
/** `open` / `close` "HH:MM" (24 h); `close` before `open` = closes after midnight. */
export type StoreHoursDay = { day: WeekDay; closed: boolean; open: string; close: string }
export type StoreHoursElement = ElementOf<
  'store_hours',
  {
    /** Exactly 7, Monday first (week order); `week_starts` only changes the display order. */
    days: StoreHoursDay[]
    title: string
    note: string
    show_open_now: boolean
    highlight_today: boolean
    week_starts: 'sat' | 'sun' | 'mon'
  }
>

/** `value` 0–100 with at most one decimal. */
export type ProgressItem = { id: string; label: string; value: number }
export type ProgressBarsProps = { items: ProgressItem[]; style: 'bar' | 'ring'; show_value: boolean; animate: boolean }
export type ProgressBarsElement = ElementOf<'progress_bars', ProgressBarsProps>

export type B8aElement =
  | PricingTableElement
  | BeforeAfterElement
  | ComparisonTableElement
  | FlashSaleBarElement
  | BundleElement
  | TeamElement
  | ReviewWallElement
  | PhotoGridElement
  | StoreHoursElement
  | ProgressBarsElement

export type B6Element =
  | AccordionElement
  | TabsElement
  | IconBoxElement
  | IconListElement
  | QuoteElement
  | NoticeElement
  | CounterElement
  | StepsElement
  | ChartElementNode
  | GalleryElement
  | ImageCarouselElement
  | LogoCarouselElement
  | MapElement
  | CategoryCardElement
  | ProductSpotlightElement
  | ShopTheLookElement
  | TrustBadgesElement
  | RecentlyViewedElement
  | MarqueeElement

/* ----------------------------------------------------------------------------------------------
 * B8b: the form element (contract §2). ✱ text is translatable: `title`, `text`, `submit_label`,
 * `success_message`, `consent.text`, `fields.<field_id>.label|placeholder|help`,
 * `fields.<field_id>.options.<option_id>.label`. No file uploads (security).
 * -------------------------------------------------------------------------------------------- */

export type FormFieldKind = 'text' | 'email' | 'phone' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'checkboxes' | 'date'
/** `label` ✱ ≤ 60. */
export type FormFieldOption = { id: string; label: string }
export type FormField = {
  /** `^[a-z][a-z0-9_-]{1,31}$`, unique within the form; the key of the posted value. */
  id: string
  kind: FormFieldKind
  /** ✱ ≤ 80, required. */
  label: string
  /** ✱ ≤ 80. */
  placeholder: string
  /** ✱ ≤ 160. */
  help: string
  required: boolean
  /** select / radio / checkboxes: 2–20 options; [] for the other kinds. */
  options: FormFieldOption[]
  /** number only (null = unbounded); min ≤ max. */
  min: number | null
  max: number | null
  /** text / textarea only: 1–2000 (null = the server default). */
  max_length: number | null
  /** email only: the submission's reply-to address (at most one per form). */
  reply_to: boolean
}
export type FormConsent = { text: string; link: Link }
export type FormProps = {
  /** ✱ ≤ 120 (empty = no heading). */
  title: string
  /** ✱ ≤ 400. */
  text: string
  /** 1–20 fields. */
  fields: FormField[]
  /** ✱ ≤ 30. */
  submit_label: string
  /** ✱ ≤ 300. */
  success_message: string
  /** A required "I agree" checkbox when present (`text` ✱ ≤ 300; `link` to the terms / privacy page). */
  consent: FormConsent | null
  /** An extra recipient of each submission (staff with `forms.view` always get a bell notification). */
  notify_email: string | null
  layout: 'stacked' | 'two_columns'
}
export type FormElement = ElementOf<'form', FormProps>

/** A posted value: text kinds a string, number a number, checkbox a boolean, checkboxes option ids. */
export type FormSubmitValue = string | number | boolean | string[]
/**
 * POST /store/forms/{document_uuid}/{element_id} (202 `{message}`). select / radio values are
 * option ids, checkboxes an array of option ids, checkbox a boolean; '' / absent = unanswered.
 */
export type FormSubmitRequest = { values: Record<string, FormSubmitValue>; consent: boolean; website: string; page_path: string }
export type FormSubmitResponse = { message: string }

export type B8bElement = FormElement

/* ----------------------------------------------------------------------------------------------
 * P2a: the one-product order form (`order_form`, group commerce; page, cms, zone). A cash-on-
 * delivery order straight from a landing page: no cart step, POST /store/checkout/direct.
 * -------------------------------------------------------------------------------------------- */

export type OrderFormEmailField = 'hidden' | 'optional' | 'required'
export type OrderFormNoteField = 'hidden' | 'optional'
export type OrderFormPayment = 'cod_only' | 'store_methods'
/** An optional add-on product the shopper can tick (`label` ✱ ≤ 120). */
export type OrderFormUpsell = { product_id: string; label: string }
export type OrderFormProps = {
  /** The product sold (invalid until set up). */
  product_id: string | null
  /** ✱ ≤ 120 (empty = no heading). */
  title: string
  /** ✱ ≤ 400. */
  text: string
  /** Let the shopper choose the variant (else the default variant is ordered). */
  show_variants: boolean
  /** `default` 1–10, `max` 1–20, default ≤ max. */
  quantity: { default: number; max: number }
  fields: { email: OrderFormEmailField; note: OrderFormNoteField }
  payment: OrderFormPayment
  /** ✱ ≤ 60. */
  button_label: string
  /** ✱ ≤ 400. */
  success_message: string
  upsell: OrderFormUpsell | null
  layout: 'stacked' | 'two_columns'
}
export type OrderFormElement = ElementOf<'order_form', OrderFormProps>

export type Element =
  | HeadingElement
  | TextElement
  | ImageElement
  | ButtonElement
  | SpacerElement
  | DividerElement
  | InnerRowElement
  | WrappedElement
  | B4Element
  | B6Element
  | B8aElement
  | B8bElement
  | OrderFormElement

export type ElementType = Element['type']

/** B6 section shape divider (inline SVG, decorative). `height` px 16–200. */
export type SectionShapeKind = 'wave' | 'curve' | 'tilt' | 'triangle' | 'zigzag'
export type SectionShape = { shape: SectionShapeKind; color: Color; height: number; flip: boolean }

export type SectionProps = {
  layout: 'boxed' | 'full' | 'full-bleed'
  anchor: string | null
  /** B6: sticks below the store header while scrolling (at most one per document; page / cms / zone). Absent (pre-B6) = false. */
  sticky?: boolean
  /** B6: shape dividers at the section's top / bottom edge; absent = null. */
  shape_top?: SectionShape | null
  shape_bottom?: SectionShape | null
}

export type Section = NodeCommon & {
  type: 'section'
  props: SectionProps
  columns: Column[]
}

/* ----------------------------------------------------------------------------------------------
 * B8b: popups & bars (contract §1). A `popup:<uuid>` document's content carries `popup` (validated
 * in context `popup` only; versioned with the content, schedule included). The `active` switch is
 * document-level and not versioned.
 * -------------------------------------------------------------------------------------------- */

export type PopupLayout = 'modal' | 'slide_in' | 'bar_top' | 'bar_bottom' | 'fullscreen'
export type PopupPosition = 'bottom_left' | 'bottom_right'
export type PopupWidth = 'sm' | 'md' | 'lg'
export type PopupTriggerKind = 'on_load' | 'on_scroll' | 'on_exit'
export type PopupFrequencyKind = 'every_page_view' | 'once_per_session' | 'once_every_days' | 'once_forever'
export type PopupPagesKind = 'all' | 'home' | 'shop' | 'paths'
export type PopupDevices = 'all' | 'desktop' | 'mobile'
export type PopupAudience = 'all' | 'guests' | 'signed_in'

export type PopupTrigger = {
  kind: PopupTriggerKind
  /** 0–120 s: on_load's delay; on_exit's fallback on touch devices (default 20). */
  delay_seconds: number
  /** 10–90 (on_scroll). */
  scroll_percent: number
}
/** `days` 1–365 (once_every_days). */
export type PopupFrequency = { kind: PopupFrequencyKind; days: number }
/** `paths`: ≤ 20 site path prefixes (`/p/eid-sale`). Never on /checkout, /cart, /account*, /order*, whatever is set. */
export type PopupPages = { kind: PopupPagesKind; paths: string[] }

export type PopupSettings = {
  layout: PopupLayout
  /** slide_in only. */
  position: PopupPosition
  /** modal / slide_in. */
  width: PopupWidth
  /** modal / fullscreen: dims the page behind. */
  overlay: boolean
  /** modal / fullscreen: a click on the overlay closes it (Esc and the close button always do). */
  close_on_overlay: boolean
  trigger: PopupTrigger
  frequency: PopupFrequency
  /** Don't show again once the visitor used its dismiss button or submitted its form. */
  stop_after_action: boolean
  pages: PopupPages
  devices: PopupDevices
  audience: PopupAudience
  /** 0–100: the highest wins when two modal-like popups are due (then the oldest). */
  priority: number
  /** Admin-set accessible name (✱ ≤ 120); '' = the popup's first heading. */
  label: string
  /** ISO 8601 with zone, or null; `ends_at` > `starts_at`. */
  starts_at: string | null
  ends_at: string | null
  /** `{bn: {label: '…'}}` (like node translations). */
  translations: Record<string, { label?: string }>
}

/** Settings as GET /store/builder/popups serves them: no schedule or translations; `label` in the request language. */
export type StorePopupSettings = Omit<PopupSettings, 'starts_at' | 'ends_at' | 'translations'>

/** A stored document (draft or published version content). B8b: `popup` on popup documents only. */
export type BuilderDocument = { schema_version: 1; sections: Section[]; popup?: PopupSettings }

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
export type ElementDataState = 'expired' | 'inactive' | 'unavailable' | 'scheduled' | 'empty'

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

/** B6 `data[id]` of a category card. */
/** `url` is null for a category that is no longer visible (draft preview only; publicly the card is dropped). */
export type CategoryCardData = { name: string; url: string | null; image: MediaRef | null; product_count: number; state?: ElementDataState }
/** B6 `data[id]` of a product spotlight: the storefront product detail (as GET /store/products/{slug} returns it). */
export type ProductSpotlightData = ProductDetail & { state?: ElementDataState }
/** B6 `data[id]` of shop the look: product cards by product id (publicly, unavailable products are absent). */
// The server sends an empty list (`[]`) when no product is live; lookups by id still miss safely.
export type ShopTheLookData = { products: Record<string, ProductCard> | []; state?: ElementDataState }

/* B8a element data (`data[id]`). */

/**
 * B8a comparison table: product cards by product id (publicly, unavailable products are absent:
 * their column keeps its title but loses price and button). Draft previews mark the columns whose
 * product is unavailable in `columns` (`{<column_id>: {state: 'unavailable'}}`).
 */
export type ComparisonTableData = {
  products: Record<string, ProductCard> | []
  columns?: Record<string, { state: ElementDataState }> | []
  state?: ElementDataState
}

/** The promotion a flash sale bar counts down to (`state` in draft previews only). */
export type FlashSalePromotion = { id: string; name: string; ends_at: string | null; state?: ElementDataState }
/**
 * B8a flash sale bar: the promotion, its products on sale (≤ product_limit) and, only when the
 * promotion has a real usage limit, how much of it is used.
 */
export type FlashSaleBarData = { promotion: FlashSalePromotion; products: ProductCard[]; claimed: { used: number; limit: number } | null; state?: ElementDataState }

/**
 * B8a bundle: product details by product id. Published props.items are already filtered to the
 * available items; a draft keeps every item and marks the unavailable ones in `items`
 * (`{<item_id>: {state: 'unavailable'}}`), plus `state: 'unavailable'` when fewer than 2 are left.
 */
export type BundleData = { products: Record<string, ProductDetail> | []; items?: Record<string, { state: ElementDataState }> | []; state?: ElementDataState }

/** One approved review of a product on sale. `author` is the public name only; `body` plain text (≤ 600). */
export type ReviewWallItem = {
  id: string
  author: string
  rating: number
  title: string | null
  body: string
  created_at: string
  product: { name: string; url: string; image: MediaRef | CatalogImage | null } | null
}
/** B8a review wall. `summary.average` is a one-decimal string ("4.6") like product ratings. */
export type ReviewWallData = { summary: { average: string; count: number } | null; reviews: ReviewWallItem[]; state?: ElementDataState }

/** B8a store hours: the organization's IANA timezone (e.g. Asia/Dhaka). */
export type StoreHoursData = { timezone: string; state?: ElementDataState }

/** B8a store-source chart: what the server counted (one series; name translated "Products" / "Reviews"). */
export type ChartStoreData = { labels: string[]; series: ChartSeries[]; state?: ElementDataState }

/**
 * P2a order form `data[id]`: the product (and add-on) as the product page gets them, the enabled
 * payment methods (`cod_only` → cash on delivery only), whether guests may order and checkout is
 * open, and delivery hints (methods; the methods per district id). The preview is authoritative.
 */
export type OrderFormData = {
  product: ProductDetail
  upsell: ProductDetail | null
  payment_methods: { code: 'cod' | 'bank_transfer'; display_name: string }[]
  cod_enabled: boolean
  guest_checkout: boolean
  checkout_available: boolean
  shipping: { methods: ShippingMethod[]; districts: Record<string, string[]> | [] }
  state?: ElementDataState
}

export type ElementData =
  | OrderFormData
  | CountdownData
  | DiscountData
  | PromoCardData
  | MenuData
  | FaqListData
  | CategoryCardData
  | ProductSpotlightData
  | ShopTheLookData
  | ComparisonTableData
  | FlashSaleBarData
  | BundleData
  | ReviewWallData
  | StoreHoursData
  | ChartStoreData

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

/** Where an element may be used (registry `allowed_in`): home / landing pages, CMS pages, header, footer, zones; B8b popups. */
export type DocumentContext = 'page' | 'cms' | 'header' | 'footer' | 'zone' | 'popup'

export type ZoneKey = 'listing.top' | 'listing.bottom' | 'product.after'

export const ZONE_KEYS = ['listing.top', 'listing.bottom', 'product.after'] as const satisfies readonly ZoneKey[]

/**
 * P1b: the product page's zones — under the price (summary column), after the details (full width,
 * B4's `product.after`) and at the very end of the page. Their payloads come with the product
 * (GET /store/products/{slug} `zones`), resolved per product: the product's own version, else the
 * nearest category's, else the all-products one.
 */
export type ProductZoneKey = 'product.below_price' | 'product.after' | 'product.bottom'

export const PRODUCT_ZONE_KEYS = ['product.below_price', 'product.after', 'product.bottom'] as const satisfies readonly ProductZoneKey[]

/** bootstrap `builder`: published documents (staff `?preview=draft`: drafts); null / absent = the classic rendering. */
export type BootstrapBuilder = {
  home: boolean
  header?: BuilderPage | null
  footer?: BuilderPage | null
  zones?: Partial<Record<ZoneKey, BuilderPage | null>>
}

/* ----------------------------------------------------------------------------------------------
 * B8b: GET /store/builder/popups
 * -------------------------------------------------------------------------------------------- */

/** One live popup (or, `?preview=draft&popup=<id>` for staff, that popup's draft: version null, nodes keep `state`). */
export type StorePopupEntry = {
  /** The popup document's uuid (also the form submit's document). */
  id: string
  /** The published version number; null in a draft preview. Frequency records are kept per popup id, across versions. */
  version: number | null
  settings: StorePopupSettings
  payload: Pick<BuilderPage, 'sections' | 'media' | 'data'>
}
/** Already ordered (priority desc, then oldest). `never_on`: path prefixes no popup covers. */
export type StorePopupsResponse = { popups: StorePopupEntry[]; never_on: string[] }
