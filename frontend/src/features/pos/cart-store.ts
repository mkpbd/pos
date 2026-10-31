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
}

export type LineInfo = Pick<CartLine, 'label' | 'sku' | 'unit_code' | 'allow_decimal' | 'track_serials' | 'price'>

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
  addItem(cart: Cart, item: PosItem): Cart {
    // Serial-tracked goods get one line per scan so each unit's serial can be captured.
    const existing = item.track_serials ? undefined : cart.lines.find((l) => l.variant_id === item.variant_id && l.discount === null)
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
    }
    return { ...cart, lines: [...cart.lines, line] }
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
      }
    })
    const cart: Cart = { ...emptyCart(storeId), customer: held.customer, lines, notes: held.cart?.notes ?? '', heldSaleId: held.id }
    if (held.cart && 'invoice_discount' in held.cart) cart.invoiceDiscount = held.cart.invoice_discount ?? null
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
    })),
    notes: cart.notes.trim() || null,
  }
  if (cart.invoiceDiscount !== undefined) input.invoice_discount = cart.invoiceDiscount
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
