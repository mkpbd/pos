import type { PosItem } from '@/features/pos/api'
import { cartOps, type Cart } from '@/features/pos/cart-store'
import { useManagerApproval } from '@/features/pos/manager-approval-context'
import { PriceDialog } from '@/features/pos/components/price-dialog'
import { formatMoney } from '@/lib/money'

/** What the price dialog is for: an open-price item being added, or a line whose price changes. */
export type PriceTarget = { kind: 'add'; item: PosItem } | { kind: 'line'; key: string }

/**
 * Price entry at the till. Open-price items take the typed price directly. Another item's new
 * price is applied directly with `sales.price_override`; otherwise a manager approves it for
 * that variant (an approval already on the line covers a further change of the same line).
 */
export function PriceFlow({
  target,
  cart,
  apply,
  canOverride,
  onClose,
}: {
  target: PriceTarget
  cart: Cart
  apply: (change: (cart: Cart) => Cart) => void
  canOverride: boolean
  onClose: () => void
}) {
  const requestApproval = useManagerApproval()

  if (target.kind === 'add') {
    const { item } = target
    return (
      <PriceDialog
        title="Enter the price"
        description={<>{item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name} is sold at a price entered at the till.</>}
        initial={null}
        submitLabel="Add to sale"
        onCancel={onClose}
        onSubmit={(price) => {
          apply((c) => cartOps.addItem(c, item, price))
          onClose()
        }}
      />
    )
  }

  const line = cart.lines.find((l) => l.key === target.key)
  if (!line) return null
  const open = line.open_price === true

  const submit = async (price: string) => {
    onClose()
    if (open || canOverride) {
      apply((c) => cartOps.setPrice(c, line.key, price, null))
      return
    }
    if (line.price_approval_id) {
      apply((c) => cartOps.setPrice(c, line.key, price, line.price_approval_id ?? null))
      return
    }
    const approval = await requestApproval({
      action: 'price_override',
      description: `Sell ${line.label} at ${formatMoney(price)} instead of ${formatMoney(line.price)}.`,
      details: { variant_id: line.variant_id, unit_price: price },
    })
    if (approval) apply((c) => cartOps.setPrice(c, line.key, price, approval.id))
  }

  return (
    <PriceDialog
      title={open ? 'Enter the price' : 'Change price'}
      description={open ? `${line.label} is sold at a price entered at the till.` : `${line.label}: list price ${formatMoney(line.price)}.${canOverride ? '' : ' A manager approves the new price.'}`}
      initial={line.unit_price ?? (open ? null : line.price)}
      submitLabel={open || canOverride || line.price_approval_id ? 'Set price' : 'Continue'}
      onCancel={onClose}
      onSubmit={(price) => void submit(price)}
    />
  )
}
