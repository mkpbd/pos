import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRightIcon, HistoryIcon, Loader2Icon, LockIcon, PauseIcon, ScanBarcodeIcon, ShoppingCartIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { StoreSelect } from '@/components/common/store-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useBranchesQuery } from '@/features/branches/api'
import { useLoyaltyBalancesQuery, useLoyaltySettingsQuery } from '@/features/loyalty/api'
import { itemLabel, lookupCode, useCheckoutMutation, useHoldMutation, usePriceQuery, type HeldSale, type PaymentMethod, type PosItem, type PricedCart } from '@/features/pos/api'
import { cartOps, toCartInput, usePosCart, type LineInfo } from '@/features/pos/cart-store'
import { CartLines, CartTotals } from '@/features/pos/components/cart-panel'
import { CouponField } from '@/features/pos/components/coupon-field'
import { CustomerPicker } from '@/features/pos/components/customer-picker'
import { ExchangeBanner, ExchangePayLabel } from '@/features/pos/components/exchange-banner'
import { ExchangeCheckout } from '@/features/pos/components/exchange-checkout'
import { ExchangeDialog } from '@/features/pos/components/exchange-dialog'
import { withExchange, withoutExchange } from '@/features/pos/exchange'
import { useExchangePending } from '@/features/pos/exchange-api'
import { HeldSalesSheet } from '@/features/pos/components/held-sales-sheet'
import { ManagerApprovalProvider } from '@/features/pos/components/manager-approval'
import { PaymentDialog, type LoyaltyTender, type StoreCreditTender } from '@/features/pos/components/payment-dialog'
import { StoredValueMenu } from '@/features/pos/components/stored-value-menu'
import { codeFingerprint, storeCreditKey, tenderProblem, useStoreCreditQuery } from '@/features/pos/stored-value-api'
import { PriceFlow, type PriceTarget } from '@/features/pos/components/price-flow'
import { PricingProblem } from '@/features/pos/components/pricing-problem'
import { CategoryBar, ProductGrid } from '@/features/pos/components/product-grid'
import { RecentSalesSheet } from '@/features/pos/components/recent-sales-sheet'
import { RegisterSessionBar } from '@/features/pos/components/register-session-bar'
import { TillLockScreen } from '@/features/pos/components/till-lock-screen'
import { hasTillPin } from '@/features/pos/till-api'
import { isTillProblem } from '@/features/pos/till-helpers'
import { AUTO_LOCK_MS, useIdleTimer, useTillLockStore } from '@/features/pos/till-lock'
import { useCurrentSessionQuery } from '@/features/registers/api'
import type { Sale } from '@/features/sales/api'
import { TillMenu } from '@/features/pos/components/till-menu'
import { TillReceiptDialog } from '@/features/pos/components/till-receipt-dialog'
import { api, ApiError } from '@/lib/api/client'
import { compareDecimal, formatMoney, isZeroDecimal, trimDecimal } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useSessionStore } from '@/stores/session-store'

/**
 * The POS terminal (critical workflows #3, #4, #8). Keyboard first:
 *   F2 search / scan · F4 customer · F8 hold · F9 pay · Esc clear search.
 * Barcode scanners type the code and press Enter. Every amount shown comes from the server.
 *
 * POS1a: the till locks (button, or after 5 minutes without input) and unlocks with the cashier's
 * PIN; another cashier can take over from the lock screen. A new cashier gets a fresh terminal.
 */
export function PosTerminalPage() {
  const me = useAuth()
  const branchId = useSessionStore((s) => s.activeBranchId) ?? ''
  const locked = useTillLockStore((s) => s.lockedUserId === me.user.id)

  return locked ? <TillLockScreen me={me} branchId={branchId} /> : <PosTerminal key={me.user.id} />
}

