import type { Cart, CartLine, CheckoutOptions, CheckoutPreview, Customer, CustomerAddress, OrderView, ShippingMethod, ListingFacets, MenuNode, ProductCard, ProductDetail, ProductVariant, StorefrontBootstrap } from './types'

let nextId = 0

export function menuNode(label: string, url: string, overrides: Partial<MenuNode> = {}): MenuNode {
  nextId += 1
  return { id: `m-${nextId}`, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [], ...overrides }
}

/** A bootstrap payload with the default theme, as the backend returns it. */
export function bootstrapFixture(overrides: Partial<StorefrontBootstrap> = {}): StorefrontBootstrap {
  return {
    store: { name: 'Berry Kids', description: 'Clothes and toys for little ones', prices_include_tax: true, currency: 'BDT' },
    preview: false,
    theme: {
      colors: {
        primary: '#f59e0b',
        primary_foreground: '#3b2500',
        accent: '#6f55c2',
        accent_foreground: '#ffffff',
        highlight: '#2fb79a',
        sale: '#c2410c',
        heading: '#3d3d3d',
        text: '#5f6368',
        canvas: '#f3f7fa',
        surface: '#ffffff',
        border: '#e1e1e1',
      },
      typography: { heading_font: 'baloo', body_font: 'poppins' },
      shape: { button_style: 'pill', card_radius: 12 },
      layout: { container_width: 1170, sticky_header: true },
      logo: null,
      favicon: null,
      announcement: null,
      footer: {
        about: null,
        copyright: null,
        contact: { email: null, phone: null, address: null },
        social: {},
        payment_logos: [],
      },
      custom_css: null,
    },
    menus: {
      main: {
        name: 'Main',
        items: [
          menuNode('Boys', '/boys', {
            is_mega: true,
            mega_columns: 3,
            children: [
              menuNode('Clothing', '/boys/clothing', { children: [menuNode('T-shirts', '/boys/clothing/t-shirts'), menuNode('Shorts', '/boys/clothing/shorts')] }),
              menuNode('Shoes', '/boys/shoes'),
            ],
          }),
          menuNode('Girls', '/girls', { children: [menuNode('Dresses', '/girls/dresses'), menuNode('Hair bands', '/girls/hair-bands')] }),
          menuNode('Blog', 'https://blog.example.com', { open_in_new_tab: true }),
        ],
      },
    },
    ...overrides,
  }
}

/** A product card as GET /store/products returns it. */
export function productCard(slug: string, overrides: Partial<ProductCard> = {}): ProductCard {
  const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return {
    id: `p-${slug}`,
    slug,
    name,
    url: `/product/${slug}`,
    image: { url: `/storage/products/${slug}.png`, alt: name },
    hover_image: null,
    price: '120.00',
    price_max: '120.00',
    compare_at_price: null,
    on_sale: false,
    discount_percent: null,
    in_stock: true,
    is_new: false,
    is_featured: false,
    brand: { name: 'Fresh Co', slug: 'fresh-co' },
    category: { name: 'Juices', slug: 'juices' },
    variant_count: 1,
    default_variant_id: `v-${slug}`,
    short_description: null,
    ...overrides,
  }
}

export function facetsFixture(overrides: Partial<ListingFacets> = {}): ListingFacets {
  return {
    categories: [{ slug: 'juices', name: 'Juices', count: 3 }],
    brands: [
      { slug: 'fresh-co', name: 'Fresh Co', count: 2, selected: false },
      { slug: 'sunny', name: 'Sunny', count: 1, selected: false },
    ],
    attributes: [
      {
        slug: 'colour',
        name: 'Colour',
        display: 'swatch',
        values: [
          { value: 'Red', swatch_hex: '#ff0000', count: 2, selected: false },
          { value: 'Blue', swatch_hex: '#0000ff', count: 1, selected: false },
        ],
      },
      { slug: 'size', name: 'Size', display: 'button', values: [{ value: '1L', swatch_hex: null, count: 3, selected: false }] },
    ],
    price: { min: '35.00', max: '950.00' },
    in_stock: { count: 3 },
    on_sale: { count: 1 },
    ...overrides,
  }
}

