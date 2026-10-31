import type { ListingFacets, MenuNode, ProductCard, ProductDetail, ProductVariant, StorefrontBootstrap } from './types'

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
