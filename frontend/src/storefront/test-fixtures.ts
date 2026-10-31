import type { MenuNode, StorefrontBootstrap } from './types'

let nextId = 0

export function menuNode(label: string, url: string, overrides: Partial<MenuNode> = {}): MenuNode {
  nextId += 1
  return { id: `m-${nextId}`, label, url, open_in_new_tab: false, is_mega: false, mega_columns: null, image: null, children: [], ...overrides }
}

/** A bootstrap payload with the default theme, as the backend returns it. */
export function bootstrapFixture(overrides: Partial<StorefrontBootstrap> = {}): StorefrontBootstrap {
  return {
    store: { name: 'Berry Kids', description: 'Clothes and toys for little ones' },
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
