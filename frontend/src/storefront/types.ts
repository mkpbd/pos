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
