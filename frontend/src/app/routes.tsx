import type { ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { HomeRedirect } from '@/app/home-redirect'
import { AppLayout } from '@/app/layouts/app-layout'
import { NotFoundPage, RouteError } from '@/app/route-error'
import { LoadingState } from '@/components/common/state-views'
import { GuestOnly, RequireAuth, RequirePermission, RequirePlatformAdmin } from '@/features/auth/components/route-guards'
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password-page'
import { LoginPage } from '@/features/auth/pages/login-page'
import { RegisterPage } from '@/features/auth/pages/register-page'
import { ResetPasswordPage } from '@/features/auth/pages/reset-password-page'

type PageModule = Record<string, unknown>

/**
 * Feature pages are code-split: each is fetched the first time its route is visited.
 * The shell, auth pages and guards stay in the main bundle.
 */
function page(load: () => Promise<PageModule>, exportName: string): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      const Component = (await load())[exportName] as ComponentType | undefined
      if (!Component) throw new Error(`Page export ${exportName} not found`)
      return { Component }
    },
  }
}

function guarded(permission: string | string[], path: string, lazyPage: Pick<RouteObject, 'lazy'>): RouteObject {
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
  stock: page(() => import('@/features/inventory/pages/stock-page'), 'StockPage'),
  batches: page(() => import('@/features/inventory/pages/stock-page'), 'BatchesPage'),
  movements: page(() => import('@/features/inventory/pages/stock-page'), 'MovementsPage'),
  adjustments: page(() => import('@/features/inventory/pages/adjustment-pages'), 'AdjustmentsPage'),
  newAdjustment: page(() => import('@/features/inventory/pages/adjustment-pages'), 'NewAdjustmentPage'),
  transfers: page(() => import('@/features/inventory/pages/transfer-pages'), 'TransfersPage'),
  newTransfer: page(() => import('@/features/inventory/pages/transfer-pages'), 'NewTransferPage'),
  purchaseOrders: page(() => import('@/features/purchasing/pages/order-pages'), 'PurchaseOrdersPage'),
  purchaseOrder: page(() => import('@/features/purchasing/pages/order-pages'), 'PurchaseOrderPage'),
  receipts: page(() => import('@/features/purchasing/pages/receipt-pages'), 'ReceiptsPage'),
  newReceipt: page(() => import('@/features/purchasing/pages/receipt-pages'), 'NewReceiptPage'),
  receipt: page(() => import('@/features/purchasing/pages/receipt-pages'), 'ReceiptPage'),
  purchaseReturns: page(() => import('@/features/purchasing/pages/receipt-pages'), 'ReturnsPage'),
  payments: page(() => import('@/features/purchasing/pages/payment-pages'), 'PaymentsPage'),
  posTerminal: page(() => import('@/features/pos/pages/pos-terminal-page'), 'PosTerminalPage'),
  sales: page(() => import('@/features/sales/pages/sales-pages'), 'SalesPage'),
  sale: page(() => import('@/features/sales/pages/sales-pages'), 'SalePage'),
  storefrontSettings: page(() => import('@/features/storefront/pages/storefront-settings-page'), 'StorefrontSettingsPage'),
  storefrontTheme: page(() => import('@/features/storefront/pages/theme-page'), 'ThemePage'),
  storefrontMenus: page(() => import('@/features/storefront/pages/menus-page'), 'MenusPage'),
  mediaLibrary: page(() => import('@/features/media/pages/media-library-page'), 'MediaLibraryPage'),
  storefrontHomepage: page(() => import('@/features/storefront/pages/homepage-page'), 'HomepagePage'),
  storefrontBanners: page(() => import('@/features/storefront/pages/banners-page'), 'BannersPage'),
  webCategories: page(() => import('@/features/online-catalog/pages/web-taxonomy-pages'), 'WebCategoriesPage'),
  webBrands: page(() => import('@/features/online-catalog/pages/web-taxonomy-pages'), 'WebBrandsPage'),
  productListing: page(() => import('@/features/online-catalog/pages/product-listing-page'), 'ProductListingPage'),
  contentPages: page(() => import('@/features/content/pages/pages-page'), 'PagesPage'),
  contentPage: page(() => import('@/features/content/pages/page-editor-page'), 'PageEditorPage'),
  contentFaq: page(() => import('@/features/content/pages/faq-page'), 'FaqPage'),
  contentMessages: page(() => import('@/features/content/pages/messages-page'), 'MessagesPage'),
  contentNewsletter: page(() => import('@/features/content/pages/newsletter-page'), 'NewsletterPage'),
  newReturn: page(() => import('@/features/returns/pages/return-pages'), 'NewReturnPage'),
  returns: page(() => import('@/features/returns/pages/return-pages'), 'ReturnsPage'),
  saleReturn: page(() => import('@/features/returns/pages/return-pages'), 'ReturnPage'),
  cashRegisters: page(() => import('@/features/registers/pages/register-pages'), 'CashRegistersPage'),
  registerSessions: page(() => import('@/features/registers/pages/register-pages'), 'RegisterSessionsPage'),
  registerSession: page(() => import('@/features/registers/pages/register-pages'), 'RegisterSessionPage'),
  paymentsLedger: page(() => import('@/features/payments/pages/payment-pages'), 'PaymentsPage'),
  customerPayments: page(() => import('@/features/payments/pages/payment-pages'), 'CustomerPaymentsPage'),
  expenses: page(() => import('@/features/expenses/pages/expenses-page'), 'ExpensesPage'),
  loyalty: page(() => import('@/features/loyalty/pages/loyalty-page'), 'LoyaltyPage'),
}

