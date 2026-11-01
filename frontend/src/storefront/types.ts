/** GET /api/v1/store/bootstrap — see backend Storefront\Application\Queries\StorefrontBootstrap. */

export type MediaRef = {
  id: string
  url: string
  srcset: string
  width: number
  height: number
  alt: string | null
}

export type ThemeColors = {
  primary: string
  primary_foreground: string
  accent: string
  accent_foreground: string
  highlight: string
  sale: string
  heading: string
  text: string
  canvas: string
  surface: string
  border: string
}

export type HeadingFont = 'baloo' | 'poppins' | 'system'
export type BodyFont = 'poppins' | 'system'
export type ButtonStyle = 'pill' | 'rounded' | 'square'

export type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'x' | 'linkedin'

export type Announcement = {
  text: string
  link: string | null
  background: string
  foreground: string
}

export type StorefrontTheme = {
  colors: ThemeColors
  typography: { heading_font: HeadingFont; body_font: BodyFont }
  shape: { button_style: ButtonStyle; card_radius: number }
  layout: { container_width: number; sticky_header: boolean }
  logo: MediaRef | null
  favicon: MediaRef | null
  announcement: Announcement | null
  footer: {
    about: string | null
    copyright: string | null
    contact: { email: string | null; phone: string | null; address: string | null }
    social: Partial<Record<SocialNetwork, string>>
    payment_logos: MediaRef[]
  }
  custom_css: string | null
}

export type MenuNode = {
  id: string
  label: string
  url: string
  open_in_new_tab: boolean
  is_mega: boolean
  mega_columns: number | null
  image: MediaRef | null
  children: MenuNode[]
}

export type MenuLocation = 'main' | 'mobile' | 'footer_1' | 'footer_2' | 'footer_3'

export type StorefrontMenu = { name: string; items: MenuNode[] }

export type StorefrontBootstrap = {
  store: {
    name: string
    description: string | null
    /** False when the organization's tax mode is exclusive: prices are shown "Excl. VAT" (tax is added at checkout). */
    prices_include_tax: boolean
    /** ISO 4217 code of the organization's base currency (e.g. "BDT"); amounts are shown without a symbol when absent. */
    currency?: string | null
  }
  preview: boolean
  theme: StorefrontTheme
  menus: Partial<Record<MenuLocation, StorefrontMenu>>
  /** The live popup banner (E11); absent from older payloads. */
  popup?: StorePopup | null
}

/** GET /api/v1/store/homepage — see backend Storefront\Application\Queries\StorefrontHomepage. */

export type StoreBanner = {
  id: string
  kicker: string | null
  title: string | null
  subtitle: string | null
  link_url: string | null
  button_label: string | null
  secondary_link_url: string | null
  secondary_button_label: string | null
  image: MediaRef
  mobile_image: MediaRef | null
  text_color: string
  text_position: 'left' | 'center' | 'right'
}

/** Only in previews: why a section would (not) show. */
export type SectionPreviewState = 'live' | 'disabled' | 'scheduled' | 'expired' | 'empty'

type SectionBase = { id: string; title: string | null; subtitle: string | null; state?: SectionPreviewState }

export type FeatureIconKey = 'truck' | 'shield-check' | 'credit-card' | 'headset' | 'gift' | 'rotate-ccw' | 'badge-percent' | 'clock' | 'leaf' | 'heart' | 'star' | 'store'

