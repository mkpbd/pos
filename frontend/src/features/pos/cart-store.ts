import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { CartInput, DiscountInput, HeldSale, PosItem } from '@/features/pos/api'
import { itemLabel } from '@/features/pos/api'
import { addDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

export type CustomerRef = { id: string; code: string; name: string; phone: string | null }

export type CartLine = {
  key: string
  variant_id: string
  label: string
  sku: string
  unit_code: string | null
  allow_decimal: boolean
  track_serials: boolean
  /** Shelf price for display while the server prices the cart. */
  price: string
  quantity: string
  discount: DiscountInput | null
  serials: string[]
  /** POS1a: the product's price is typed at the till (absent on carts saved before POS1a). */
  open_price?: boolean
  /** POS1a: price typed at the till (open price) or changed by the cashier; null = catalog price. */
  unit_price?: string | null
  /** POS1a: manager approval of the changed price (bound to the variant). */
  price_approval_id?: string | null
}

export type LineInfo = Pick<CartLine, 'label' | 'sku' | 'unit_code' | 'allow_decimal' | 'track_serials' | 'price' | 'open_price'>

export type Cart = {
  storeId: string | null
  customer: CustomerRef | null
  lines: CartLine[]
  /** undefined = automatic (customer group discount), null = none. */
  invoiceDiscount?: DiscountInput | null
  notes: string
  heldSaleId: string | null
  /** Idempotency key of the checkout in progress, reused for retries of the same payload. */
  pendingCheckout: { fingerprint: string; key: string } | null
  /** POS1a: manager approval for manual discounts (cashiers without sales.discount). */
  discountApprovalId?: string | null
  /** POS1a: coupon typed at the till. */
  couponCode?: string | null
}

const emptyCart = (storeId: string | null = null): Cart => ({
  storeId,
  customer: null,
  lines: [],
  notes: '',
  heldSaleId: null,
  pendingCheckout: null,
})

type CartState = {
  /** One cart per branch, so switching branches never mixes goods of two tills. */
  carts: Record<string, Cart>
  update: (branchId: string, change: (cart: Cart) => Cart) => void
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      carts: {},
      update: (branchId, change) => set((s) => ({ carts: { ...s.carts, [branchId]: change(s.carts[branchId] ?? emptyCart()) } })),
    }),
    { name: 'pos-carts', storage: createJSONStorage(() => localStorage) },
  ),
)

let lineCounter = 0
const newKey = () => `${Date.now().toString(36)}-${(lineCounter++).toString(36)}`

