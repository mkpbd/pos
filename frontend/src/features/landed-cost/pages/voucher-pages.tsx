import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, PlusIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { SectionTabs } from '@/features/inventory/components/inventory-tabs'
import { PURCHASING_TABS } from '@/features/inventory/sections'
import { Field } from '@/features/procurement/components/shared'
import { formatDateTime } from '@/features/web-orders/orders'
import { LANDED_COST_PERMISSIONS, useVoucherQuery, useVouchersQuery, VOUCHER_STATUS, type LandedCostVoucher, type VoucherStatus } from '@/features/landed-cost/api'
import { allocationLabel, chargeTypeLabel } from '@/features/landed-cost/allocation'
import { VoucherAllocationTable } from '@/features/landed-cost/components/voucher-allocation-table'
import { VoucherForm } from '@/features/landed-cost/components/voucher-form'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

type Tab = VoucherStatus | 'all'
const TABS: Tab[] = ['all', 'draft', 'posted']
const tabLabel = (t: Tab) => (t === 'all' ? 'All' : VOUCHER_STATUS[t].label)

/** /purchasing/landed-costs — landed cost vouchers (freight / duty bills that arrive after the goods). */
export function VouchersPage() {
  const can = useCan()
  const [params, setParams] = useSearchParams()
  const tab = (TABS as string[]).includes(params.get('status') ?? '') ? (params.get('status') as Tab) : 'all'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim())
  const query = { status: tab === 'all' ? undefined : tab, search: term || undefined }
  const { data, error, isPending, refetch } = useVouchersQuery({ ...query, page })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchasing"
        description="Landed cost vouchers: freight, duty or insurance billed after the goods were received, spread into stock costs."
        actions={
          <>
            <ExportMenu list="landedCostVouchers" query={query} disabled={!data?.items.length} />
            {can(LANDED_COST_PERMISSIONS.manage) && <Button asChild><Link to="/purchasing/landed-costs/new"><PlusIcon data-icon="inline-start" /> New voucher</Link></Button>}
          </>
        }
      />
      <SectionTabs tabs={PURCHASING_TABS} label="Purchasing sections" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => { setParams(v === 'all' ? {} : { status: v }, { replace: true }); setPage(1) }}>
          <TabsList aria-label="Voucher status">
            {TABS.map((t) => <TabsTrigger key={t} value={t}>{tabLabel(t)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Input aria-label="Search vouchers" placeholder="Number or supplier bill no." className="w-full sm:max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {isPending ? (
        <LoadingState rows={5} label="Loading landed cost vouchers" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title={tab !== 'all' || term ? 'No vouchers match' : 'No landed cost vouchers yet'} description={tab === 'all' && !term ? 'Charges known when the goods arrive go on the receipt itself; use a voucher for bills that come later.' : undefined} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Landed cost vouchers">
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Billed by</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="hidden md:table-cell">Bill no.</TableHead>
                  <TableHead className="hidden md:table-cell">Receipts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell><Link to={`/purchasing/landed-costs/${v.id}`} className="font-mono text-sm underline-offset-4 hover:underline">{v.number}</Link></TableCell>
                    <TableCell className="text-sm">{v.charge_supplier?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{v.voucher_date}</TableCell>
                    <TableCell className="hidden font-mono text-sm md:table-cell">{v.reference ?? '—'}</TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{v.receipt_numbers?.length ? v.receipt_numbers.join(', ') : (v.receipt_count ?? '—')}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(v.total, v.currency)}</TableCell>
                    <TableCell><Badge variant={VOUCHER_STATUS[v.status]?.variant ?? 'outline'}>{VOUCHER_STATUS[v.status]?.label ?? v.status}</Badge></TableCell>
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

function VoucherView({ voucher }: { voucher: LandedCostVoucher }) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const status = VOUCHER_STATUS[voucher.status] ?? { label: voucher.status, variant: 'outline' as const }
  const posted = voucher.status === 'posted'

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to landed costs"><Link to="/purchasing/landed-costs"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{voucher.number}</h1>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <Field label="Billed by">{voucher.charge_supplier?.name ?? '—'}</Field>
            <Field label="Voucher date">{voucher.voucher_date}</Field>
            <Field label="Supplier bill no.">{voucher.reference ?? '—'}</Field>
            <Field label="Branch">{voucher.branch?.name ?? '—'}</Field>
            <Field label="Charges">{formatMoney(voucher.charges_total, voucher.currency)}</Field>
            <Field label="Tax">{formatMoney(voucher.tax_total)}</Field>
            <Field label="Payable to supplier">{formatMoney(voucher.total, voucher.currency)}</Field>
            {posted && <Field label="Posted">{voucher.posted_at ? formatDateTime(voucher.posted_at, timeZone) : '—'}{voucher.posted_by?.name && ` · ${voucher.posted_by.name}`}</Field>}
            {voucher.notes && <Field label="Notes" className="sm:col-span-4">{voucher.notes}</Field>}
          </dl>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Voucher charges">
                <TableHeader>
                  <TableRow>
                    <TableHead>Charge</TableHead>
                    <TableHead className="hidden sm:table-cell">Allocation</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(voucher.charges ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{chargeTypeLabel(c.type)}</div>
                        {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">{allocationLabel(c.allocation)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(c.amount)}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(c.tax_amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Receipts</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y text-sm" aria-label="Receipts on the voucher">
              {(voucher.receipts ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link to={`/purchasing/receipts/${r.id}`} className="font-mono underline-offset-4 hover:underline">{r.number}</Link>
                  <span className="text-muted-foreground">{r.supplier?.name}{r.invoice_date && ` · ${r.invoice_date}`}</span>
                  {(r.landed_total ?? r.subtotal) && <span className="ml-auto font-mono">{formatMoney(r.landed_total ?? r.subtotal, voucher.currency)}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <section aria-labelledby="allocation-heading" className="flex flex-col gap-3">
        <h2 id="allocation-heading" className="text-lg font-semibold">{posted ? 'Allocation' : 'Allocation preview'}</h2>
        {posted ? (
          <>
            <VoucherAllocationTable lines={voucher.allocations ?? []} currency={voucher.currency} label="Posted allocation" />
            {voucher.expense && <p className="text-sm text-muted-foreground">The share for stock already sold or used was recorded as expense {voucher.expense.number ?? ''} on {voucher.voucher_date}.</p>}
          </>
        ) : (
          <>
            <VoucherAllocationTable lines={voucher.allocations ?? []} currency={voucher.currency} label="Allocation preview" />
            <p className="text-sm text-muted-foreground">Against the stock on hand now; the split is fixed when the voucher is posted.</p>
          </>
        )}
      </section>
    </div>
  )
}

/** /purchasing/landed-costs/new and /purchasing/landed-costs/:voucherId */
export function VoucherPage() {
  const { voucherId } = useParams()
  const can = useCan()
  const { data, error, isPending, refetch } = useVoucherQuery(voucherId)

  if (!voucherId) return <VoucherForm key="new" />
  if (isPending) return <LoadingState rows={6} label="Loading voucher" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return data.status === 'draft' && can(LANDED_COST_PERMISSIONS.manage) ? <VoucherForm key={data.id} voucher={data} /> : <VoucherView voucher={data} />
}