/** The /store/products response body exactly as the E6 contract shows it. */
export function listingBody(products: ProductCard[], options: { total?: number; page?: number; perPage?: number; facets?: ListingFacets | null } = {}) {
  const perPage = options.perPage ?? 24
  const total = options.total ?? products.length
  return {
    success: true,
    data: products,
    meta: { request_id: 'test', current_page: options.page ?? 1, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) },
    facets: options.facets === undefined ? facetsFixture() : options.facets,
    context: { category: null, brand: null, q: null },
  }
}

/** A product with Colour (swatch) × Size (button) variants; Blue only in L, Red L out of stock. */
export function productDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  const variant = (id: string, colour: string, size: string, extra: Partial<ProductVariant> = {}): ProductVariant => ({
    id,
    sku: `TEE-${colour.slice(0, 1)}${size}`,
    name: `${colour} / ${size}`,
    option_values: { Colour: colour, Size: size },
    price: '450.00',
    compare_at_price: null,
    on_sale: false,
    discount_percent: null,
    in_stock: true,
    low_stock: false,
    image_id: null,
    ...extra,
  })
  return {
    id: 'p-tee',
    slug: 'kids-tee',
    name: 'Kids Tee',
    url: '/product/kids-tee',
    short_description: 'Soft cotton tee.',
    description_html: '<p>Made from <strong>organic</strong> cotton.</p>',
    specifications: [{ label: 'Material', value: 'Cotton' }],
    brand: { name: 'Fresh Co', slug: 'fresh-co' },
    category: { name: 'Clothing', slug: 'clothing' },
    breadcrumbs: [
      { name: 'Home', url: '/' },
      { name: 'Clothing', url: '/category/clothing' },
      { name: 'Kids Tee', url: null },
    ],
    images: [
      { id: 'img-red', url: '/storage/products/tee-red.png', alt: 'Red tee' },
      { id: 'img-blue', url: '/storage/products/tee-blue.png', alt: 'Blue tee' },
    ],
    options: [
      { name: 'Colour', slug: 'colour', display: 'swatch', values: [{ value: 'Red', swatch_hex: '#ff0000' }, { value: 'Blue', swatch_hex: '#0000ff' }] },
      { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null }, { value: 'L', swatch_hex: null }] },
    ],
    variants: [
      variant('v-red-m', 'Red', 'M', { image_id: 'img-red', compare_at_price: '500.00', on_sale: true, discount_percent: 10 }),
      variant('v-red-l', 'Red', 'L', { in_stock: false, image_id: 'img-red' }),
      variant('v-blue-l', 'Blue', 'L', { price: '480.00', low_stock: true, image_id: 'img-blue' }),
    ],
    price: '450.00',
    price_max: '480.00',
    on_sale: true,
    in_stock: true,
    is_new: true,
    default_variant_id: 'v-red-m',
    unit: 'pcs',
    seo: { title: null, description: null, image_url: null },
    ...overrides,
  }
}

/* E7: customer accounts, cart, wishlist ------------------------------------------------- */

export function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return { id: 'c-1', name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678', email_verified: true, ...overrides }
}

export function cartLine(id: string, overrides: Partial<CartLine> = {}): CartLine {
  return {
    id,
    variant_id: `v-${id}`,
    product: { slug: 'kids-tee', name: 'Kids Tee', url: '/product/kids-tee', image: null },
    variant_name: 'Red / M',
    option_values: { Colour: 'Red', Size: 'M' },
    sku: 'TEE-RM',
    quantity: '2',
    unit_price: '450.00',
    compare_at_price: null,
    line_total: '900.00',
    purchasable: true,
    in_stock: true,
    max_quantity: null,
    exceeds_stock: false,
    allow_decimal: false,
    ...overrides,
  }
}

