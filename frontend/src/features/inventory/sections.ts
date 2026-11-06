/** `permission`: required to see the tab, or any of a list. */
export type SectionTab = { to: string; label: string; permission?: string | string[] }

export const INVENTORY_TABS: SectionTab[] = [
  { to: '/inventory', label: 'Stock' },
  { to: '/inventory/batches', label: 'Batches & expiry' },
  { to: '/inventory/movements', label: 'Movements' },
  { to: '/inventory/adjustments', label: 'Adjustments' },
  { to: '/inventory/transfers', label: 'Transfers' },
  { to: '/inventory/settings', label: 'Settings', permission: 'inventory.manage' },
]

/** Requesters and approvers may lack purchases.view, so every tab names its permission. */
export const PURCHASING_TABS: SectionTab[] = [
  { to: '/purchasing/orders', label: 'Purchase orders', permission: 'purchases.view' },
  { to: '/purchasing/requisitions', label: 'Requisitions', permission: ['purchases.view', 'purchases.request', 'purchases.approve', 'purchases.approve_high'] },
  { to: '/purchasing/approvals', label: 'Approvals', permission: ['purchases.approve', 'purchases.approve_high'] },
  { to: '/purchasing/rfqs', label: 'RFQs', permission: 'purchases.view' },
  { to: '/purchasing/reorder', label: 'Reorder', permission: 'purchases.view' },
  { to: '/purchasing/receipts', label: 'Receipts', permission: 'purchases.view' },
  { to: '/purchasing/returns', label: 'Returns', permission: 'purchases.view' },
  { to: '/purchasing/landed-costs', label: 'Landed costs', permission: 'purchases.view' },
  { to: '/purchasing/payments', label: 'Supplier payments', permission: 'purchases.view' },
  { to: '/purchasing/supplier-performance', label: 'Supplier performance', permission: 'purchases.view' },
  { to: '/purchasing/settings', label: 'Settings', permission: 'purchases.settings' },
]

export const REGISTER_TABS: SectionTab[] = [
  { to: '/cash-registers', label: 'Registers' },
  { to: '/cash-registers/sessions', label: 'Sessions' },
]

export const PAYMENTS_TABS: SectionTab[] = [
  { to: '/payments', label: 'Payments ledger' },
  { to: '/payments/customers', label: 'Customer payments' },
]
