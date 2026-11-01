import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type StorefrontSettings = {
  is_enabled: boolean
  site_name: string
  meta_description: string | null
  /** Store whose stock decides web availability; null = tracked products show as out of stock. */
  fulfilment_store_id: string | null
  /** Shoppers may check out without an account (default on). */
  guest_checkout_enabled?: boolean
  /** Days after delivery in which customers may request a return (0 = returns off; E10b). */
  return_window_days?: number
  /** Search engines may index the store (default on; off = robots.txt "Disallow: /" and noindex on every page; E12a). */
  allow_indexing?: boolean
  updated_at: string | null
}

export type StorefrontDomain = { id: string; host: string; is_primary: boolean; created_at: string | null }

export const THEME_COLORS = ['primary', 'primary_foreground', 'accent', 'accent_foreground', 'highlight', 'sale', 'heading', 'text', 'canvas', 'surface', 'border'] as const
export type ThemeColor = (typeof THEME_COLORS)[number]

export const HEADING_FONTS = ['baloo', 'poppins', 'system'] as const
export const BODY_FONTS = ['poppins', 'system'] as const
export const BUTTON_STYLES = ['pill', 'rounded', 'square'] as const
export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin'] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]
export const MAX_PAYMENT_LOGOS = 10

/** The theme document exactly as the API stores it (backend Domain/ThemeSchema). */
export type ThemeDocument = {
  colors: Record<ThemeColor, string>
  typography: { heading_font: (typeof HEADING_FONTS)[number]; body_font: (typeof BODY_FONTS)[number] }
  shape: { button_style: (typeof BUTTON_STYLES)[number]; card_radius: number }
  layout: { container_width: number; sticky_header: boolean }
  logo_media_id: string | null
  favicon_media_id: string | null
  announcement: {
    enabled: boolean
    text: string | null
    link: string | null
    background: string
    foreground: string
    starts_at: string | null
    ends_at: string | null
  }
  footer: {
    about: string | null
    copyright: string | null
    contact: { email: string | null; phone: string | null; address: string | null }
    social: Record<SocialNetwork, string | null>
    payment_logo_media_ids: string[]
  }
}

export type ThemeResponse = {
  settings: ThemeDocument
  /** Only returned to holders of storefront.custom_css. */
  custom_css: string | null
  has_custom_css: boolean
  updated_at: string | null
}

export const MENU_LOCATIONS = ['main', 'mobile', 'footer_1', 'footer_2', 'footer_3'] as const
export type MenuLocation = (typeof MENU_LOCATIONS)[number]
export const MENU_LOCATION_LABELS: Record<MenuLocation, string> = {
  main: 'Main navigation',
  mobile: 'Mobile menu',
  footer_1: 'Footer column 1',
  footer_2: 'Footer column 2',
  footer_3: 'Footer column 3',
}

export type MenuSummary = { id: string; name: string; location: MenuLocation; location_label: string; is_active: boolean; updated_at: string | null }

/** `blog` is the blog index (no target); `blog_category` and `blog_post` link one record (E11). */
export type MenuItemType = 'custom' | 'page' | 'category' | 'brand' | 'blog' | 'blog_category' | 'blog_post'

export type MenuItemNode = {
  id?: string
  type?: MenuItemType
  label: string
  /** Custom links only; page, category and brand items resolve their address on the storefront. */
  url: string | null
  /** The linked content page, category or brand (types "page", "category", "brand"). */
  target_id?: string | null
  open_in_new_tab: boolean
  is_visible: boolean
  is_mega: boolean
  mega_columns: number | null
  image_media_id: string | null
  children: MenuItemNode[]
}

export type MenuDetail = MenuSummary & { items: MenuItemNode[] }

export type LinkTargetPage = { id: string; slug: string; title: string; status: 'draft' | 'published' }
/** A category or brand a menu item can link to; `url` is null while it has no visible web listing. */
export type LinkTargetTerm = { id: string; name: string; url: string | null }
/** A blog category a menu item can link to (E11). */
export type LinkTargetBlogCategory = { id: string; name: string; slug: string }
/** A blog post a menu item can link to; drafts and scheduled posts are listed but flagged (E11). */
export type LinkTargetBlogPost = { id: string; title: string; slug: string; status: 'draft' | 'published'; state?: 'draft' | 'scheduled' | 'published' }
export type LinkTargets = {
  pages: LinkTargetPage[]
  categories?: LinkTargetTerm[]
  brands?: LinkTargetTerm[]
  blog_categories?: LinkTargetBlogCategory[]
  blog_posts?: LinkTargetBlogPost[]
}