/** A cart as GET /store/cart returns it; totals are whatever the test says (the server computes them). */
export function cartFixture(items: CartLine[] = [], overrides: Partial<Cart> = {}): Cart {
  return {
    id: items.length > 0 ? 'cart-1' : null,
    items,
    item_count: items.length > 0 ? '2' : '0',
    subtotal: items.length > 0 ? '900.00' : '0.00',
    tax_total: '0.00',
    total: items.length > 0 ? '900.00' : '0.00',
    prices_include_tax: true,
    currency: 'BDT',
    issues: [],
    ...overrides,
  }
}

export function addressFixture(id: string, overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id,
    label: 'Home',
    recipient_name: 'Rina Akter',
    phone: '01712345678',
    division: { id: 3, name: 'Dhaka' },
    district: { id: 47, name: 'Dhaka' },
    area: 'Dhanmondi',
    address_line: 'House 12, Road 5',
    postcode: '1205',
    is_default_shipping: true,
    is_default_billing: true,
    ...overrides,
  }
}

/* E8a: checkout and orders --------------------------------------------------------------- */

export function checkoutOptionsFixture(overrides: Partial<CheckoutOptions> = {}): CheckoutOptions {
  return {
    available: true,
    reason: null,
    guest_checkout: true,
    payment_methods: [
      { code: 'cod', display_name: 'Cash on delivery', instructions_preview: null },
      { code: 'bank_transfer', display_name: 'Bank transfer', instructions_preview: null },
    ],
    signed_in: false,
    ...overrides,
  }
}

export function shippingMethodFixture(id: string, overrides: Partial<ShippingMethod> = {}): ShippingMethod {
  return {
    id,
    name: 'Home delivery',
    description: 'Delivered to your door',
    fee: '60.00',
    free_over: '2000.00',
    cod_allowed: true,
    cod_fee: '0.00',
    eta_min_days: 1,
    eta_max_days: 2,
    ...overrides,
  }
}

/** A checkout preview as POST /store/checkout/preview returns it (totals are whatever the test says). */
export function previewFixture(overrides: Partial<CheckoutPreview> = {}): CheckoutPreview {
  return {
    lines: [cartLine('l-1')],
    subtotal: '900.00',
    tax_total: '0.00',
    shipping_total: '0.00',
    cod_fee: '0.00',
    total: '900.00',
    currency: 'BDT',
    prices_include_tax: true,
    shipping_methods: [],
    shipping_method_id: null,
    payment_method: null,
    issues: [],
    ...overrides,
  }
}

export function orderFixture(overrides: Partial<OrderView> = {}): OrderView {
  return {
    number: 'WEB-000001',
    status: 'confirmed',
    status_label: 'Confirmed',
    payment_status: 'unpaid',
    payment_method: 'cod',
    payment_method_label: 'Cash on delivery',
    payment_instructions: null,
    placed_at: '2026-10-31T10:00:00+06:00',
    expires_at: null,
    contact: { name: 'Rina Akter', email: 'rina@example.com', phone: '01712345678' },
    shipping_address: { recipient_name: 'Rina Akter', phone: '01712345678', division: 'Dhaka', district: 'Dhaka', area: 'Dhanmondi', address_line: 'House 12, Road 5', postcode: '1205' },
    shipping_method_name: 'Home delivery',
    eta_min_days: 1,
    eta_max_days: 2,
    lines: [{ product_name: 'Kids Tee', variant_name: 'Red / M', sku: 'TEE-RM', image_url: null, quantity: '2.000', unit_price: '450.00', line_total: '900.00', product_url: '/product/kids-tee' }],
    subtotal: '900.00',
    tax_total: '0.00',
    shipping_total: '60.00',
    cod_fee: '0.00',
    total: '960.00',
    currency: 'BDT',
    prices_include_tax: true,
    courier_name: null,
    tracking_number: null,
    history: [{ status: 'confirmed', label: 'Confirmed', at: '2026-10-31T10:00:00+06:00' }],
    ...overrides,
  }
}
