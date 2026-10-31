import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { HomeRedirect } from '@/app/home-redirect'
import { AppLayout } from '@/app/layouts/app-layout'
import { NotFoundPage, RouteError } from '@/app/route-error'
import { LoadingState } from '@/components/common/state-views'
import { GuestOnly, RequireAuth, RequirePermission, RequirePlatformAdmin } from '@/features/auth/components/route-guards'
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page'
import { LoginPage } from '@/features/auth/pages/login-page'
import { RegisterPage } from '@/features/auth/pages/register-page'
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page'

type PageModule = Record<string, ComponentType>

/**
 * Feature pages are code-split: each is fetched the first time its route is visited.
 * The shell, auth pages and guards stay in the main bundle.
 */
function page(load: () => Promise<PageModule>, exportName: string): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      const Component = (await load())[exportName]
      if (!Component) throw new Error(`Page export ${exportName} not found`)
      return { Component }
    },
  }
}

function guarded(permission: string, path: string, lazyPage: Pick<RouteObject, 'lazy'>): RouteObject {
  return { element: <RequirePermission permission={permission} />, children: [{ path, ...lazyPage }] }
}

const pages = {
  products: page(() => import('@/features/products/pages/products-page'), 'ProductsPage'),
  productEditor: page(() => import('@/features/products/pages/product-editor-page'), 'ProductEditorPage'),
  catalog: page(() => import('@/features/catalog/pages/catalog-page'), 'CatalogPage'),
  customers: page(() => import('@/features/customers/pages/customers-page'), 'CustomersPage'),
  suppliers: page(() => import('@/features/suppliers/pages/suppliers-page'), 'SuppliersPage'),
  branches: page(() => import('@/features/branches/pages/branches-page'), 'BranchesPage'),
  users: page(() => import('@/features/users/pages/users-page'), 'UsersPage'),
  roles: page(() => import('@/features/roles/pages/roles-page'), 'RolesPage'),
  organization: page(() => import('@/features/organization/pages/organization-page'), 'OrganizationPage'),
  auditLog: page(() => import('@/features/audit/pages/audit-log-page'), 'AuditLogPage'),
  platformOrganizations: page(() => import('@/features/platform/pages/platform-organizations-page'), 'PlatformOrganizationsPage'),
  profile: page(() => import('@/features/profile/pages/profile-page'), 'ProfilePage'),
  systemStatus: page(() => import('@/features/system/pages/system-status-page'), 'SystemStatusPage'),
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: (
      <div className="p-6">
        <LoadingState rows={3} label="Loading" />
      </div>
    ),
    children: [
      // Reset links are valid whether or not someone is signed in on this browser.
      { path: 'reset-password', element: <ResetPasswordPage /> },
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomeRedirect /> },
              guarded('products.view', 'products', pages.products),
              // Editing needs cost prices, so it requires both permissions.
              {
                element: <RequirePermission permission="products.manage" />,
                children: [
                  guarded('products.view_cost', 'products/new', pages.productEditor),
                  guarded('products.view_cost', 'products/:productId', pages.productEditor),
                ],
              },
              guarded('products.view', 'catalog', pages.catalog),
              guarded('customers.view', 'customers', pages.customers),
              guarded('suppliers.view', 'suppliers', pages.suppliers),
              guarded('branches.view', 'branches', pages.branches),
              guarded('users.view', 'users', pages.users),
              guarded('roles.view', 'roles', pages.roles),
              guarded('organization.view', 'organization', pages.organization),
              guarded('audit.view', 'audit-log', pages.auditLog),
              { element: <RequirePlatformAdmin />, children: [{ path: 'platform/organizations', ...pages.platformOrganizations }] },
              { path: 'profile', ...pages.profile },
              { path: 'system-status', ...pages.systemStatus },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]
