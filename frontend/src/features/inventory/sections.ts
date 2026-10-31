export type SectionTab = { to: string; label: string; permission?: string }

export const INVENTORY_TABS: SectionTab[] = [
  { to: '/inventory', label: 'Stock' },
  { to: '/inventory/batches', label: 'Batches & expiry' },
  { to: '/inventory/movements', label: 'Movements' },
  { to: '/inventory/adjustments', label: 'Adjustments' },
  { to: '/inventory/transfers', label: 'Transfers' },
]

export const PURCHASING_TABS: SectionTab[] = [
  { to: '/purchasing/orders', label: 'Purchase orders' },
  { to: '/purchasing/receipts', label: 'Receipts' },
  { to: '/purchasing/returns', label: 'Returns' },
  { to: '/purchasing/payments', label: 'Supplier payments' },
]