export const BANNER_PLACEMENTS = ['hero_slider', 'home_promo', 'popup'] as const
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number]
export const BANNER_PLACEMENT_LABELS: Record<BannerPlacement, string> = {
  hero_slider: 'Hero slider',
  home_promo: 'Homepage promo tiles',
  popup: 'Popup',
}
/** How often a visitor sees the popup banner (E11). */
export const POPUP_FREQUENCIES = ['once_per_session', 'once_per_day', 'once_per_week'] as const
export type PopupFrequency = (typeof POPUP_FREQUENCIES)[number]
export const POPUP_FREQUENCY_LABELS: Record<PopupFrequency, string> = {
  once_per_session: 'Once per visit',
  once_per_day: 'Once a day',
  once_per_week: 'Once a week',
}
export const POPUP_DELAY = { min: 0, max: 60, default: 5 } as const
export type TextPosition = 'left' | 'center' | 'right'

export type Banner = {
  id: string
  placement: BannerPlacement
  name: string
  kicker: string | null
  title: string | null
  subtitle: string | null
  link_url: string | null
  button_label: string | null
  secondary_link_url: string | null
  secondary_button_label: string | null
  desktop_media_id: string
  mobile_media_id: string | null
  text_color: string
  text_position: TextPosition
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  /** Popup placement only (E11): seconds before it opens (0–60) and how often a visitor sees it; null elsewhere. */
  popup_delay_seconds?: number | null
  popup_frequency?: PopupFrequency | null
  /** Active and inside its schedule right now. */
  is_live: boolean
  state: 'live' | 'inactive' | 'scheduled' | 'ended'
  sort_order: number
  updated_at: string | null
}

export type BannerInput = Omit<Banner, 'id' | 'is_live' | 'state' | 'sort_order' | 'updated_at'>

export const SECTION_TYPES = [
  'hero_slider', 'banner_grid', 'rich_text', 'features_strip', 'testimonials', 'newsletter',
  'product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip', 'hot_deals', 'blog_posts',
] as const
export type SectionType = (typeof SECTION_TYPES)[number]
export type SectionState = 'live' | 'disabled' | 'scheduled' | 'expired'

export const BANNER_GRID_LAYOUTS = ['2-col', '3-col', '3-col-split', '4-col'] as const
export type BannerGridLayout = (typeof BANNER_GRID_LAYOUTS)[number]
export const FEATURE_ICONS = ['truck', 'shield-check', 'credit-card', 'headset', 'gift', 'rotate-ccw', 'badge-percent', 'clock', 'leaf', 'heart', 'star', 'store'] as const
export type FeatureIcon = (typeof FEATURE_ICONS)[number]

export type FeatureItem = { icon: FeatureIcon; title: string; text: string | null }
export type TestimonialItem = { quote: string; name: string; role: string | null; rating: number | null; avatar_media_id: string | null }

export const PRODUCT_SOURCES = ['manual', 'featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category'] as const
export type ProductSource = (typeof PRODUCT_SOURCES)[number]
export type TabSource = Exclude<ProductSource, 'manual'>
export type ProductTab = { label: string; source: TabSource; category_id: string | null }