export type StoreSection =
  | (SectionBase & { type: 'hero_slider'; config: { autoplay_seconds: number; height: 'medium' | 'large' }; banners: StoreBanner[] })
  | (SectionBase & { type: 'banner_grid'; config: { layout: '2-col' | '3-col' | '3-col-split' | '4-col' }; banners: StoreBanner[] })
  | (SectionBase & { type: 'rich_text'; config: { body_html: string; alignment: 'left' | 'center'; width: 'narrow' | 'wide'; background: string | null } })
  | (SectionBase & { type: 'features_strip'; config: { items: { icon: FeatureIconKey; title: string; text: string | null }[]; background: string | null } })
  | (SectionBase & {
      type: 'testimonials'
      config: { items: { quote: string; name: string; role: string | null; rating: number | null; avatar: MediaRef | null }[]; background: string | null }
    })
  | (SectionBase & { type: 'newsletter'; config: { text: string | null; button_label: string; image: MediaRef | null; background: string; foreground: string } })
  | (SectionBase & { type: 'product_carousel'; config: ProductSectionConfig; products: ProductCard[] })
  | (SectionBase & { type: 'product_grid'; config: ProductSectionConfig & { columns: 3 | 4 | 5 }; products: ProductCard[] })
  | (SectionBase & {
      type: 'product_tabs'
      config: { tabs: { label: string; source: Exclude<ProductSource, 'manual'>; category_id?: string | null }[]; limit: number }
      tabs: { label: string; products: ProductCard[] }[]
    })
  | (SectionBase & { type: 'category_strip'; config: { source: 'manual' | 'top_level'; limit: number }; categories: StripCategory[] })
  | (SectionBase & { type: 'brand_strip'; config: { source: 'manual' | 'all'; limit: number }; brands: StripBrand[] })
  | (SectionBase & {
      type: 'hot_deals'
      /** promotion_id null = every live countdown promotion (E8b). */
      config: { promotion_id: string | null; limit: number; view_all_url?: string | null }
      /** The earliest end among the promotions shown; the section hides itself when it passes. */
      ends_at: string | null
      products: ProductCard[]
    })
  | (SectionBase & { type: 'blog_posts'; config: { category_id: string | null; limit: number; view_all_url?: string | null }; posts: BlogPostRow[] })

export type ProductSource = 'manual' | 'featured' | 'new_arrivals' | 'best_sellers' | 'on_sale' | 'category'

export type ProductSectionConfig = { source: ProductSource; category_id?: string | null; limit: number; view_all_url?: string | null }

export type StripCategory = { slug: string; name: string; url: string; image: MediaRef | null; product_count: number }

export type StripBrand = { slug: string; name: string; url: string; logo: MediaRef | null }

export type StorefrontHomepage = { sections: StoreSection[]; preview: boolean }

export type FaqGroup = { group: string | null; items: { id: string; question: string; answer_html: string }[] }

/** GET /api/v1/store/pages/{slug} */
export type StorePage = {
  slug: string
  title: string
  template: 'default' | 'faq' | 'contact'
  body_html: string | null
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  updated_at: string | null
  faq?: FaqGroup[]
}

export type ContactInput = { name: string; email: string; phone?: string; subject?: string; message: string; website?: string }

/* ---------------------------------------------------------------------------------------
 * Online catalog (E6) — GET /api/v1/store/products, /store/categories, /store/brands, /store/search/suggest
 * ------------------------------------------------------------------------------------- */

/** A product image as the catalog returns it (no renditions, no intrinsic size). */
export type CatalogImage = { url: string; alt: string | null }

export type NamedLink = { name: string; slug: string | null }

/* ---------------------------------------------------------------------------------------
 * Promotions (E8b) — automatic product offers on cards and product pages, coupons on the cart
 * ------------------------------------------------------------------------------------- */

export type PromotionType = 'percent' | 'fixed' | 'free_shipping'

/**
 * The automatic product promotion shown on a card or product page. The badge ("−10 %", "−৳20")
 * is formatted here from `type` + `value`; `price` is the promotional unit price of the variant
 * that gives the card's (product's) `price`. Coupon promotions are never shown this way.
 */
export type DisplayPromotion = {
  id: string
  name: string
  type: PromotionType
  /** Percent (0.01–100) or a fixed amount per unit, as a decimal string. */
  value: string
  ends_at: string | null
  /** A flash sale: show a countdown to `ends_at`. */
  show_countdown: boolean
  price: string
}

/** The common product card. Amounts are decimal strings, exactly as stored. */
export type ProductCard = {
  id: string
  slug: string
  name: string
  url: string
  image: CatalogImage | null
  hover_image: CatalogImage | null
  /** Lowest / highest price over the active variants (equal for one variant). */
  price: string
  price_max: string
  /** Compare-at of the variant that gives `price`, when on sale. */
  compare_at_price: string | null
  on_sale: boolean
  discount_percent: number | null
  in_stock: boolean
  is_new: boolean
  is_featured: boolean
  brand: NamedLink | null
  category: NamedLink | null
  variant_count: number
  /** The variant to add straight from the card; set when the product has exactly one active variant (E7). */
  default_variant_id: string | null
  short_description: string | null
  /** The live automatic product promotion (E8b); listing filters and sort keep the base price. */
  promotion: DisplayPromotion | null
  /** Approved reviews (E10b): average as a one-decimal string; null (or absent) without reviews. */
  rating?: { average: string; count: number } | null
}

/** `rating` (E10b): average desc, then review count desc, unrated last. */
export type SortKey = 'featured' | 'popularity' | 'latest' | 'price_asc' | 'price_desc' | 'name' | 'rating'