const REGISTER_PERMISSIONS = ['cash_registers.view', 'cash_registers.operate', 'cash_registers.manage']

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
              guarded('pos.sell', 'pos', pages.posTerminal),
              guarded('sales.view', 'sales', pages.sales),
              guarded('sales.view', 'sales/:saleId', pages.sale),
              {
                // Returning needs the invoice (sales.view) and the right to create returns.
                element: <RequirePermission permission="sales.view" />,
                children: [guarded('returns.create', 'sales/:saleId/return', pages.newReturn)],
              },
              guarded('returns.view', 'returns', pages.returns),
              guarded('returns.view', 'returns/:returnId', pages.saleReturn),
              guarded(REGISTER_PERMISSIONS, 'cash-registers', pages.cashRegisters),
              guarded(['cash_registers.view', 'cash_registers.operate'], 'cash-registers/sessions', pages.registerSessions),
              guarded(['cash_registers.view', 'cash_registers.operate'], 'cash-registers/sessions/:sessionId', pages.registerSession),
              guarded('payments.view', 'payments', pages.paymentsLedger),
              guarded('payments.view', 'payments/customers', pages.customerPayments),
              guarded('expenses.view', 'expenses', pages.expenses),
              guarded(['loyalty.view', 'loyalty.manage'], 'loyalty', pages.loyalty),
              guarded('products.view', 'products', pages.products),
              // Editing needs cost prices, so it requires both permissions.
              {
                element: <RequirePermission permission="products.manage" />,
                children: [
                  guarded('products.view_cost', 'products/new', pages.productEditor),
                  guarded('products.view_cost', 'products/:productId', pages.productEditor),
                ],
              },
              // Web listing on its own page for online store staff who do not edit products.
              guarded('online_catalog.view', 'products/:productId/online-store', pages.productListing),
              guarded('products.view', 'catalog', pages.catalog),
              guarded('customers.view', 'customers', pages.customers),
              guarded('suppliers.view', 'suppliers', pages.suppliers),
              guarded('inventory.view', 'inventory', pages.stock),
              guarded('inventory.view', 'inventory/batches', pages.batches),
              guarded('inventory.view', 'inventory/movements', pages.movements),
              guarded('inventory.view', 'inventory/adjustments', pages.adjustments),
              guarded('inventory.adjust', 'inventory/adjustments/new', pages.newAdjustment),
              guarded('inventory.view', 'inventory/transfers', pages.transfers),
              guarded('inventory.transfer', 'inventory/transfers/new', pages.newTransfer),
              guarded('purchases.view', 'purchasing/orders', pages.purchaseOrders),
              guarded('purchases.manage', 'purchasing/orders/new', pages.purchaseOrder),
              guarded('purchases.view', 'purchasing/orders/:orderId', pages.purchaseOrder),
              guarded('purchases.view', 'purchasing/receipts', pages.receipts),
              guarded('purchases.receive', 'purchasing/receipts/new', pages.newReceipt),
              guarded('purchases.view', 'purchasing/receipts/:receiptId', pages.receipt),
              guarded('purchases.view', 'purchasing/returns', pages.purchaseReturns),
              guarded('purchases.view', 'purchasing/payments', pages.payments),
              guarded('storefront.view', 'storefront', pages.storefrontSettings),
              guarded('storefront.view', 'storefront/theme', pages.storefrontTheme),
              guarded('storefront.view', 'storefront/menus', pages.storefrontMenus),
              guarded('storefront.view', 'storefront/homepage', pages.storefrontHomepage),
              guarded('storefront.view', 'storefront/banners', pages.storefrontBanners),
              guarded('online_catalog.view', 'storefront/categories', pages.webCategories),
              guarded('online_catalog.view', 'storefront/brands', pages.webBrands),
              { path: 'content', element: <Navigate to="/content/pages" replace /> },
              guarded('cms.manage', 'content/pages', pages.contentPages),
              guarded('cms.manage', 'content/pages/new', pages.contentPage),
              guarded('cms.manage', 'content/pages/:pageId', pages.contentPage),
              guarded('cms.manage', 'content/faq', pages.contentFaq),
              guarded('cms.manage', 'content/messages', pages.contentMessages),
              guarded('cms.manage', 'content/newsletter', pages.contentNewsletter),
              guarded('media.manage', 'media', pages.mediaLibrary),
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