/** Section configs exactly as the API stores them (backend Domain/SectionType). */
export type SectionConfigs = {
  hero_slider: { autoplay_seconds: number; height: 'medium' | 'large' }
  banner_grid: { layout: BannerGridLayout }
  rich_text: { body_html: string; alignment: 'left' | 'center'; width: 'narrow' | 'wide'; background: string | null }
  features_strip: { items: FeatureItem[]; background: string | null }
  testimonials: { items: TestimonialItem[]; background: string | null }
  newsletter: { text: string | null; button_label: string; image_media_id: string | null; background: string; foreground: string }
  product_carousel: { source: ProductSource; category_id: string | null; limit: number; view_all_url: string | null }
  product_grid: { source: ProductSource; category_id: string | null; limit: number; columns: 3 | 4 | 5; view_all_url: string | null }
  product_tabs: { tabs: ProductTab[]; limit: number }
  category_strip: { source: 'manual' | 'top_level'; limit: number }
  brand_strip: { source: 'manual' | 'all'; limit: number }
  /** Flash-sale products (E8b): one countdown promotion, or every live one when `promotion_id` is null. */
  hot_deals: { promotion_id: string | null; limit: number; view_all_url: string | null }
  /** Latest blog posts (E11): one category or all (`category_id` null); 3–12 posts. */
  blog_posts: { category_id: string | null; limit: number; view_all_url: string | null }
}
export type AnySectionConfig = SectionConfigs[SectionType]

export type HomepageSection = {
  id: string
  type: SectionType
  type_label: string
  title: string | null
  subtitle: string | null
  config: AnySectionConfig
  banner_ids: string[]
  /** Hand-picked products, categories or brands of a manual product/category/brand section, in order. */
  item_ids?: string[]
  /** The same records with their names, when the API includes them. */
  items?: SectionItemRef[]
  is_enabled: boolean
  starts_at: string | null
  ends_at: string | null
  state: SectionState
  sort_order: number
  updated_at: string | null
}

export type SectionItemRef = { id: string; name: string; image_url?: string | null }

export type SectionTypeInfo = {
  type: SectionType
  label: string
  description: string
  banner_placement: BannerPlacement | null
  items: { min: number; max: number } | null
  defaults: AnySectionConfig
}

export type SectionInput = {
  type?: SectionType
  title: string | null
  subtitle: string | null
  config: AnySectionConfig
  banner_ids?: string[]
  item_ids?: string[]
  is_enabled: boolean
  starts_at: string | null
  ends_at: string | null
}

export const storefrontKeys = {
  all: ['storefront'] as const,
  settings: ['storefront', 'settings'] as const,
  domains: ['storefront', 'domains'] as const,
  theme: ['storefront', 'theme'] as const,
  menus: ['storefront', 'menus'] as const,
  menu: (id: string) => ['storefront', 'menus', id] as const,
  linkTargets: ['storefront', 'link-targets'] as const,
  banners: ['storefront', 'banners'] as const,
  sections: ['storefront', 'homepage-sections'] as const,
  sectionTypes: ['storefront', 'homepage-sections', 'types'] as const,
}

export function useStorefrontSettingsQuery() {
  return useQuery({
    queryKey: storefrontKeys.settings,
    queryFn: ({ signal }) => api.get<StorefrontSettings>('/storefront/settings', { signal }).then((r) => r.data),
  })
}

export function useSaveStorefrontSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Partial<Pick<StorefrontSettings, 'is_enabled' | 'site_name' | 'meta_description' | 'fulfilment_store_id' | 'guest_checkout_enabled' | 'return_window_days' | 'allow_indexing'>>) =>
      api.patch<StorefrontSettings>('/storefront/settings', input).then((r) => r.data),
    onSuccess: (data) => queryClient.setQueryData(storefrontKeys.settings, data),
  })
}

export function useStorefrontDomainsQuery() {
  return useQuery({
    queryKey: storefrontKeys.domains,
    queryFn: ({ signal }) => api.get<StorefrontDomain[]>('/storefront/domains', { signal }).then((r) => r.data),
  })
}

export function useAddDomainMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (host: string) => api.post<StorefrontDomain>('/storefront/domains', { host }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.domains }),
  })
}

export function useMakeDomainPrimaryMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.patch<StorefrontDomain>(`/storefront/domains/${id}`, { is_primary: true }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.domains }),
  })
}

export function useRemoveDomainMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/storefront/domains/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.domains }),
  })
}

export function useThemeQuery() {
  return useQuery({
    queryKey: storefrontKeys.theme,
    queryFn: ({ signal }) => api.get<ThemeResponse>('/storefront/theme', { signal }).then((r) => r.data),
  })
}

export function useSaveThemeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: ThemeDocument) => api.put<ThemeResponse>('/storefront/theme', settings).then((r) => r.data),
    onSuccess: (data) => queryClient.setQueryData(storefrontKeys.theme, data),
  })
}

