import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { useCustomerPaymentsQuery } from '@/features/customers/api'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PAYMENTS_TABS } from '@/features/inventory/sections'
import { PAYMENT_SOURCES, usePaymentsLedgerQuery, type PaymentDirection, type PaymentEntry } from '@/features/payments/api'
import { formatMoney } from '@/lib/money'
import { MONEY_METHODS, type MoneyMethod } from '@/lib/payment-methods'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'
const todayIso = () => new Date().toLocaleDateString('en-CA')
const monthStartIso = () => `${todayIso().slice(0, 8)}01`

/** Where a ledger row's document lives in the SPA, if it has a page. */
function sourceLink(entry: PaymentEntry): string | null {
  if (!entry.source_id) return null
  if (entry.source_type === 'sale' || entry.source_type === 'sale_cancellation') return `/sales/${entry.source_id}`
  if (entry.source_type === 'sale_return') return `/returns/${entry.source_id}`
  if (entry.source_type === 'online_order') return `/web-orders/${entry.source_id}`
  return null
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-from">From</Label>
        <Input id="range-from" type="date" className="w-40" value={from} max={to} onChange={(e) => onChange(e.target.value || from, to)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-to">To</Label>
        <Input id="range-to" type="date" className="w-40" value={to} min={from} max={todayIso()} onChange={(e) => onChange(from, e.target.value || to)} />
      </div>
    </div>
  )
}

export function PaymentsPage() {
  const me = useAuth()
  const currency = me.organization?.base_currency
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState(monthStartIso)
  const [to, setTo] = useState(todayIso)
  const [method, setMethod] = useState<MoneyMethod | typeof ALL>(ALL)
  const [direction, setDirection] = useState<PaymentDirection | typeof ALL>(ALL)
  const [source, setSource] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const { data, error, isPending, refetch } = usePaymentsLedgerQuery({
    page,
    from,
    to,
    method: method === ALL ? undefined : method,
    direction: direction === ALL ? undefined : direction,
    source_type: source === ALL ? undefined : source,
    search: term || undefined,
  })
  const reset = () => setPage(1)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Every amount of money received or paid out, from sales, refunds, collections, expenses and cash movements." />
      <SectionTabs tabs={PAYMENTS_TABS} label="Payments sections" />
      <div className="flex flex-wrap items-end gap-3">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); reset() }} />
        <Select value={direction} onValueChange={(v) => { setDirection(v as PaymentDirection | typeof ALL); reset() }}>
          <SelectTrigger className="w-36" aria-label="Filter by direction"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>In and out</SelectItem>
            <SelectItem value="in">Money in</SelectItem>
            <SelectItem value="out">Money out</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={(v) => { setMethod(v as MoneyMethod | typeof ALL); reset() }}>
          <SelectTrigger className="w-44" aria-label="Filter by method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All methods</SelectItem>
            {(Object.keys(MONEY_METHODS) as MoneyMethod[]).map((m) => <SelectItem key={m} value={m}>{MONEY_METHODS[m]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => { setSource(v); reset() }}>
          <SelectTrigger className="w-48" aria-label="Filter by type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {Object.entries(PAYMENT_SOURCES).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="Search payments" placeholder="Document no. or reference" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); reset() }} />
      </div>

      {data?.totals && (
        <div className="grid grid-cols-3 gap-3" aria-label="Totals">
          {([['Money in', data.totals.in], ['Money out', data.totals.out], ['Net', data.totals.net]] as const).map(([label, value]) => (
            <Card key={label} size="sm">
              <CardContent>
                <CardTitle className="mb-2">{label}</CardTitle>
                <div className="font-mono text-xl font-bold text-primary">{formatMoney(value, currency)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isPending ? (
        <LoadingState rows={6} label="Loading payments" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No payments in this period" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="hidden lg:table-cell">Session</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => {
                  const link = sourceLink(e)
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">
                        {e.source_label}{' '}
                        {e.source_number && (link ? <Link to={link} className="font-mono text-xs underline-offset-4 hover:underline">{e.source_number}</Link> : <span className="font-mono text-xs text-muted-foreground">{e.source_number}</span>)}
                        {(e.reference || e.description) && <div className="text-xs text-muted-foreground">{[e.reference, e.description].filter(Boolean).join(' · ')}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{e.method_label}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {e.session ? <Link to={`/cash-registers/sessions/${e.session.id}`} className="font-mono text-xs underline-offset-4 hover:underline">{e.session.number}</Link> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{e.created_by?.name ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={e.direction === 'in' ? 'success' : 'destructive'} className="font-mono">
                          {e.direction === 'in' ? '+' : '−'}{formatMoney(e.amount)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

export function CustomerPaymentsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const { data, error, isPending, refetch } = useCustomerPaymentsQuery({ page, search: term || undefined })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Money customers paid against their balance. Record one from the customer's statement on the Customers page." />
      <SectionTabs tabs={PAYMENTS_TABS} label="Payments sections" />
      <Input aria-label="Search customer payments" placeholder="Receipt number or reference" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />

      {isPending ? (
        <LoadingState rows={5} label="Loading customer payments" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No customer payments" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.number}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{p.customer?.name ?? '—'} <span className="font-mono text-xs text-muted-foreground">{p.customer?.code}</span></TableCell>
                    <TableCell className="text-sm">{p.method_label}{p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{p.created_by?.name ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(p.amount, p.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
