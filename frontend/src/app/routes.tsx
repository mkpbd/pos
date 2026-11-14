import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { HomeRedirect } from '@/app/home-redirect'
import { ContentRedirect } from '@/app/content-redirect'
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
  dashboard: page(() => import('@/features/dashboard/pages/dashboard-page'), 'DashboardPage'),
  reports: page(() => import('@/features/reports/pages/reports-page'), 'ReportsPage'),
  aiInsights: page(() => import('@/features/ai/pages/ai-insights-page'), 'AiInsightsPage'),
  report: page(() => import('@/features/reports/pages/report-page'), 'ReportPage'),
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
  reorder: page(() => import('@/features/supply-chain/pages/reorder-page'), 'ReorderPage'),
  supplier: page(() => import('@/features/supply-chain/pages/supplier-page'), 'SupplierPage'),
  inventorySettings: page(() => import('@/features/supply-chain/pages/inventory-settings-page'), 'InventorySettingsPage'),
  requisitions: page(() => import('@/features/procurement/pages/requisition-pages'), 'RequisitionsPage'),
  requisition: page(() => import('@/features/procurement/pages/requisition-pages'), 'RequisitionPage'),
  approvals: page(() => import('@/features/procurement/pages/approvals-page'), 'ApprovalsPage'),
  rfqs: page(() => import('@/features/procurement/pages/rfq-pages'), 'RfqsPage'),
  rfq: page(() => import('@/features/procurement/pages/rfq-pages'), 'RfqPage'),
  landedCosts: page(() => import('@/features/landed-cost/pages/voucher-pages'), 'VouchersPage'),
  landedCost: page(() => import('@/features/landed-cost/pages/voucher-pages'), 'VoucherPage'),
  supplierPerformance: page(() => import('@/features/supplier-performance/pages/supplier-performance-page'), 'SupplierPerformancePage'),
  purchasingSettings: page(() => import('@/features/procurement/pages/purchasing-settings-page'), 'PurchasingSettingsPage'),
  posTerminal: page(() => import('@/features/pos/pages/pos-terminal-page'), 'PosTerminalPage'),
  sales: page(() => import('@/features/sales/pages/sales-pages'), 'SalesPage'),
  sale: page(() => import('@/features/sales/pages/sales-pages'), 'SalePage'),
  storefrontSettings: page(() => import('@/features/storefront/pages/storefront-settings-page'), 'StorefrontSettingsPage'),
  storefrontTheme: page(() => import('@/features/storefront/pages/theme-page'), 'ThemePage'),
  storefrontMenus: page(() => import('@/features/storefront/pages/menus-page'), 'MenusPage'),
  mediaLibrary: page(() => import('@/features/media/pages/media-library-page'), 'MediaLibraryPage'),
  storefrontHomepage: page(() => import('@/features/storefront/pages/homepage-page'), 'HomepagePage'),
  storefrontBanners: page(() => import('@/features/storefront/pages/banners-page'), 'BannersPage'),
  storeBuilderPages: page(() => import('@/features/store-builder/pages/pages-page'), 'StoreBuilderPagesPage'),
  storeBuilderEditor: page(() => import('@/features/store-builder/pages/editor-page'), 'StoreBuilderEditorPage'),
  webCategories: page(() => import('@/features/online-catalog/pages/web-taxonomy-pages'), 'WebCategoriesPage'),
  webBrands: page(() => import('@/features/online-catalog/pages/web-taxonomy-pages'), 'WebBrandsPage'),
  sizeGuides: page(() => import('@/features/storefront/pages/size-guides-page'), 'SizeGuidesPage'),
  productListing: page(() => import('@/features/online-catalog/pages/product-listing-page'), 'ProductListingPage'),
  contentPages: page(() => import('@/features/content/pages/pages-page'), 'PagesPage'),
  contentPage: page(() => import('@/features/content/pages/page-editor-page'), 'PageEditorPage'),
  contentBlog: page(() => import('@/features/content/pages/blog-posts-page'), 'BlogPostsPage'),
  contentBlogPost: page(() => import('@/features/content/pages/blog-post-editor-page'), 'BlogPostEditorPage'),
  contentFaq: page(() => import('@/features/content/pages/faq-page'), 'FaqPage'),
  contentMessages: page(() => import('@/features/content/pages/messages-page'), 'MessagesPage'),
  contentNewsletter: page(() => import('@/features/content/pages/newsletter-page'), 'NewsletterPage'),
  contentForms: page(() => import('@/features/content/pages/form-submissions-page'), 'FormSubmissionsPage'),
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
  webOrders: page(() => import('@/features/web-orders/pages/web-order-pages'), 'WebOrdersPage'),
  webOrder: page(() => import('@/features/web-orders/pages/web-order-pages'), 'WebOrderPage'),
  webOrdersPrint: page(() => import('@/features/web-orders/pages/print-page'), 'WebOrdersPrintPage'),
  webReturns: page(() => import('@/features/web-returns/pages/web-return-pages'), 'WebReturnsPage'),
  webReturn: page(() => import('@/features/web-returns/pages/web-return-pages'), 'WebReturnPage'),
  codRemittances: page(() => import('@/features/cod-remittances/pages/remittance-pages'), 'CodRemittancesPage'),
  newCodRemittance: page(() => import('@/features/cod-remittances/pages/remittance-pages'), 'NewCodRemittancePage'),
  codRemittance: page(() => import('@/features/cod-remittances/pages/remittance-pages'), 'CodRemittancePage'),
  promotions: page(() => import('@/features/promotions/pages/promotions-page'), 'PromotionsPage'),
  promotion: page(() => import('@/features/promotions/pages/promotion-editor-page'), 'PromotionEditorPage'),
  reviews: page(() => import('@/features/reviews/pages/reviews-page'), 'ReviewsPage'),
  productQuestions: page(() => import('@/features/reviews/pages/questions-page'), 'QuestionsPage'),
  storefrontShipping: page(() => import('@/features/shipping/pages/shipping-page'), 'ShippingPage'),
  storefrontCouriers: page(() => import('@/features/shipping/pages/couriers-page'), 'CouriersPage'),
  storefrontPayments: page(() => import('@/features/online-payments/pages/payment-methods-page'), 'PaymentMethodsPage'),
}

