import type { ReturnStatus } from '@/features/returns/api'
import type { SaleLine } from '@/features/sales/api'
import { subtractDecimal } from '@/lib/money'

export const RETURN_STATUS: Record<ReturnStatus, { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending: { label: 'Awaiting approval', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
}

/** Quantity still returnable on an invoice line: sold − returned − reserved by pending returns. */
export function returnableQuantity(line: Pick<SaleLine, 'quantity' | 'returned_quantity' | 'pending_return_quantity'>): string {
  return subtractDecimal(subtractDecimal(line.quantity, line.returned_quantity), line.pending_return_quantity)
}
