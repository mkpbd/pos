import type { CurrentUser } from '@/features/auth/types'

export const ADMIN_PERMISSIONS = [
  'audit.view',
  'branches.access_all',
  'branches.manage',
  'branches.view',
  'organization.update',
  'organization.view',
  'roles.manage',
  'roles.view',
  'users.manage',
  'users.view',
]

export function makeCurrentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    user: { id: 'u-1', name: 'Rahim Uddin', email: 'rahim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    organization: { id: 'o-1', name: 'Corner Shop', slug: 'corner-shop', base_currency: 'BDT', timezone: 'Asia/Dhaka', tax_mode: 'exclusive', status: 'active' },
    roles: [{ id: 'r-1', name: 'Organization Admin', system_key: 'organization_admin' }],
    permissions: ADMIN_PERMISSIONS,
    branches: [
      { id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true },
      { id: 'b-2', code: 'NORTH', name: 'North', is_active: true },
    ],
    ...overrides,
  }
}

export const cashier = (): CurrentUser =>
  makeCurrentUser({
    user: { id: 'u-2', name: 'Karim Cashier', email: 'karim@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }],
    permissions: ['branches.view'],
    branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  })

export const CATALOG_MANAGER_PERMISSIONS = [
  'branches.view',
  'brands.manage',
  'categories.manage',
  'customers.create',
  'customers.manage',
  'customers.view',
  'products.manage',
  'products.view',
  'products.view_cost',
  'suppliers.manage',
  'suppliers.view',
  'taxes.manage',
  'units.manage',
]

export const catalogManager = (): CurrentUser =>
  makeCurrentUser({
    roles: [{ id: 'r-4', name: 'Store Manager', system_key: null }],
    permissions: CATALOG_MANAGER_PERMISSIONS,
  })

export const counterCashier = (): CurrentUser =>
  makeCurrentUser({
    user: { id: 'u-3', name: 'Till Cashier', email: 'till@corner.test', phone: null, is_platform_admin: false, last_login_at: null },
    roles: [{ id: 'r-3', name: 'Cashier', system_key: 'cashier' }],
    permissions: ['branches.view', 'customers.create', 'customers.view', 'products.view'],
    branches: [{ id: 'b-1', code: 'MAIN', name: 'Main Branch', is_active: true }],
  })
