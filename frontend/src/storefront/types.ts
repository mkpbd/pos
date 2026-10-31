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
  store: { name: string; description: string | null }
  preview: boolean
  theme: StorefrontTheme
  menus: Partial<Record<MenuLocation, StorefrontMenu>>
}
