import type { LucideIcon } from 'lucide-react'
import { ActivityIcon, BoxesIcon, BuildingIcon, Building2Icon, ContactIcon, GiftIcon, GlobeIcon, HandCoinsIcon, ImagesIcon, PackageIcon, ReceiptIcon, ReceiptTextIcon, ScanBarcodeIcon, ScrollTextIcon, ShieldCheckIcon, ShoppingCartIcon, StoreIcon, TagsIcon, TruckIcon, Undo2Icon, UsersIcon, WalletIcon } from 'lucide-react'
import type { CurrentUser } from '@/features/auth/types'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Permission required to see the entry, or any of a list (mirrors the route guard and the API). */
  permission?: string | string[]
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
  { to: '/returns', label: 'Returns', icon: Undo2Icon, permission: 'returns.view' },
  { to: '/cash-registers', label: 'Cash registers', icon: WalletIcon, permission: ['cash_registers.view', 'cash_registers.operate', 'cash_registers.manage'] },
  { to: '/payments', label: 'Payments', icon: HandCoinsIcon, permission: 'payments.view' },
  { to: '/expenses', label: 'Expenses', icon: ReceiptIcon, permission: 'expenses.view' },
  { to: '/products', label: 'Products', icon: PackageIcon, permission: 'products.view' },
  { to: '/catalog', label: 'Catalog', icon: TagsIcon, permission: 'products.view' },
  { to: '/inventory', label: 'Inventory', icon: BoxesIcon, permission: 'inventory.view' },
  { to: '/purchasing/orders', label: 'Purchasing', icon: ShoppingCartIcon, permission: 'purchases.view' },
  { to: '/customers', label: 'Customers', icon: ContactIcon, permission: 'customers.view' },
  { to: '/suppliers', label: 'Suppliers', icon: TruckIcon, permission: 'suppliers.view' },
  { to: '/loyalty', label: 'Loyalty', icon: GiftIcon, permission: ['loyalty.view', 'loyalty.manage'] },
  { to: '/storefront', label: 'Online store', icon: GlobeIcon, permission: 'storefront.view' },
  { to: '/media', label: 'Media library', icon: ImagesIcon, permission: 'media.manage' },
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
    const required = item.permission === undefined ? [] : Array.isArray(item.permission) ? item.permission : [item.permission]
    return required.length === 0 || isPlatform || required.some((p) => me.permissions.includes(p))
  })
}