export type AttributeDisplay = 'button' | 'swatch' | 'text'

export type ListingFacets = {
  categories: { slug: string; name: string; count: number }[]
  brands: { slug: string; name: string; count: number; selected: boolean }[]
  attributes: { slug: string; name: string; display: AttributeDisplay; values: { value: string; swatch_hex: string | null; count: number; selected: boolean }[] }[]
  price: { min: string | null; max: string | null } | null
  in_stock: { count: number }
  on_sale: { count: number }
}

export type ListingContext = { category: { slug: string; name: string } | null; brand: { slug: string; name: string } | null; q: string | null }

export type ListingPagination = { current_page: number; per_page: number; total: number; last_page: number }

/** GET /store/products, normalised (see catalog/api.ts). */
export type ProductListing = {
  products: ProductCard[]
  pagination: ListingPagination
  facets: ListingFacets | null
  context: ListingContext | null
}

export type Breadcrumb = { name: string; url: string | null }

export type Seo = { title: string | null; description: string | null }

export type StoreCategory = {
  id: string
  slug: string
  name: string
  description_html: string | null
  image: MediaRef | null
  banner: MediaRef | null
  seo: Seo
  breadcrumbs: Breadcrumb[]
  children: { slug: string; name: string; image: MediaRef | null; product_count: number }[]
}

export type StoreBrand = { slug: string; name: string; description: string | null; logo: MediaRef | null; seo: Seo }

export type ProductOption = {
  name: string
  slug: string | null
  display: AttributeDisplay
  values: { value: string; swatch_hex: string | null }[]
}

export type ProductVariant = {
  id: string
  sku: string
  name: string
  option_values: Record<string, string>
  price: string
  compare_at_price: string | null
  on_sale: boolean
  discount_percent: number | null
  in_stock: boolean
  low_stock: boolean
  image_id: string | null
  /** The unit price after the product's promotion (E8b); null when none applies to this variant. */
  promo_price: string | null
}

/** GET /store/products/{slug} */
export type ProductDetail = {
  id: string
  slug: string
  name: string
  url: string
  short_description: string | null
  description_html: string | null
  specifications: { label: string; value: string }[]
  brand: NamedLink | null
  category: NamedLink | null
  breadcrumbs: Breadcrumb[]
  images: (CatalogImage & { id: string })[]
  options: ProductOption[]
  variants: ProductVariant[]
  price: string
  price_max: string
  on_sale: boolean
  in_stock: boolean
  is_new: boolean
  default_variant_id: string | null
  /** The live automatic product promotion (E8b); `price` is for the variant that gives `price`. */
  promotion: DisplayPromotion | null
  unit: string | null
  /** Sold in fractions (e.g. by weight). Not part of the E6 contract: integer quantities when absent. */
  allow_decimal?: boolean
  seo: Seo & { image_url: string | null }
  /** Approved reviews (E9): average as a one-decimal string ("4.5"); null without reviews. */
  rating?: { average: string; count: number } | null
  /** Staff preview only (?preview=1). */
  preview_state?: 'draft' | 'scheduled' | 'live' | 'expired'
}

/** GET /store/products/{slug}/related */
export type RelatedProducts = { related: ProductCard[]; frequently_bought: ProductCard[] }

/** GET /store/search/suggest */
export type SearchSuggestions = {
  products: { slug: string; name: string; url: string; image: CatalogImage | null; price: string }[]
  categories: { slug: string; name: string; url: string }[]
}

/* ---------------------------------------------------------------------------------------
 * Customer accounts, cart and wishlist (E7) — /api/v1/store/account/*, /store/cart, /store/wishlist, /store/geo/*
 * ------------------------------------------------------------------------------------- */

/** GET /store/account/me (null for guests) and the `customer` of sign-in responses. */
export type Customer = { id: string; name: string; email: string; phone: string | null; email_verified: boolean }

/** How the guest cart was folded into the customer's cart on sign-in. */
export type CartMerge = { merged_lines: number; capped_lines: number }

/** POST /store/account/login and /register. */
export type SignInResult = { customer: Customer; merge: CartMerge | null }

export type GeoId = string | number

export type GeoDivision = { id: GeoId; name: string; name_bn: string | null }

export type GeoDistrict = { id: GeoId; division_id: GeoId; name: string; name_bn: string | null }

