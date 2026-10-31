import type { LucideIcon } from 'lucide-react'
import { ActivityIcon, BoxesIcon, BuildingIcon, Building2Icon, ContactIcon, PackageIcon, ReceiptTextIcon, ScanBarcodeIcon, ScrollTextIcon, ShieldCheckIcon, ShoppingCartIcon, StoreIcon, TagsIcon, TruckIcon, UsersIcon } from 'lucide-react'
import type { CurrentUser } from '@/features/auth/types'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Permission required to see the entry (mirrors the route guard and the API). */
  permission?: string
  /** Platform-admin only. */
  platform?: boolean
}

/**
 * Sidebar entries. A module is listed here only once its pages are backed by
 * working API endpoints — no placeholder links.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/pos', label: 'POS Terminal', icon: ScanBarcodeIcon, permission: 'pos.sell' },
  { to: '/sales', label: 'Sales', icon: ReceiptTextIcon, permission: 'sales.view' },
  { to: '/products', label: 'Products', icon: PackageIcon, permission: 'products.view' },
  { to: '/catalog', label: 'Catalog', icon: TagsIcon, permission: 'products.view' },
  { to: '/inventory', label: 'Inventory', icon: BoxesIcon, permission: 'inventory.view' },
  { to: '/purchasing/orders', label: 'Purchasing', icon: ShoppingCartIcon, permission: 'purchases.view' },
  { to: '/customers', label: 'Customers', icon: ContactIcon, permission: 'customers.view' },
  { to: '/suppliers', label: 'Suppliers', icon: TruckIcon, permission: 'suppliers.view' },
  { to: '/branches', label: 'Branches', icon: StoreIcon, permission: 'branches.view' },
  { to: '/users', label: 'Users', icon: UsersIcon, permission: 'users.view' },
  { to: '/roles', label: 'Roles & permissions', icon: ShieldCheckIcon, permission: 'roles.view' },
  { to: '/organization', label: 'Organization', icon: BuildingIcon, permission: 'organization.view' },
  { to: '/audit-log', label: 'Audit log', icon: ScrollTextIcon, permission: 'audit.view' },
  { to: '/platform/organizations', label: 'All organizations', icon: Building2Icon, platform: true },
  { to: '/system-status', label: 'System status', icon: ActivityIcon },
]

export function visibleNavItems(me: CurrentUser): NavItem[] {
  const isPlatform = me.user.is_platform_admin

  return NAV_ITEMS.filter((item) => {
    if (item.platform) return isPlatform
    // Tenant pages need an organization; platform admins without one only see platform pages.
    if (item.permission && !me.organization) return false
    return !item.permission || isPlatform || me.permissions.includes(item.permission)
  })
}