/** Landed cost vouchers (SC3): creating, editing and posting. Mirrors LANDED_COST_PERMISSIONS.manage. */
const LANDED_COST_MANAGE = 'purchases.landed_cost'
const REGISTER_PERMISSIONS = ['cash_registers.view', 'cash_registers.operate', 'cash_registers.manage']
/** Requesters see their own requisitions; approvers and purchasing staff see the branch's (SC2). */
const REQUISITION_PERMISSIONS = ['purchases.view', 'purchases.request', 'purchases.approve', 'purchases.approve_high']
/** Operational and financial reports (Phase 7); each report's own permission is checked by the API. */
const REPORT_PERMISSIONS = ['reports.view', 'reports.financial']
/** AI Insights (Phase 8): Ask needs ai.ask, the insight tabs ai.insights. Mirrors AI_PAGE_PERMISSIONS. */
const AI_PAGE_PERMISSIONS = ['ai.insights', 'ai.ask']
/** The AI settings card lives on the Organization page (ai.manage). */
const ORGANIZATION_PERMISSIONS = ['organization.view', 'ai.manage']

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
          // Print sheets: own minimal layout, no admin chrome (E10a).
          guarded('web_orders.view', 'web-orders/print', pages.webOrdersPrint),
          // Store builder editor (B2): full screen, outside the admin shell.
          guarded('storefront.manage', 'storefront/builder/:documentId', pages.storeBuilderEditor),
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <HomeRedirect /> },
              guarded('dashboard.view', 'dashboard', pages.dashboard),
              guarded(REPORT_PERMISSIONS, 'reports', pages.reports),
              guarded(REPORT_PERMISSIONS, 'reports/:reportKey', pages.report),
              guarded(AI_PAGE_PERMISSIONS, 'ai', pages.aiInsights),
              guarded('pos.sell', 'pos', pages.posTerminal),
              guarded('sales.view', 'sales', pages.sales),
              guarded('sales.view', 'sales/:saleId', pages.sale),
              {
                // Returning needs the invoice (sales.view) and the right to create returns.
                element: <RequirePermission permission="sales.view" />,
                children: [guarded('returns.create', 'sales/:saleId/return', pages.newReturn)],
              },
              guarded('web_orders.view', 'web-orders', pages.webOrders),
              guarded('web_orders.view', 'web-orders/:orderId', pages.webOrder),
              // Viewers see returns read-only; approve / reject / receive / refund need web_orders.refund (E10b).
              guarded('web_orders.view', 'web-returns', pages.webReturns),
              guarded('web_orders.view', 'web-returns/:returnId', pages.webReturn),
              guarded('web_orders.remit', 'cod-remittances', pages.codRemittances),
              guarded('web_orders.remit', 'cod-remittances/new', pages.newCodRemittance),
              guarded('web_orders.remit', 'cod-remittances/:remittanceId', pages.codRemittance),
              guarded('promotions.view', 'promotions', pages.promotions),
              guarded('promotions.manage', 'promotions/new', pages.promotion),
              // Viewers see the same page read-only; write actions need promotions.manage.
              guarded('promotions.view', 'promotions/:promotionId', pages.promotion),
              // Moderators and viewers share the page; approve / reject / delete need reviews.moderate.
              guarded('reviews.view', 'reviews', pages.reviews),
              // P1b: shoppers' questions; answering, rejecting and deleting need reviews.moderate (bell link ?status=pending).
              guarded('reviews.view', 'reviews/questions', pages.productQuestions),
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
              // Catalog tab needs purchases.view as well (checked on the page).
              guarded('suppliers.view', 'suppliers/:supplierId', pages.supplier),
              guarded('inventory.view', 'inventory', pages.stock),
              guarded('inventory.view', 'inventory/batches', pages.batches),
              guarded('inventory.view', 'inventory/movements', pages.movements),
              guarded('inventory.view', 'inventory/adjustments', pages.adjustments),
              guarded('inventory.adjust', 'inventory/adjustments/new', pages.newAdjustment),
              guarded('inventory.view', 'inventory/transfers', pages.transfers),
              guarded('inventory.transfer', 'inventory/transfers/new', pages.newTransfer),
              guarded('inventory.manage', 'inventory/settings', pages.inventorySettings),
              guarded('purchases.view', 'purchasing/orders', pages.purchaseOrders),
              guarded('purchases.view', 'purchasing/reorder', pages.reorder),
              guarded('purchases.manage', 'purchasing/orders/new', pages.purchaseOrder),
              guarded(REQUISITION_PERMISSIONS, 'purchasing/requisitions', pages.requisitions),
              guarded('purchases.request', 'purchasing/requisitions/new', pages.requisition),
              guarded(REQUISITION_PERMISSIONS, 'purchasing/requisitions/:requisitionId', pages.requisition),
              guarded(['purchases.approve', 'purchases.approve_high'], 'purchasing/approvals', pages.approvals),
              // Viewers see RFQs read-only; creating, sending, quotes and awards need purchases.manage.
              guarded('purchases.view', 'purchasing/rfqs', pages.rfqs),
              guarded('purchases.manage', 'purchasing/rfqs/new', pages.rfq),
              guarded('purchases.view', 'purchasing/rfqs/:rfqId', pages.rfq),
              guarded('purchases.settings', 'purchasing/settings', pages.purchasingSettings),
              guarded('purchases.view', 'purchasing/orders/:orderId', pages.purchaseOrder),
              guarded('purchases.view', 'purchasing/receipts', pages.receipts),
              guarded('purchases.receive', 'purchasing/receipts/new', pages.newReceipt),
              guarded('purchases.view', 'purchasing/receipts/:receiptId', pages.receipt),
              guarded('purchases.view', 'purchasing/returns', pages.purchaseReturns),
              guarded('purchases.view', 'purchasing/payments', pages.payments),
              guarded('purchases.view', 'purchasing/landed-costs', pages.landedCosts),
              guarded(LANDED_COST_MANAGE, 'purchasing/landed-costs/new', pages.landedCost),
              guarded('purchases.view', 'purchasing/landed-costs/:voucherId', pages.landedCost),
              guarded('purchases.view', 'purchasing/supplier-performance', pages.supplierPerformance),
              guarded('storefront.view', 'storefront', pages.storefrontSettings),
              guarded('storefront.view', 'storefront/theme', pages.storefrontTheme),
              guarded('storefront.view', 'storefront/menus', pages.storefrontMenus),
              guarded('storefront.view', 'storefront/homepage', pages.storefrontHomepage),
              guarded('storefront.view', 'storefront/banners', pages.storefrontBanners),
              guarded('storefront.view', 'storefront/pages', pages.storeBuilderPages),
              guarded('shipping.manage', 'storefront/shipping', pages.storefrontShipping),
              guarded('shipping.manage', 'storefront/shipping/couriers', pages.storefrontCouriers),
              guarded('payment_gateways.manage', 'storefront/payments', pages.storefrontPayments),
              guarded('online_catalog.view', 'storefront/categories', pages.webCategories),
              guarded('online_catalog.view', 'storefront/brands', pages.webBrands),
              // P1a: viewers see guides read-only; creating, editing and deleting need online_catalog.manage.
              guarded('online_catalog.view', 'storefront/size-guides', pages.sizeGuides),
              { path: 'content', element: <ContentRedirect /> },
              guarded('cms.manage', 'content/pages', pages.contentPages),
              guarded('cms.manage', 'content/pages/new', pages.contentPage),
              guarded('cms.manage', 'content/pages/:pageId', pages.contentPage),
              guarded('cms.manage', 'content/blog', pages.contentBlog),
              guarded('cms.manage', 'content/blog/new', pages.contentBlogPost),
              guarded('cms.manage', 'content/blog/:postId', pages.contentBlogPost),
              guarded('cms.manage', 'content/faq', pages.contentFaq),
              guarded('cms.manage', 'content/messages', pages.contentMessages),
              guarded('cms.manage', 'content/newsletter', pages.contentNewsletter),
              // B8b: one route for the list and the opened submission (bell links point at /content/forms/{id}).
              guarded('forms.view', 'content/forms/:submissionId?', pages.contentForms),
              guarded('media.manage', 'media', pages.mediaLibrary),
              guarded('branches.view', 'branches', pages.branches),
              guarded('users.view', 'users', pages.users),
              guarded('roles.view', 'roles', pages.roles),
              guarded(ORGANIZATION_PERMISSIONS, 'organization', pages.organization),
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