export type CustomerAddress = {
  id: string
  label: string | null
  recipient_name: string
  phone: string
  division: { id: GeoId; name: string }
  district: { id: GeoId; name: string }
  area: string
  address_line: string
  postcode: string | null
  is_default_shipping: boolean
  is_default_billing: boolean
}

export type AddressInput = {
  label: string | null
  recipient_name: string
  phone: string
  division_id: GeoId
  district_id: GeoId
  area: string
  address_line: string
  postcode: string | null
  is_default_shipping: boolean
  is_default_billing: boolean
}

export type CartLine = {
  id: string
  variant_id: string
  product: { slug: string; name: string; url: string; image: CatalogImage | null }
  variant_name: string | null
  option_values: Record<string, string>
  sku: string
  /** Decimal string ("2" or "1.500"). */
  quantity: string
  unit_price: string
  compare_at_price: string | null
  line_total: string
  purchasable: boolean
  in_stock: boolean
  /** Stock at the fulfilment store for tracked items; null = unlimited. */
  max_quantity: string | null
  exceeds_stock: boolean
  allow_decimal: boolean
  /** The discount on this line (E8b): its product discount plus its share of an order discount; `line_total` stays quantity × unit price. */
  discount_amount: string
  /** The product promotion applied to this line. */
  promotion: { id: string; name: string } | null
}

export type CartIssue = 'exceeds_stock' | 'unavailable' | (string & {})

/** Why a coupon was refused (422 COUPON_INVALID details.reason) or is not used any more (cart.coupon.reason). */
export type CouponReason = 'not_found' | 'not_started' | 'expired' | 'usage_limit_reached' | 'customer_limit_reached' | 'min_subtotal' | 'not_applicable' | 'better_offer' | (string & {})

/** The coupon on the cart (one per cart). `applied: false` — not used in the totals (a better offer applies, or it became invalid). */
export type CartCoupon = {
  code: string
  applied: boolean
  reason: CouponReason | null
  message: string | null
  promotion_name: string | null
}

export type CartPromotion = { id: string; name: string; kind: 'product' | 'order'; amount: string }

/** GET /store/cart — repriced by the server on every read. */
export type Cart = {
  id: string | null
  items: CartLine[]
  /** Sum of the purchasable lines' quantities, trimmed ("3", "1.5"). */
  item_count: string
  /** Before discounts. */
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  prices_include_tax: boolean
  currency: string | null
  issues: CartIssue[]
  promotions: CartPromotion[]
  /** The free-shipping promotion the cart qualifies for (delivery fee waived at checkout). */
  free_shipping: { id: string; name: string } | null
  coupon: CartCoupon | null
}

export type WishlistItem = { id: string; product: ProductCard; variant_id: string | null }

/** GET /store/wishlist (signed-in customers only). */
export type Wishlist = { items: WishlistItem[] }

/* ---------------------------------------------------------------------------------------
 * Checkout and orders (E8a) — /api/v1/store/checkout*, /store/shipping-methods, /store/orders/{number}
 * ------------------------------------------------------------------------------------- */

export type PaymentMethodCode = 'cod' | 'bank_transfer'

/** GET /store/checkout/options */
export type CheckoutOptions = {
  available: boolean
  reason: null | 'no_fulfilment_store' | 'cart_empty' | (string & {})
  guest_checkout: boolean
  payment_methods: { code: PaymentMethodCode; display_name: string; instructions_preview?: string | null }[]
  signed_in: boolean
}

/** A delivery method of the zone that serves a district. */
export type ShippingMethod = {
  id: string
  name: string
  description: string | null
  fee: string
  /** Delivery is free when the cart total reaches this amount. */
  free_over: string | null
  cod_allowed: boolean
  cod_fee: string
  eta_min_days: number
  eta_max_days: number
}

/** A promotion used by a priced order (checkout preview, placed order). */
export type AppliedPromotion = { name: string; kind: 'product' | 'order' | 'shipping'; amount: string }

/** POST /store/checkout/preview — the cart repriced with delivery and COD fees. */
export type CheckoutPreview = {
  lines: CartLine[]
  subtotal: string
  /** Product and order discounts (E8b). */
  discount_total: string
  /** The delivery fee waived by a free-shipping promotion. */
  shipping_discount: string
  promotions: AppliedPromotion[]
  /** The coupon used in these totals; null when none (or when the cart's coupon is not applied). */
  coupon_code: string | null
  tax_total: string
  shipping_total: string
  cod_fee: string
  total: string
  currency: string | null
  prices_include_tax: boolean
  shipping_methods: ShippingMethod[]
  shipping_method_id: string | null
  payment_method: PaymentMethodCode | null
  issues: CartIssue[]
}

