const KIND_LABELS: Record<string, string> = { product: 'Item offer', order: 'Order offer', coupon: 'Coupon' }

/** POS1a: "Item offer", "Order offer", "Coupon"; unknown kinds from a newer server read as words. */
export function promotionKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll('_', ' ')
}