function PosTerminal() {
  const branchId = useSessionStore((s) => s.activeBranchId) ?? ''
  const can = useCan()
  const me = useAuth()
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
  const [openingRegister, setOpeningRegister] = useState(false)
  // POS1c: the exchange dialog (find the invoice, choose what comes back).
  const [startingExchange, setStartingExchange] = useState(false)
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
  const canOverride = can('sales.price_override')
  // POS1a: an open-price item being added, or a line whose price changes.
  const [priceTarget, setPriceTarget] = useState<PriceTarget | null>(null)
  // POS1a: an approval / price / coupon refusal from checkout, shown until the cart changes.
  const [checkoutProblem, setCheckoutProblem] = useState<{ error: Error; cart: string } | null>(null)
  const problem = checkoutProblem && checkoutProblem.cart === JSON.stringify(cartInput) ? checkoutProblem.error : price.isError && cartInput ? price.error : null

  // POS1a: lock the till after 5 minutes without input (only with a PIN to unlock it again).
  const lockTill = useTillLockStore((s) => s.lock)
  const pinSet = hasTillPin(me)
  // POS1c: an exchange in flight counts as busy too.
  const exchangePending = useExchangePending()
  useIdleTimer(() => lockTill(me.user.id), AUTO_LOCK_MS, pinSet && !checkout.isPending && !exchangePending)

  // Checkout needs the cashier's open register session in this branch.
  const canOperate = can('cash_registers.operate')
  const session = useCurrentSessionQuery(canOperate)
  const sessionReady = !!session.data && session.data.branch?.id === branchId

  // Loyalty points as a payment method for the selected customer.
  const loyaltySettings = useLoyaltySettingsQuery()
  const loyaltyOn = loyaltySettings.data?.is_enabled === true
  const customerId = priced?.customer?.id
  const points = useLoyaltyBalancesQuery(customerId ? [customerId] : [], loyaltyOn && paying)
  const loyalty: LoyaltyTender | null = loyaltyOn && customerId && points.data?.[customerId] !== undefined && loyaltySettings.data
    ? { points: points.data[customerId] ?? 0, pointValue: loyaltySettings.data.point_value, minRedeemPoints: loyaltySettings.data.min_redeem_points }
    : null

  // POS1b: the selected customer's store credit (cart line, payment tender, advance).
  const queryClient = useQueryClient()
  const canSeeCredit = can('store_credit.view')
  const credit = useStoreCreditQuery(cart.customer?.id, canSeeCredit)
  const creditBalance = credit.data && cart.customer ? credit.data.balance : null
  const storeCredit: StoreCreditTender | null = priced?.customer && canSeeCredit ? { balance: priced.customer.id === cart.customer?.id ? creditBalance : null } : null

  /** `quantity`: units added, e.g. a scanned carton's 24 (ST2c). */
  const addItem = (item: PosItem, quantity = '1') => {
    if (!item.sellable) {
      toast.error(`${item.product_name} is not for sale.`)
      return
    }
    if (item.open_price) {
      setPriceTarget({ kind: 'add', item })
      return
    }
    apply((c) => cartOps.addItem(c, item, null, quantity))
  }

  const scan = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = search.trim()
    if (!code || !cart.storeId) return
    setScanning(true)
    try {
      const item = await lookupCode(cart.storeId, code)
      // ST2c: a pack barcode (carton, box) adds all its units; the server prices them.
      const units = item.scan_units && compareDecimal(item.scan_units, '1') > 0 ? trimDecimal(item.scan_units) : null
      addItem(item, units ?? '1')
      if (units && item.sellable && !item.open_price) toast.success(`${item.pack_name ?? 'Pack'} (${units}) · ${itemLabel(item)}`)
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
    if (cart.exchange) {
      toast.error('An exchange cannot be held; complete or cancel it.')
      return
    }
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
    if (cart.exchange) throw new Error('Complete or cancel the exchange first.')
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
        price: l.list_price ?? l.unit_price,
        open_price: l.open_price ?? false,
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
    if (!sessionReady) {
      toast.error('Open a register session before taking payment.')
      if (canOperate && !session.data) setOpeningRegister(true)
      return
    }
    checkout.reset()
    setPaying(true)
  }

  const complete = (payments: { method: PaymentMethod; amount: string; reference: string | null }[]) => {
    if (!cartInput) return
    const input = { ...cartInput, payments, held_sale_id: cart.heldSaleId }
    // POS1b: the fingerprint is kept with the cart (localStorage), so a gift card code is only hashed into it.
    const fingerprint = JSON.stringify({ ...input, payments: payments.map((p) => (p.method === 'gift_card' && p.reference ? { ...p, reference: codeFingerprint(p.reference) } : p)) })
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
        if (error instanceof ApiError && error.code === 'CASH_SESSION_REQUIRED') {
          setPaying(false)
          void session.refetch()
        }
        const retryable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
        if (!retryable) apply((c) => ({ ...c, pendingCheckout: null }))
        // POS1a: approvals, prices and the coupon are sorted out in the cart (manager approval, price, remove coupon).
        if (isTillProblem(error)) {
          setPaying(false)
          setCheckoutProblem({ error, cart: JSON.stringify(cartInput) })
        }
        // POS1b: store credit / gift card refusals show at their tender in the payment dialog.
        if (tenderProblem(error)) {
          if (cart.customer) void queryClient.invalidateQueries({ queryKey: storeCreditKey(cart.customer.id) })
          return
        }
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
    <ManagerApprovalProvider storeId={cart.storeId}>
    <div className="flex flex-col gap-3 lg:h-[calc(100svh-var(--topbar-height)-3rem)] lg:flex-row">
      <h1 className="sr-only">POS terminal</h1>
      <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Products">
        {canOperate ? (
          <RegisterSessionBar
            session={session.data}
            loading={session.isPending}
            branchId={branchId}
            branchName={me.branches.find((b) => b.id === branchId)?.name}
            openRequested={openingRegister}
            onOpenRequestedChange={setOpeningRegister}
          />
        ) : (
          <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Selling needs an open register session, and your role cannot open one (cash_registers.operate).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <StoreSelect value={cart.storeId} onChange={(storeId) => apply((c) => ({ ...c, storeId }))} branchIds={branchId ? [branchId] : null} aria-label="Selling from store" />
          </div>
          <CustomerPicker value={cart.customer} onChange={(customer) => apply((c) => ({ ...c, customer, invoiceDiscount: undefined }))} open={customerOpen} onOpenChange={setCustomerOpen} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setHeldOpen(true)}>
              <PauseIcon data-icon="inline-start" /> Held sales
            </Button>
            <Button type="button" variant="outline" onClick={() => setRecentOpen(true)}>
              <HistoryIcon data-icon="inline-start" /> Recent
            </Button>
            {can('returns.create') && can('sales.view') && (
              <Button
                type="button"
                variant="outline"
                disabled={!!cart.exchange || !!cart.heldSaleId}
                title={cart.exchange ? 'An exchange is in progress' : cart.heldSaleId ? 'Finish the resumed held sale first' : 'Take back items of an earlier invoice for new ones'}
                onClick={() => setStartingExchange(true)}
              >
                <ArrowLeftRightIcon data-icon="inline-start" /> Exchange
              </Button>
            )}
            <StoredValueMenu
              customer={cart.customer}
              creditBalance={creditBalance}
              till={{
                storeId: cart.storeId,
                organization: me.organization?.name ?? null,
                branch: me.branches.find((b) => b.id === branchId)?.name ?? null,
                cashier: me.user.name,
                currency: me.organization?.base_currency ?? 'BDT',
                cashReady: sessionReady,
              }}
            />
            <TillMenu storeId={cart.storeId} sessionReady={sessionReady} shop={me.organization?.name ?? null} />
            <Button
              type="button"
              variant="outline"
              disabled={checkout.isPending}
              title={pinSet ? 'Locks by itself after 5 minutes without input' : 'Set a till PIN under Profile & security to unlock without signing out'}
              onClick={() => lockTill(me.user.id)}
            >
              <LockIcon data-icon="inline-start" /> Lock
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

        {cart.exchange && <ExchangeBanner draft={cart.exchange} priced={pricingCurrent ? priced : undefined} onCancel={() => { apply(withoutExchange); toast.success('Exchange cancelled; nothing was returned.') }} />}
        <CartLines cart={cart} priced={priced} canDiscount={canDiscount} apply={apply} onChangePrice={(key) => setPriceTarget({ kind: 'line', key })} />

        <div className="flex flex-col gap-3 border-t p-3">
          {problem && <PricingProblem error={problem} cart={cart} apply={apply} onEnterPrice={(key) => setPriceTarget({ kind: 'line', key })} />}
          {itemCount > 0 && (
            <CouponField
              code={cart.couponCode ?? null}
              coupon={priced?.coupon}
              onApply={(couponCode) => apply((c) => ({ ...c, couponCode }))}
              onRemove={() => apply((c) => ({ ...c, couponCode: null }))}
            />
          )}
          {priced?.customer && (
            <p className="text-xs text-muted-foreground">
              {priced.customer.name}: owes {formatMoney(priced.customer.credit.outstanding, priced.currency)}
              {!isZeroDecimal(priced.customer.credit.credit_limit) && ` · credit available ${formatMoney(priced.customer.credit.available)}`}
              {!isZeroDecimal(priced.customer.group_discount_percent) && ` · group −${trimDecimal(priced.customer.group_discount_percent)}%`}
              {creditBalance !== null && !isZeroDecimal(creditBalance) && <span data-testid="cart-store-credit"> · store credit {formatMoney(creditBalance, priced.currency)}</span>}
            </p>
          )}
          {!priced?.customer && cart.customer && creditBalance !== null && !isZeroDecimal(creditBalance) && (
            <p className="text-xs text-muted-foreground" data-testid="cart-store-credit">{cart.customer.name}: store credit {formatMoney(creditBalance)}</p>
          )}
          {priced ? (
            <CartTotals priced={priced} cart={cart} canDiscount={canDiscount} apply={apply} />
          ) : (
            <div className="flex items-center justify-between text-lg font-semibold">
              Total <span className="font-mono">{cartInput && price.isFetching ? <Loader2Icon className="size-4 animate-spin" aria-label="Pricing" /> : '—'}</span>
            </div>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button type="button" variant="outline" size="lg" disabled={itemCount === 0 || hold.isPending || !!cart.exchange} onClick={holdCart}>
              <PauseIcon data-icon="inline-start" /> Hold <kbd className="ml-1 text-xs opacity-70">F8</kbd>
            </Button>
            <Button type="button" size="lg" disabled={itemCount === 0} onClick={openPayment}>
              {cart.exchange ? <ExchangePayLabel value={cart.exchange.value} priced={priced} /> : <>Pay {priced && formatMoney(priced.total, priced.currency)}</>} <kbd className="ml-1 text-xs opacity-70">F9</kbd>
            </Button>
          </div>
        </div>
      </aside>

      <ExchangeCheckout
        open={paying && !!cart.exchange}
        onOpenChange={setPaying}
        cart={cart}
        apply={apply}
        cartInput={cartInput}
        priced={priced}
        canCredit={can('sales.credit')}
        loyalty={loyalty}
        storeCredit={storeCredit}
        onTillProblem={(error) => setCheckoutProblem({ error, cart: JSON.stringify(cartInput) })}
        onSessionLost={() => void session.refetch()}
        onFinished={() => searchRef.current?.focus()}
      />
      {startingExchange && (
        <ExchangeDialog
          branchId={branchId}
          onClose={() => setStartingExchange(false)}
          onStart={(draft) => {
            apply((c) => withExchange(c, draft))
            setStartingExchange(false)
            toast.success(`Exchange for ${draft.invoice.number} started. Add the new items, then pay.`)
            searchRef.current?.focus()
          }}
        />
      )}
      {paying && priced && !cart.exchange && (
        <PaymentDialog
          open={paying}
          onOpenChange={(o) => { if (!checkout.isPending) setPaying(o) }}
          priced={priced}
          canCredit={can('sales.credit')}
          loyalty={loyalty}
          storeCredit={storeCredit}
          checkoutError={checkout.error}
          pending={checkout.isPending}
          onSubmit={complete}
        />
      )}
      <TillReceiptDialog
        sale={completed}
        fresh
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
        onConfirm={() => { apply((c) => (c.exchange ? { ...cartOps.empty(c.storeId), customer: c.customer, exchange: c.exchange } : cartOps.empty(c.storeId))); setClearing(false) }}
      />
      {priceTarget && <PriceFlow target={priceTarget} cart={cart} apply={apply} canOverride={canOverride} onClose={() => setPriceTarget(null)} />}
    </div>
    </ManagerApprovalProvider>
  )
}