export type CheckoutAddressInput = {
  recipient_name: string
  phone: string
  division_id: GeoId
  district_id: GeoId
  area?: string
  address_line: string
  postcode?: string
}

/** POST /store/checkout (with an Idempotency-Key header). */
export type PlaceOrderInput = {
  contact: { name: string; email: string; phone: string }
  shipping_address_id?: string
  address?: CheckoutAddressInput
  save_address?: boolean
  shipping_method_id: string
  payment_method: PaymentMethodCode
  notes?: string
  expected_total: string
}

/** The pricing part of the place body; the preview tolerates partial input. */
export type CheckoutPreviewInput = {
  shipping_address_id?: string
  address?: Partial<CheckoutAddressInput>
  shipping_method_id?: string
  payment_method?: PaymentMethodCode
}

export type OrderStatus = 'pending_payment' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'failed' | (string & {})

/** GET /store/orders/{number}?token= — and the `order` of the placement response. */
export type OrderView = {
  number: string
  status: OrderStatus
  status_label: string
  payment_status: 'unpaid' | 'paid' | (string & {})
  payment_method: PaymentMethodCode
  payment_method_label: string
  /** Bank transfer details while the order waits for the money; null otherwise. */
  payment_instructions: string | null
  placed_at: string
  expires_at: string | null
  contact: { name: string; email: string; phone: string }
  shipping_address: { recipient_name: string; phone: string; division: string; district: string; area: string | null; address_line: string; postcode: string | null }
  shipping_method_name: string | null
  eta_min_days: number | null
  eta_max_days: number | null
  lines: {
    product_name: string
    variant_name: string | null
    sku: string
    image_url: string | null
    quantity: string
    unit_price: string
    line_total: string
    product_url: string | null
    /** Item discount plus the line's share of the order discount (E8b). */
    discount_amount: string
  }[]
  subtotal: string
  discount_total: string
  shipping_discount: string
  promotions: AppliedPromotion[]
  coupon_code: string | null
  tax_total: string
  shipping_total: string
  cod_fee: string
  total: string
  currency: string | null
  prices_include_tax: boolean
  courier_name: string | null
  tracking_number: string | null
  history: { status: OrderStatus; label: string; at: string }[]
}

/** 201 of POST /store/checkout; the access token is only for guests (null for customers). */
export type PlacedOrder = { order: OrderView; access_token: string | null }

/* ---------------------------------------------------------------------------------------
 * Customer account area (E9) — /api/v1/store/account/orders*, /store/account/reviews*, /store/products/{slug}/reviews
 * ------------------------------------------------------------------------------------- */

/** The order-history tabs: `open` = pending payment, confirmed, processing or shipped. */
export type AccountOrderFilter = 'open' | 'delivered' | 'cancelled'

