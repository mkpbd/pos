/**
 * Every admin list that can be exported to Excel / CSV / PDF (X1; CSV since Phase 7).
 *
 * `endpoint` is the list's own API endpoint (GET, relative to /api/v1); the export is the
 * same request plus `export=xlsx|csv|pdf`, so filters, search and sort carry over unchanged.
 * `route` is the admin page that shows the Export menu, or null when the list lives inside
 * another screen (`screen` says where) — e.g. a statement sheet or the promotion report.
 * Endpoints with `:param` segments are filled from ExportMenu's `pathParams`.
 */
export type ExportableList = {
  /** Human name, used in the menu's accessible label and the fallback filename. */
  label: string
  endpoint: string
  route: string | null
  screen?: string
}

export const EXPORTABLE_LISTS = {
  sales: { label: 'Sales', endpoint: '/sales', route: '/sales' },
  saleReturns: { label: 'Sales returns', endpoint: '/returns', route: '/returns' },
  webOrders: { label: 'Web orders', endpoint: '/web-orders', route: '/web-orders' },
  webReturns: { label: 'Web returns', endpoint: '/web-order-returns', route: '/web-returns' },
  codRemittances: { label: 'COD remittances', endpoint: '/cod-remittances', route: '/cod-remittances' },
  promotions: { label: 'Promotions', endpoint: '/promotions', route: '/promotions' },
  promotionReport: { label: 'Promotion report', endpoint: '/promotions/:id/report', route: null, screen: 'Promotion page → Report tab' },
  reviews: { label: 'Reviews', endpoint: '/reviews', route: '/reviews' },
  registerSessions: { label: 'Register sessions', endpoint: '/register-sessions', route: '/cash-registers/sessions' },
  payments: { label: 'Payments', endpoint: '/payments', route: '/payments' },
  customerPayments: { label: 'Customer payments', endpoint: '/customer-payments', route: '/payments/customers' },
  expenses: { label: 'Expenses and income', endpoint: '/expenses', route: '/expenses' },
  products: { label: 'Products', endpoint: '/products', route: '/products' },
  stock: { label: 'Stock levels', endpoint: '/inventory/stock', route: '/inventory' },
  batches: { label: 'Batches and expiry', endpoint: '/inventory/batches', route: '/inventory/batches' },
  movements: { label: 'Stock movements', endpoint: '/inventory/movements', route: '/inventory/movements' },
  adjustments: { label: 'Stock adjustments', endpoint: '/inventory/adjustments', route: '/inventory/adjustments' },
  transfers: { label: 'Stock transfers', endpoint: '/inventory/transfers', route: '/inventory/transfers' },
  purchaseOrders: { label: 'Purchase orders', endpoint: '/purchasing/orders', route: '/purchasing/orders' },
  purchaseRequisitions: { label: 'Purchase requisitions', endpoint: '/purchasing/requisitions', route: '/purchasing/requisitions' },
  rfqs: { label: 'Requests for quotation', endpoint: '/purchasing/rfqs', route: '/purchasing/rfqs' },
  approvals: { label: 'Waiting for approval', endpoint: '/purchasing/approvals', route: '/purchasing/approvals' },
  reorderSuggestions: { label: 'Reorder suggestions', endpoint: '/purchasing/reorder-suggestions', route: '/purchasing/reorder' },
  supplierCatalog: { label: 'Supplier catalog', endpoint: '/purchasing/supplier-products', route: null, screen: 'Suppliers → supplier page → Catalog tab' },
  goodsReceipts: { label: 'Goods receipts', endpoint: '/purchasing/receipts', route: '/purchasing/receipts' },
  purchaseReturns: { label: 'Purchase returns', endpoint: '/purchasing/returns', route: '/purchasing/returns' },
  landedCostVouchers: { label: 'Landed cost vouchers', endpoint: '/purchasing/landed-cost-vouchers', route: '/purchasing/landed-costs' },
  supplierPerformance: { label: 'Supplier performance', endpoint: '/purchasing/supplier-performance', route: '/purchasing/supplier-performance' },
  supplierPayments: { label: 'Supplier payments', endpoint: '/purchasing/payments', route: '/purchasing/payments' },
  supplierStatement: { label: 'Supplier statement', endpoint: '/purchasing/suppliers/:id/statement', route: null, screen: 'Suppliers → Statement sheet' },
  customers: { label: 'Customers', endpoint: '/customers', route: '/customers' },
  customerStatement: { label: 'Customer statement', endpoint: '/customers/:id/statement', route: null, screen: 'Customers → Account sheet' },
  suppliers: { label: 'Suppliers', endpoint: '/suppliers', route: '/suppliers' },
  contactMessages: { label: 'Contact messages', endpoint: '/cms/contact-messages', route: '/content/messages' },
  newsletterSubscribers: { label: 'Newsletter subscribers', endpoint: '/cms/newsletter-subscribers', route: '/content/newsletter' },
  users: { label: 'Users', endpoint: '/users', route: '/users' },
  auditLog: { label: 'Audit log', endpoint: '/audit-logs', route: '/audit-log' },
  report: { label: 'Report', endpoint: '/reports/:key', route: null, screen: 'Reports → any report page' },
} as const satisfies Record<string, ExportableList>

export type ExportListKey = keyof typeof EXPORTABLE_LISTS

export type ExportFormat = 'xlsx' | 'pdf' | 'csv'

/** Formats every list offers (CSV since Phase 7: UTF-8 with BOM, opens in Excel with Bangla intact). */
export const DEFAULT_EXPORT_FORMATS: readonly ExportFormat[] = ['xlsx', 'csv', 'pdf']

/** The list endpoint with its `:param` segments filled in (URL-encoded). */
export function exportEndpoint(list: ExportListKey, pathParams: Record<string, string> = {}): string {
  return EXPORTABLE_LISTS[list].endpoint.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
    const value = pathParams[name]
    if (value === undefined || value === '') throw new Error(`Export of ${list} needs the "${name}" path parameter`)
    return encodeURIComponent(value)
  })
}

/** Used only when the server sends no Content-Disposition filename. */
export function fallbackExportFilename(list: ExportListKey, format: ExportFormat, title?: string): string {
  const slug = (title ?? EXPORTABLE_LISTS[list].label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug}.${format}`
}
