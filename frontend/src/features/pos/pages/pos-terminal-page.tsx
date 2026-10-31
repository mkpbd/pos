import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { HistoryIcon, Loader2Icon, PauseIcon, ScanBarcodeIcon, ShoppingCartIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import { lookupCode, useCheckoutMutation, useHoldMutation, usePriceQuery, type HeldSale, type PosItem, type PricedCart } from '@/features/pos/api'
import { cartOps, toCartInput, usePosCart, type LineInfo } from '@/features/pos/cart-store'
import { CartLines, CartTotals } from '@/features/pos/components/cart-panel'
import { CustomerPicker } from '@/features/pos/components/customer-picker'
import { HeldSalesSheet } from '@/features/pos/components/held-sales-sheet'
import { PaymentDialog } from '@/features/pos/components/payment-dialog'
import { CategoryBar, ProductGrid } from '@/features/pos/components/product-grid'
import { RecentSalesSheet } from '@/features/pos/components/recent-sales-sheet'
import type { Sale } from '@/features/sales/api'
import { ReceiptDialog } from '@/features/sales/components/receipt-dialog'
import { api, ApiError } from '@/lib/api/client'
import { formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSessionStore } from '@/stores/session-store'

/**
 * The POS terminal (critical workflows #3, #4, #8). Keyboard first:
 *   F2 search / scan · F4 customer · F8 hold · F9 pay · Esc clear search.
 * Barcode scanners type the code and press Enter. Every amount shown comes from the server.
 */
export function PosTerminalPage() {
  const branchId = useSessionStore((s) => s.activeBranchId) ?? ''
  const can = useCan()
  const { cart, apply } = usePosCart(branchId)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [scanning, setScanning] = useState(false)
  const [customerOpen, setCustomerOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [completed, setCompleted] = useState<Sale | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  const defaultStore = branches.data?.items.find((b) => b.id === branchId)?.stores.filter((s) => s.is_active).sort((a, b) => (a.type === b.type ? 0 : a.type === 'store' ? -1 : 1))[0]
  useEffect(() => {
    if (!cart.storeId && defaultStore) apply((c) => ({ ...c, storeId: defaultStore.id }))
  }, [cart.storeId, defaultStore, apply])

  const cartInput = useMemo(() => toCartInput(cart), [cart])
  const debouncedCart = useDebouncedValue(cartInput, 200)
  const price = usePriceQuery(debouncedCart)
  const priced = cartInput && price.data && !price.isError ? price.data : undefined
  const pricingCurrent = !!cartInput && debouncedCart === cartInput && !price.isFetching && !price.isError
  const checkout = useCheckoutMutation()
  const hold = useHoldMutation()
  const canDiscount = can('sales.discount')

  const addItem = (item: PosItem) => {
    if (!item.sellable) {
      toast.error(`${item.product_name} is not for sale.`)
      return
    }
    apply((c) => cartOps.addItem(c, item))
  }

  const scan = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = search.trim()
    if (!code || !cart.storeId) return
    setScanning(true)
    try {
      addItem(await lookupCode(cart.storeId, code))
      setSearch('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        toast.error(`No product with barcode or SKU “${code}”. Showing search results instead.`)
      } else {
        toast.error(error instanceof Error ? error.message : 'Lookup failed.')
      }
    } finally {
      setScanning(false)
    }
  }

  const holdCart = () => {
    if (!cartInput) {
      toast.error(cart.lines.length === 0 ? 'The cart is empty.' : 'Fix the highlighted quantities first.')
      return
    }
    hold.mutate({ ...cartInput, label: cart.customer?.name ?? null }, {
      onSuccess: () => {
        toast.success('Cart held. Resume it from “Held sales”.')
        apply((c) => cartOps.empty(c.storeId))
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const resume = async (held: HeldSale) => {
    if (cart.lines.length > 0) throw new Error('Finish or hold the current cart first.')
    const storeId = held.store_id
    let info = new Map<string, LineInfo>()
    try {
      const repriced = await api.post<PricedCart>('/pos/price', { store_id: storeId, ...held.cart }).then((r) => r.data)
      info = new Map(repriced.lines.map((l) => [l.variant_id, {
        label: l.variant_name ? `${l.product_name} — ${l.variant_name}` : l.product_name,
        sku: l.sku,
        unit_code: l.unit_code,
        allow_decimal: l.allow_decimal,
        track_serials: l.track_serials,
        price: l.unit_price,
      }]))
    } catch {
      // The cart is restored anyway; the cart panel shows the pricing problem.
    }
    apply(() => cartOps.fromHeld(held, storeId, info))
    toast.success('Held sale resumed.')
  }

  const openPayment = () => {
    if (!cartInput) {
      toast.error(cart.lines.length === 0 ? 'The cart is empty.' : 'Fix the highlighted quantities first.')
      return
    }
    if (!pricingCurrent || !priced) {
      toast.error(price.isError ? 'Fix the cart problem shown first.' : 'Still pricing the cart — try again in a moment.')
      return
    }
    setPaying(true)
  }

  const complete = (payments: { method: 'cash' | 'card' | 'mobile_banking'; amount: string; reference: string | null }[]) => {
    if (!cartInput) return
    const input = { ...cartInput, payments, held_sale_id: cart.heldSaleId }
    const fingerprint = JSON.stringify(input)
    // Retrying the same payload (e.g. after a timeout) must reuse the key so it cannot sell twice.
    const key = cart.pendingCheckout?.fingerprint === fingerprint ? cart.pendingCheckout.key : crypto.randomUUID()
    apply((c) => ({ ...c, pendingCheckout: { fingerprint, key } }))

    checkout.mutate({ input, idempotencyKey: key }, {
      onSuccess: (sale) => {
        setPaying(false)
        setCompleted(sale)
        apply((c) => cartOps.empty(c.storeId))
      },
      onError: (error) => {
        const retryable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
        if (!retryable) apply((c) => ({ ...c, pendingCheckout: null }))
        toast.error(retryable ? `${error.message} Press “Complete sale” again to retry safely.` : error.message)
      },
    })
  }

  // Keyboard shortcuts.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus() }
    if (e.key === 'F4') { e.preventDefault(); setCustomerOpen(true) }
    if (e.key === 'F8') { e.preventDefault(); holdCart() }
    if (e.key === 'F9') { e.preventDefault(); openPayment() }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onShortcut(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const itemCount = cart.lines.length

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100svh-6.5rem)] lg:flex-row">
      <h1 className="sr-only">POS terminal</h1>
      <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Products">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <StoreSelect value={cart.storeId} onChange={(storeId) => apply((c) => ({ ...c, storeId }))} branchIds={branchId ? [branchId] : null} aria-label="Selling from store" />
          </div>
          <CustomerPicker value={cart.customer} onChange={(customer) => apply((c) => ({ ...c, customer, invoiceDiscount: undefined }))} open={customerOpen} onOpenChange={setCustomerOpen} />
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={() => setHeldOpen(true)}>
              <PauseIcon data-icon="inline-start" /> Held sales
            </Button>
            <Button type="button" variant="outline" onClick={() => setRecentOpen(true)}>
              <HistoryIcon data-icon="inline-start" /> Recent
            </Button>
          </div>
        </div>
        <form onSubmit={scan} className="relative">
          <ScanBarcodeIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            autoFocus
            aria-label="Scan barcode or search products"
            placeholder="Scan barcode, or type name / SKU and press Enter (F2)"
            className="h-11 pl-10 text-base"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
          />
          {scanning && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" aria-label="Looking up" />}
        </form>
        <CategoryBar value={category} onChange={(id) => { setCategory(id); setPage(1) }} />
        <ProductGrid storeId={cart.storeId} categoryId={category} search={debouncedSearch} page={page} onPageChange={setPage} onPick={addItem} />
      </section>

      <aside className="flex min-h-[28rem] w-full flex-col rounded-lg border bg-card lg:w-[26rem]" aria-label="Current sale">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 font-medium">
            <ShoppingCartIcon className="size-4" aria-hidden /> Current sale
            {itemCount > 0 && <Badge variant="secondary">{itemCount}</Badge>}
            {cart.heldSaleId && <Badge variant="outline">resumed</Badge>}
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={itemCount === 0} onClick={() => setClearing(true)}>
            <Trash2Icon data-icon="inline-start" /> Clear
          </Button>
        </div>

        <CartLines cart={cart} priced={priced} canDiscount={canDiscount} apply={apply} />

        <div className="flex flex-col gap-3 border-t p-3">
          {price.isError && cartInput && (
            <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{price.error.message}</p>
          )}
          {priced?.customer && (
            <p className="text-xs text-muted-foreground">
              {priced.customer.name}: owes {formatMoney(priced.customer.credit.outstanding, priced.currency)}
              {!isZeroDecimal(priced.customer.credit.credit_limit) && ` · credit available ${formatMoney(priced.customer.credit.available)}`}
              {!isZeroDecimal(priced.customer.group_discount_percent) && ` · group −${trimDecimal(priced.customer.group_discount_percent)}%`}
            </p>
          )}
          {priced ? (
            <CartTotals priced={priced} cart={cart} canDiscount={canDiscount} apply={apply} />
          ) : (
            <div className="flex items-center justify-between text-lg font-semibold">
              Total <span className="font-mono">{cartInput && price.isFetching ? <Loader2Icon className="size-4 animate-spin" aria-label="Pricing" /> : '—'}</span>
            </div>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button type="button" variant="outline" size="lg" disabled={itemCount === 0 || hold.isPending} onClick={holdCart}>
              <PauseIcon data-icon="inline-start" /> Hold <kbd className="ml-1 text-xs opacity-70">F8</kbd>
            </Button>
            <Button type="button" size="lg" disabled={itemCount === 0} onClick={openPayment}>
              Pay {priced && formatMoney(priced.total, priced.currency)} <kbd className="ml-1 text-xs opacity-70">F9</kbd>
            </Button>
          </div>
        </div>
      </aside>

      {paying && priced && (
        <PaymentDialog
          open={paying}
          onOpenChange={(o) => { if (!checkout.isPending) setPaying(o) }}
          priced={priced}
          canCredit={can('sales.credit')}
          pending={checkout.isPending}
          onSubmit={complete}
        />
      )}
      <ReceiptDialog
        sale={completed}
        open={completed !== null}
        onOpenChange={(o) => { if (!o) { setCompleted(null); searchRef.current?.focus() } }}
        title={completed ? `Sale ${completed.number} completed` : 'Sale completed'}
        description={completed && (
          isZeroDecimal(completed.due_total)
            ? <span className="text-base">Change due: <b className="font-mono">{formatMoney(completed.change_total, completed.currency)}</b></span>
            : <span className="text-base">Balance due on account: <b className="font-mono">{formatMoney(completed.due_total, completed.currency)}</b></span>
        )}
        closeLabel="New sale"
      />
      <HeldSalesSheet open={heldOpen} onOpenChange={setHeldOpen} storeId={cart.storeId} onResume={resume} />
      <RecentSalesSheet open={recentOpen} onOpenChange={setRecentOpen} />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear the current sale?"
        description="All items are removed from the cart."
        confirmLabel="Clear sale"
        destructive
        onConfirm={() => { apply((c) => cartOps.empty(c.storeId)); setClearing(false) }}
      />
    </div>
  )
}