/** Pure cart operations (exported for tests). */
export const cartOps = {
  /** `unitPrice`: the price typed for an open-price item (lines at another price stay separate). */
  addItem(cart: Cart, item: PosItem, unitPrice: string | null = null): Cart {
    // Serial-tracked goods get one line per scan so each unit's serial can be captured.
    // A changed price is never merged into: its approval belongs to that one line.
    const existing = item.track_serials
      ? undefined
      : cart.lines.find((l) => l.variant_id === item.variant_id && l.discount === null && (l.unit_price ?? null) === unitPrice && !l.price_approval_id)
    if (existing) {
      return cartOps.setQuantity(cart, existing.key, trimDecimal(addDecimal(existing.quantity, '1')))
    }
    const line: CartLine = {
      key: newKey(),
      variant_id: item.variant_id,
      label: itemLabel(item),
      sku: item.sku,
      unit_code: item.unit_code,
      allow_decimal: item.allow_decimal,
      track_serials: item.track_serials,
      price: item.price,
      quantity: '1',
      discount: null,
      serials: [],
      open_price: item.open_price === true,
      unit_price: unitPrice,
      price_approval_id: null,
    }
    return { ...cart, lines: [...cart.lines, line] }
  },

  /** A new price for a line (`approvalId` when a manager approved it), or back to the catalog price with null. */
  setPrice(cart: Cart, key: string, unitPrice: string | null, approvalId: string | null = null): Cart {
    return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, unit_price: unitPrice, price_approval_id: unitPrice === null ? null : approvalId } : l)) }
  },

  /** Drops every manager approval (expired or used); the same cart when there is none. */
  clearApprovals(cart: Cart): Cart {
    if (!cart.discountApprovalId && !cart.lines.some((l) => l.price_approval_id)) return cart
    return { ...cart, discountApprovalId: null, lines: cart.lines.map((l) => (l.price_approval_id ? { ...l, price_approval_id: null } : l)) }
  },

  setQuantity(cart: Cart, key: string, quantity: string): Cart {
    return { ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) }
  },

  /** +1 / −1, never below one unit (remove the line instead). */
  step(cart: Cart, key: string, direction: 1 | -1): Cart {
    const line = cart.lines.find((l) => l.key === key)
    if (!line || !isValidQuantity(line.quantity)) return cart
    const next = trimDecimal(direction === 1 ? addDecimal(line.quantity, '1') : subtractDecimal(line.quantity, '1'))
    return isValidQuantity(next) ? cartOps.setQuantity(cart, key, next) : cart
  },

  remove(cart: Cart, key: string): Cart {
    return { ...cart, lines: cart.lines.filter((l) => l.key !== key) }
  },

  /** Rebuilds a held cart; `info` comes from pricing it (labels, units, current prices). */
  fromHeld(held: HeldSale, storeId: string, info: Map<string, LineInfo>): Cart {
    const lines = (held.cart?.lines ?? []).map((l): CartLine => {
      const item = info.get(l.variant_id)
      return {
        key: newKey(),
        variant_id: l.variant_id,
        label: item?.label ?? 'Product',
        sku: item?.sku ?? '',
        unit_code: item?.unit_code ?? null,
        allow_decimal: item?.allow_decimal ?? false,
        track_serials: item?.track_serials ?? false,
        price: item?.price ?? '0.00',
        quantity: trimDecimal(l.quantity),
        discount: l.discount ?? null,
        serials: l.serials ?? [],
        open_price: item?.open_price ?? false,
        unit_price: l.unit_price ?? null,
        price_approval_id: l.price_approval_id ?? null,
      }
    })
    const cart: Cart = { ...emptyCart(storeId), customer: held.customer, lines, notes: held.cart?.notes ?? '', heldSaleId: held.id }
    if (held.cart && 'invoice_discount' in held.cart) cart.invoiceDiscount = held.cart.invoice_discount ?? null
    if (held.cart?.discount_approval_id) cart.discountApprovalId = held.cart.discount_approval_id
    if (held.cart?.coupon_code) cart.couponCode = held.cart.coupon_code
    return cart
  },

  empty: emptyCart,
}

export function isValidQuantity(quantity: string): boolean {
  return /^\d{1,12}(\.\d{1,3})?$/.test(quantity.trim()) && !/^0+(\.0+)?$/.test(quantity.trim())
}

/** The cart as the API expects it (null while it cannot be priced). */
export function toCartInput(cart: Cart): CartInput | null {
  if (!cart.storeId || cart.lines.length === 0 || cart.lines.some((l) => !isValidQuantity(l.quantity))) return null
  const input: CartInput = {
    store_id: cart.storeId,
    customer_id: cart.customer?.id ?? null,
    lines: cart.lines.map((l) => ({
      variant_id: l.variant_id,
      quantity: l.quantity.trim(),
      discount: l.discount,
      ...(l.track_serials ? { serials: l.serials } : {}),
      ...(l.unit_price ? { unit_price: l.unit_price } : {}),
      ...(l.unit_price && l.price_approval_id ? { price_approval_id: l.price_approval_id } : {}),
    })),
    notes: cart.notes.trim() || null,
  }
  if (cart.invoiceDiscount !== undefined) input.invoice_discount = cart.invoiceDiscount
  if (cart.discountApprovalId) input.discount_approval_id = cart.discountApprovalId
  if (cart.couponCode) input.coupon_code = cart.couponCode
  return input
}

/** Cart of the branch plus bound operations. */
const NO_CART = emptyCart()

export function usePosCart(branchId: string) {
  const cart = useCartStore((s) => s.carts[branchId]) ?? NO_CART
  const update = useCartStore((s) => s.update)
  const apply = (change: (cart: Cart) => Cart) => update(branchId, change)

  return { cart, apply }
}
