import { useState } from 'react'
import { ArrowLeftRightIcon, Loader2Icon, MinusIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { fetchInvoice, searchInvoices } from '@/features/pos/exchange-api'
import { invoiceRefusal, saleLineHasLeft as hasLeft, type ExchangeDraft } from '@/features/pos/exchange'
import { usePreviewReturnMutation, useReturnReasonsQuery, type ReturnLineInput, type ReturnPreview } from '@/features/returns/api'
import { returnableQuantity } from '@/features/returns/status'
import { lineLabel, type Sale, type SaleHeader, type SaleLine } from '@/features/sales/api'
import { fieldErrorMap } from '@/lib/forms'
import { addDecimal, compareDecimal, decimalPattern, formatMoney, isZeroDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

const QTY_PATTERN = decimalPattern(3)

/** `restock` undefined = the reason's default. */
type LineDraft = { quantity: string; restock?: boolean; serials: string[] }

/**
 * POS1c: starts an exchange — find the invoice (type or scan its number), choose what comes back
 * (quantities, serials, reason, back to stock), check its value with `/returns/preview`, then
 * continue: the till goes into exchange mode and the cashier rings up the new items.
 */
export function ExchangeDialog({ branchId, onClose, onStart }: { branchId: string; onClose: () => void; onStart: (draft: ExchangeDraft) => void }) {
  const [term, setTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [matches, setMatches] = useState<SaleHeader[]>([])
  const [sale, setSale] = useState<Sale | null>(null)

  const find = async (load: () => Promise<{ exact: Sale | null; matches: SaleHeader[] }>) => {
    setSearching(true)
    setSearchError(null)
    try {
      const result = await load()
      setSale(result.exact)
      setMatches(result.exact ? [] : result.matches)
      if (!result.exact && result.matches.length === 0) setSearchError(`No invoice matches “${term.trim()}”.`)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'The invoice could not be loaded.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowLeftRightIcon className="size-5" aria-hidden /> Exchange items</DialogTitle>
          <DialogDescription>Find the invoice, choose what the customer brings back, then ring up what they take instead.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (term.trim()) void find(() => searchInvoices(term))
          }}
        >
          <Input
            autoFocus
            aria-label="Invoice number"
            placeholder="Scan or type the invoice number"
            className="font-mono"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={searching || !term.trim()}>
            {searching ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SearchIcon data-icon="inline-start" />} Find
          </Button>
        </form>
        {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}
        {matches.length > 0 && (
          <div className="flex flex-col gap-1" role="group" aria-label="Matching invoices">
            <p className="text-sm text-muted-foreground">Choose the invoice:</p>
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex items-center justify-between gap-3 rounded-md border p-2 text-left text-sm hover:bg-accent"
                onClick={() => void find(async () => ({ exact: await fetchInvoice(m.id), matches: [] }))}
              >
                <span className="font-mono">{m.number}</span>
                <span className="text-xs text-muted-foreground">{new Date(m.sold_at).toLocaleString()} · {m.customer?.name ?? 'Walk-in'}</span>
                <span className="font-mono">{formatMoney(m.total, m.currency)}</span>
              </button>
            ))}
          </div>
        )}
        {sale && <ReturnPicker key={sale.id} sale={sale} branchId={branchId} onStart={onStart} onClose={onClose} />}
        {!sale && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReturnPicker({ sale, branchId, onStart, onClose }: { sale: Sale; branchId: string; onStart: (draft: ExchangeDraft) => void; onClose: () => void }) {
  const reasons = useReturnReasonsQuery()
  const preview = usePreviewReturnMutation()
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [reasonId, setReasonId] = useState('none')
  const [previewed, setPreviewed] = useState<{ fingerprint: string; result: ReturnPreview } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const refusal = invoiceRefusal(sale, branchId)
  const activeReasons = (reasons.data ?? []).filter((r) => r.is_active)
  const reason = activeReasons.find((r) => r.id === reasonId)
  const restockDefault = reason?.restock_by_default ?? true
  const draftFor = (line: SaleLine): LineDraft => drafts[line.id] ?? { quantity: '', serials: [] }
  const update = (line: SaleLine, patch: Partial<LineDraft>) => setDrafts((ds) => ({ ...ds, [line.id]: { ...draftFor(line), ...patch } }))
  const chooseReason = (id: string) => {
    setReasonId(id)
    setDrafts((ds) => Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, { ...d, restock: undefined }])))
  }

  const lines: ReturnLineInput[] = sale.lines.flatMap((l) => {
    const d = drafts[l.id]
    if (!d) return []
    const restock = d.restock ?? restockDefault
    if (l.serials.length > 0) return d.serials.length > 0 ? [{ sale_line_id: l.id, quantity: String(d.serials.length), restock, serials: d.serials }] : []
    const qty = d.quantity.trim()
    return qty !== '' && QTY_PATTERN.test(qty) && !isZeroDecimal(qty) ? [{ sale_line_id: l.id, quantity: qty, restock }] : []
  })
  const over = (l: SaleLine) => {
    const q = draftFor(l).quantity.trim()
    return q !== '' && (!QTY_PATTERN.test(q) || compareDecimal(q, returnableQuantity(l)) > 0)
  }
  const lineProblem = sale.lines.some((l) => l.serials.length === 0 && over(l))
  const input = { sale_id: sale.id, return_reason_id: reason?.id ?? null, notes: null, lines }
  const fingerprint = JSON.stringify(input)
  const current = previewed?.fingerprint === fingerprint ? previewed.result : null

  const step = (l: SaleLine, direction: 1 | -1) => {
    const q = draftFor(l).quantity.trim()
    const base = q !== '' && QTY_PATTERN.test(q) ? q : '0'
    let next = direction === 1 ? addDecimal(base, '1') : subtractDecimal(base, '1')
    const max = returnableQuantity(l)
    if (compareDecimal(next, max) > 0) next = max
    if (next.startsWith('-') || isZeroDecimal(next)) next = '0'
    update(l, { quantity: isZeroDecimal(next) ? '' : trimDecimal(next) })
  }

  const check = () => {
    setErrors({})
    preview.mutate(input, {
      onSuccess: (result) => setPreviewed({ fingerprint, result }),
      onError: (err) => setErrors(fieldErrorMap(err)),
    })
  }

  const start = () => {
    if (!current) return
    onStart({
      invoice: { id: sale.id, number: sale.number, currency: sale.currency, customer: sale.customer ? { id: sale.customer.id, code: sale.customer.code, name: sale.customer.name, phone: sale.customer.phone } : null },
      return: input,
      total: current.total,
      value: current.settlement.refund_due,
      credit: current.settlement.credit,
      refundable: current.settlement.refundable,
      lines: current.lines.map((l) => ({ product_name: l.product_name, quantity: l.quantity, line_total: l.line_total })),
      approvalId: null,
    })
  }

  const c = sale.currency

  return (
    <div className="flex flex-col gap-4" data-testid="exchange-invoice">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-mono text-base font-semibold">{sale.number}</span>
        <span className="text-muted-foreground">{new Date(sale.sold_at).toLocaleString()} · {sale.customer?.name ?? 'Walk-in'} · {formatMoney(sale.total, c)}</span>
      </div>
      {refusal ? (
        <>
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{refusal}</p>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></DialogFooter>
        </>
      ) : (
        <>
          <Select value={reasonId} onValueChange={chooseReason}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Return reason"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No reason given</SelectItem>
              {activeReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {errors.return_reason_id && <p className="text-sm text-destructive">{errors.return_reason_id}</p>}

          <ul className="flex flex-col divide-y rounded-md border" aria-label="Invoice lines">
            {sale.lines.map((l) => {
              const label = lineLabel(l)
              const returnable = returnableQuantity(l)
              const d = draftFor(l)
              const index = lines.findIndex((x) => x.sale_line_id === l.id)
              const serverError = index >= 0 ? errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.serials`] : undefined
              const free = l.serials.filter((s) => !l.returned_serials.includes(s))
              return (
                <li key={l.id} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        Sold {trimDecimal(l.quantity)} {l.unit_code} · {formatMoney(l.line_total, c)} · can return <span data-testid="returnable">{trimDecimal(returnable)}</span>
                      </div>
                    </div>
                    {hasLeft(l) && (
                      <label className="flex items-center gap-2 text-xs">
                        <Switch aria-label={`Back to stock: ${label}`} checked={d.restock ?? restockDefault} onCheckedChange={(v) => update(l, { restock: v })} />
                        Back to stock
                      </label>
                    )}
                  </div>
                  {!hasLeft(l) ? (
                    <span className="text-sm text-muted-foreground">Nothing left to return</span>
                  ) : l.serials.length > 0 ? (
                    <div className="flex flex-wrap gap-3" role="group" aria-label={`Serials of ${label}`}>
                      {free.map((s) => (
                        <label key={s} className="flex items-center gap-2 font-mono text-xs">
                          <Checkbox checked={d.serials.includes(s)} onCheckedChange={(v) => update(l, { serials: v ? [...d.serials, s] : d.serials.filter((x) => x !== s) })} />
                          {s}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer ${label}`} onClick={() => step(l, -1)}><MinusIcon /></Button>
                      <Input
                        aria-label={`Return quantity of ${label}`}
                        aria-invalid={over(l) || serverError ? true : undefined}
                        inputMode="decimal"
                        className="h-8 w-20 text-center font-mono"
                        placeholder="0"
                        value={d.quantity}
                        onChange={(e) => update(l, { quantity: e.target.value })}
                      />
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`More ${label}`} onClick={() => step(l, 1)}><PlusIcon /></Button>
                    </div>
                  )}
                  {over(l) && <p className="text-xs text-destructive">At most {trimDecimal(returnable)}.</p>}
                  {serverError && <p className="text-xs text-destructive">{serverError}</p>}
                </li>
              )
            })}
          </ul>
          {(errors.form || errors.lines) && <p role="alert" className="text-sm text-destructive">{errors.form ?? errors.lines}</p>}

          {current && (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-md border p-3 text-sm" aria-label="Exchange value">
              {current.lines.map((l) => (
                <div key={l.sale_line_id} className="contents">
                  <dt className="text-muted-foreground">{l.product_name} × {trimDecimal(l.quantity)}</dt>
                  <dd className="text-right font-mono">{formatMoney(l.line_total, c)}</dd>
                </div>
              ))}
              {!isZeroDecimal(current.settlement.credit) && (
                <>
                  <dt className="text-muted-foreground" data-testid="exchange-credit-note">{formatMoney(current.settlement.credit, c)} goes against what the customer still owes on {sale.number}</dt>
                  <dd className="text-right font-mono">−{formatMoney(current.settlement.credit, c)}</dd>
                </>
              )}
              <dt className="font-semibold">Exchange value</dt>
              <dd className="text-right font-mono font-semibold" data-testid="exchange-value">{formatMoney(current.settlement.refund_due, c)}</dd>
            </dl>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            {current ? (
              <Button type="button" onClick={start}>Continue</Button>
            ) : (
              <Button type="button" disabled={lines.length === 0 || lineProblem || preview.isPending} onClick={check}>
                {preview.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Check value
              </Button>
            )}
          </DialogFooter>
        </>
      )}
    </div>
  )
}