export function useSaveCustomCssMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (css: string | null) => api.put<ThemeResponse>('/storefront/theme/custom-css', { custom_css: css }).then((r) => r.data),
    onSuccess: (data) => queryClient.setQueryData(storefrontKeys.theme, data),
  })
}

export function useMenusQuery() {
  return useQuery({
    queryKey: storefrontKeys.menus,
    queryFn: ({ signal }) => api.get<MenuSummary[]>('/storefront/menus', { signal }).then((r) => r.data),
  })
}

export function useMenuQuery(id: string | null) {
  return useQuery({
    queryKey: storefrontKeys.menu(id ?? ''),
    queryFn: ({ signal }) => api.get<MenuDetail>(`/storefront/menus/${id}`, { signal }).then((r) => r.data),
    enabled: id !== null,
  })
}

export function useSaveMenuMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: { name?: string; location?: MenuLocation; is_active?: boolean } }) =>
      (id ? api.patch<MenuDetail>(`/storefront/menus/${id}`, input) : api.post<MenuDetail>('/storefront/menus', input)).then((r) => r.data),
    onSuccess: (menu) => {
      queryClient.setQueryData(storefrontKeys.menu(menu.id), menu)
      return queryClient.invalidateQueries({ queryKey: storefrontKeys.menus, exact: true })
    },
  })
}

export function useReplaceMenuItemsMutation(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (items: MenuItemNode[]) => api.put<MenuDetail>(`/storefront/menus/${id}/items`, { items }).then((r) => r.data),
    onSuccess: (menu) => queryClient.setQueryData(storefrontKeys.menu(menu.id), menu),
  })
}

export function useDeleteMenuMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/storefront/menus/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.menus, exact: true }),
  })
}

export function useLinkTargetsQuery() {
  return useQuery({
    queryKey: storefrontKeys.linkTargets,
    queryFn: ({ signal }) => api.get<LinkTargets>('/storefront/link-targets', { signal }).then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useBannersQuery() {
  return useQuery({
    queryKey: storefrontKeys.banners,
    queryFn: ({ signal }) => api.get<Banner[]>('/storefront/banners', { signal }).then((r) => r.data),
  })
}

export function useSaveBannerMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<BannerInput> }) =>
      (id ? api.patch<Banner>(`/storefront/banners/${id}`, input) : api.post<Banner>('/storefront/banners', input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.banners }),
  })
}

export function useDeleteBannerMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/storefront/banners/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.banners }),
  })
}

export function useReorderBannersMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { placement: BannerPlacement; ids: string[] }) => api.put<Banner[]>('/storefront/banners/order', input).then((r) => r.data),
    onSuccess: (banners) => queryClient.setQueryData(storefrontKeys.banners, banners),
  })
}

export function useSectionTypesQuery() {
  return useQuery({
    queryKey: storefrontKeys.sectionTypes,
    queryFn: ({ signal }) => api.get<SectionTypeInfo[]>('/storefront/homepage-sections/types', { signal }).then((r) => r.data),
    staleTime: Infinity,
  })
}

export function useSectionsQuery() {
  return useQuery({
    queryKey: storefrontKeys.sections,
    queryFn: ({ signal }) => api.get<HomepageSection[]>('/storefront/homepage-sections', { signal }).then((r) => r.data),
  })
}

export function useSaveSectionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<SectionInput> }) =>
      (id ? api.patch<HomepageSection>(`/storefront/homepage-sections/${id}`, input) : api.post<HomepageSection>('/storefront/homepage-sections', input)).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.sections, exact: true }),
  })
}

export function useDuplicateSectionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.post<HomepageSection>(`/storefront/homepage-sections/${id}/duplicate`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.sections, exact: true }),
  })
}

export function useDeleteSectionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/storefront/homepage-sections/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storefrontKeys.sections, exact: true }),
  })
}

export function useReorderSectionsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => api.put<HomepageSection[]>('/storefront/homepage-sections/order', { ids }).then((r) => r.data),
    onSuccess: (sections) => queryClient.setQueryData(storefrontKeys.sections, sections),
  })
}
