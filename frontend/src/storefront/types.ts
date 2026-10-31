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
}

export type SortKey = 'featured' | 'popularity' | 'latest' | 'price_asc' | 'price_desc' | 'name'

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
  unit: string | null
  /** Sold in fractions (e.g. by weight). Not part of the E6 contract: integer quantities when absent. */
  allow_decimal?: boolean
  seo: Seo & { image_url: string | null }
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
}

export type CartIssue = 'exceeds_stock' | 'unavailable' | (string & {})

/** GET /store/cart — repriced by the server on every read. */
export type Cart = {
  id: string | null
  items: CartLine[]
  /** Sum of the purchasable lines' quantities, trimmed ("3", "1.5"). */
  item_count: string
  subtotal: string
  tax_total: string
  total: string
  prices_include_tax: boolean
  currency: string | null
  issues: CartIssue[]
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

/** POST /store/checkout/preview — the cart repriced with delivery and COD fees. */
export type CheckoutPreview = {
  lines: CartLine[]
  subtotal: string
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
  lines: { product_name: string; variant_name: string | null; sku: string; image_url: string | null; quantity: string; unit_price: string; line_total: string; product_url: string | null }[]
  subtotal: string
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
