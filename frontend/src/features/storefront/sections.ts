import type { SectionTab } from '@/features/inventory/sections'

export const STOREFRONT_TABS: SectionTab[] = [
  { to: '/storefront', label: 'Settings & domains', permission: 'storefront.view' },
  { to: '/storefront/theme', label: 'Theme', permission: 'storefront.view' },
  { to: '/storefront/menus', label: 'Menus', permission: 'storefront.view' },
  { to: '/storefront/homepage', label: 'Homepage', permission: 'storefront.view' },
  { to: '/storefront/banners', label: 'Banners', permission: 'storefront.view' },
  { to: '/storefront/categories', label: 'Categories', permission: 'online_catalog.view' },
  { to: '/storefront/brands', label: 'Brands', permission: 'online_catalog.view' },
]