/** A row of GET /store/account/orders (newest first, 10 per page). */
export type AccountOrderRow = {
  number: string
  placed_at: string
  status: OrderStatus
  status_label: string
  payment_status: 'unpaid' | 'paid' | (string & {})
  payment_method_label: string
  item_count: number | string
  total: string
  currency: string | null
  first_item: { name: string; image_url: string | null } | null
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | (string & {})

/** The customer's review of an order line's product, as the order detail carries it. */
export type LineReview = { id: string; rating: number; status: ReviewStatus }

export type AccountOrderLine = OrderView['lines'][number] & {
  /** The order line's id — `order_line_id` of a return request (E10b). */
  id?: string
  /** The product to review (POST /store/account/reviews takes it). */
  product_id?: string | null
  review: LineReview | null
  /** A delivered line whose product the customer has not reviewed yet. */
  reviewable: boolean
  /** What can still be returned (E10b): ordered minus the quantity in open or completed returns. */
  returnable_quantity?: string | null
}

/** GET /store/account/orders/{number}: the order view plus what the customer may do with it. */
export type AccountOrder = Omit<OrderView, 'lines'> & {
  lines: AccountOrderLine[]
  can_cancel: boolean
  /** E10b: delivered, paid and within the store's return window. */
  returnable?: boolean
  /** E10b: the last moment a return can be requested (null when returns do not apply). */
  return_deadline?: string | null
  returns?: OrderReturnSummary[]
}

/* ---------------------------------------------------------------------------------------
 * Online returns (E10b) — /api/v1/store/account/orders/{number}/returns, /store/account/returns*
 * ------------------------------------------------------------------------------------- */

export type ReturnStatus = 'requested' | 'approved' | 'received' | 'refunded' | 'rejected' | 'cancelled' | (string & {})

export type ReturnReasonCode = 'damaged' | 'wrong_item' | 'not_as_described' | 'changed_mind' | 'other'

/** A returned line; the name fields may be absent where the order's own lines name it. */
export type OrderReturnLine = {
  order_line_id?: string | null
  product_name?: string | null
  variant_name?: string | null
  sku?: string | null
  quantity: string
  amount?: string | null
}

/** A return as the order detail lists it. */
export type OrderReturnSummary = {
  number: string
  status: ReturnStatus
  status_label: string
  lines: OrderReturnLine[]
  /** Computed by the server (proportional share of what was paid); final once refunded. */
  refund_amount: string | null
  created_at: string
}

/** A row of GET /store/account/returns and the answer of create / cancel. */
export type AccountReturn = OrderReturnSummary & {
  order?: { number: string } | null
  order_number?: string | null
  reason_code?: ReturnReasonCode | (string & {}) | null
  reason_label?: string | null
  rejection_reason?: string | null
  refunded_at?: string | null
  currency?: string | null
}

export type ReturnRequestInput = {
  reason_code: ReturnReasonCode
  note?: string
  lines: { order_line_id: string; quantity: string }[]
}

export type ReorderSkipReason = 'unavailable' | 'out_of_stock' | 'limit' | (string & {})

/** POST /store/account/orders/{number}/reorder — today's prices. */
export type ReorderResult = {
  cart: Cart
  added: { variant_id: string; name: string; quantity: string | number }[]
  skipped: { name: string; reason: ReorderSkipReason }[]
}

/** A review of GET /store/account/reviews (any status) and of the create/update answers. */
export type MyReview = {
  id: string
  product_id?: string
  product: { id: string; name: string; slug: string | null; image_url?: string | null; image?: CatalogImage | null } | null
  rating: number
  title: string | null
  body: string
  status: ReviewStatus
  rejection_reason: string | null
  created_at: string
  updated_at?: string | null
}

export type ReviewInput = { product_id: string; rating: number; title: string | null; body: string }

/** An approved review on the product page; the author is "first name + last initial". */
export type PublicReview = { id: string; rating: number; title: string | null; body: string; author: string; created_at: string; verified: boolean }

export type RatingSummary = { average: string; count: number; distribution: Partial<Record<'1' | '2' | '3' | '4' | '5', number>> }

export type ReviewSort = 'newest' | 'highest' | 'lowest'

/** GET /store/products/{slug}/reviews, normalised (see reviews/api.ts). */
export type ProductReviews = { reviews: PublicReview[]; summary: RatingSummary; pagination: ListingPagination }

/* ---------------------------------------------------------------------------------------
 * Blog and popup (E11) — GET /api/v1/store/blog, /store/blog/categories, /store/blog/{slug}
 * ------------------------------------------------------------------------------------- */

/** A published post as the blog list (and the homepage teaser) returns it. */
export type BlogPostRow = {
  slug: string
  title: string
  excerpt: string | null
  cover: MediaRef | null
  category: { name: string; slug: string } | null
  /** The author's first name. */
  author: string | null
  published_at: string
  reading_minutes: number
}

/** GET /store/blog/categories — only categories with published posts. */
export type BlogCategory = { slug: string; name: string; description: string | null; post_count: number }

export type BlogPostLink = { slug: string; title: string }

/** GET /store/blog/{slug} — body_html is sanitized on save (ADR-009). */
export type BlogPostDetail = BlogPostRow & {
  body_html: string
  seo_title: string | null
  seo_description: string | null
  updated_at?: string | null
  prev: BlogPostLink | null
  next: BlogPostLink | null
  related: BlogPostRow[]
}

/** `category`: the filtered category (`meta.category`), also when it has no published posts yet. */
export type BlogListing = { posts: BlogPostRow[]; pagination: ListingPagination; category: Pick<BlogCategory, 'slug' | 'name' | 'description'> | null }

export type PopupFrequency = 'once_per_session' | 'once_per_day' | 'once_per_week'

/** The live popup banner (bootstrap `popup`), or null. */
export type StorePopup = {
  id: string
  title: string | null
  subtitle: string | null
  image: MediaRef | null
  mobile_image: MediaRef | null
  link_url: string | null
  button_label: string | null
  delay_seconds: number
  frequency: PopupFrequency
  /** Part of the "already seen" key, so an edited popup is shown again. */
  updated_at?: string | null
}
