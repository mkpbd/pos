import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export type StorefrontSettings = {
  is_enabled: boolean
  site_name: string
  meta_description: string | null
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

export type MenuItemNode = {
  id?: string
  type?: 'custom'
  label: string
  url: string
  open_in_new_tab: boolean
  is_visible: boolean
  is_mega: boolean
  mega_columns: number | null
  image_media_id: string | null
  children: MenuItemNode[]
}

export type MenuDetail = MenuSummary & { items: MenuItemNode[] }

export const storefrontKeys = {
  all: ['storefront'] as const,
  settings: ['storefront', 'settings'] as const,
  domains: ['storefront', 'domains'] as const,
  theme: ['storefront', 'theme'] as const,
  menus: ['storefront', 'menus'] as const,
  menu: (id: string) => ['storefront', 'menus', id] as const,
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
    mutationFn: (input: Partial<Pick<StorefrontSettings, 'is_enabled' | 'site_name' | 'meta_description'>>) =>
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
