import { useState } from 'react'
import { Link } from 'react-router'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ExportMenu } from '@/components/common/export-menu'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { STATEMENT_ENTRY_LABELS, useCustomerStatementQuery, type Customer, type CustomerStatementEntry } from '@/features/customers/api'
import { OnlineAccountCard } from '@/features/customers/components/online-account-card'
import { WebActivityCard } from '@/features/customers/components/web-activity-card'
import { ReceivePaymentDialog } from '@/features/customers/components/receive-payment-dialog'
import { LOYALTY_TRANSACTION_LABELS, pointsValue, useAdjustPointsMutation, useLoyaltyAccountQuery, useLoyaltySettingsQuery } from '@/features/loyalty/api'
import { fieldErrorMap } from '@/lib/forms'
import { formatMoney } from '@/lib/money'

function entryLink(e: CustomerStatementEntry): string | null {
  if (e.type === 'sale' || e.type === 'sale_payment' || e.type === 'sale_cancellation') return `/sales/${e.id}`
  if (e.type === 'sale_return' || e.type === 'refund') return `/returns/${e.id}`
  return null
}

function StatementTab({ customer, currency }: { customer: Customer; currency?: string }) {
  const can = useCan()
  const [receiving, setReceiving] = useState(false)
  const { data, error, isPending, refetch } = useCustomerStatementQuery(customer.id, {})

  if (isPending) return <LoadingState rows={4} label="Loading statement" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <div className="text-xs text-muted-foreground">Balance owed</div>
          <div className="font-mono text-xl font-semibold" data-testid="statement-balance">{formatMoney(data.closing_balance, currency)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu list="customerStatement" pathParams={{ id: customer.id }} size="sm" />
          {can('payments.collect') && <Button size="sm" onClick={() => setReceiving(true)}>Receive payment</Button>}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={3} className="text-sm text-muted-foreground">Opening balance</TableCell>
            <TableCell className="text-right font-mono">{formatMoney(data.opening_balance)}</TableCell>
          </TableRow>
          {data.entries.map((e) => {
            const link = entryLink(e)
            return (
              <TableRow key={`${e.type}-${e.id}`}>
                <TableCell className="text-sm whitespace-nowrap">{e.date.slice(0, 10)}</TableCell>
                <TableCell className="text-sm">
                  {STATEMENT_ENTRY_LABELS[e.type]}{' '}
                  {link ? <Link to={link} className="font-mono text-xs underline-offset-4 hover:underline">{e.number}</Link> : <span className="font-mono text-xs text-muted-foreground">{e.number}</span>}
                </TableCell>
                <TableCell className={`text-right font-mono ${e.amount.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{formatMoney(e.amount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMoney(e.balance)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ReceivePaymentDialog open={receiving} onOpenChange={setReceiving} customer={customer} />
    </div>
  )
}

function LoyaltyTab({ customer, currency }: { customer: Customer; currency?: string }) {
  const can = useCan()
  const settings = useLoyaltySettingsQuery()
  const { data, error, isPending, refetch } = useLoyaltyAccountQuery(customer.id)
  const adjust = useAdjustPointsMutation()
  const [points, setPoints] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (isPending) return <LoadingState rows={4} label="Loading points" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^-?\d+$/.test(points.trim()) || /^-?0+$/.test(points.trim())) return setErrors({ points: 'A whole number of points, negative to deduct.' })
    if (!notes.trim()) return setErrors({ notes: 'Say why.' })
    setErrors({})
    adjust.mutate({ customerId: customer.id, points: Number(points.trim()), notes: notes.trim() }, {
      onSuccess: (r) => { toast.success(`Points adjusted; balance ${r.balance}.`); setPoints(''); setNotes('') },
      onError: (err) => setErrors(fieldErrorMap(err)),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {settings.data && !settings.data.is_enabled && <p className="text-sm text-muted-foreground">The loyalty program is switched off; points are neither earned nor redeemable.</p>}
      <div className="grid grid-cols-3 gap-3 rounded-md border p-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Points</div>
          <div className="font-mono text-xl font-semibold" data-testid="points-balance">{data.balance}</div>
          {settings.data && <div className="text-xs text-muted-foreground">worth {formatMoney(pointsValue(data.balance, settings.data.point_value), currency)}</div>}
        </div>
        <div><div className="text-xs text-muted-foreground">Earned (lifetime)</div><div className="font-mono">{data.lifetime_earned}</div></div>
        <div><div className="text-xs text-muted-foreground">Redeemed (lifetime)</div><div className="font-mono">{data.lifetime_redeemed}</div></div>
      </div>

      {can('loyalty.manage') && (
        <form onSubmit={submit} noValidate className="grid gap-2 rounded-md border p-3 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-points">Points (±)</Label>
            <Input id="adjust-points" inputMode="numeric" className="font-mono" value={points} onChange={(e) => setPoints(e.target.value)} aria-invalid={errors.points ? true : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-notes">Reason</Label>
            <Input id="adjust-notes" maxLength={255} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. goodwill for late delivery" aria-invalid={errors.notes ? true : undefined} />
          </div>
          <Button type="submit" variant="outline" disabled={adjust.isPending}>
            {adjust.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Adjust
          </Button>
          {(errors.points || errors.notes || errors.form) && <p role="alert" className="text-sm text-destructive sm:col-span-3">{errors.points ?? errors.notes ?? errors.form}</p>}
        </form>
      )}

      {data.transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No points activity yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead className="text-right">Points</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.transactions.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm whitespace-nowrap">{new Date(t.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-sm">
                  {LOYALTY_TRANSACTION_LABELS[t.type]} {t.source_number && <span className="font-mono text-xs text-muted-foreground">{t.source_number}</span>}
                  {t.notes && <div className="text-xs text-muted-foreground">{t.notes}</div>}
                </TableCell>
                <TableCell className={`text-right font-mono ${t.points < 0 ? 'text-destructive' : ''}`}>{t.points > 0 ? `+${t.points}` : t.points}</TableCell>
                <TableCell className="text-right font-mono">{t.balance_after}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/** A customer's account: running statement (what they owe) and loyalty points. */
export function CustomerAccountSheet({ customer, onOpenChange }: { customer: Customer | null; onOpenChange: (open: boolean) => void }) {
  const me = useAuth()
  const can = useCan()
  const currency = me.organization?.base_currency
  const canStatement = can('sales.view') || can('payments.view')

  return (
    <Sheet open={customer !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{customer?.name}</SheetTitle>
          <SheetDescription>Sales and returns move the balance; payments reduce it. Points are earned on purchases.</SheetDescription>
        </SheetHeader>
        {customer && (
          <div className="flex flex-col gap-4 px-4">
            <OnlineAccountCard customerId={customer.id} />
            <WebActivityCard customerId={customer.id} />
          </div>
        )}
        {customer && (
          <Tabs defaultValue={canStatement ? 'statement' : 'loyalty'} className="px-4 pb-4">
            <TabsList>
              {canStatement && <TabsTrigger value="statement">Statement</TabsTrigger>}
              <TabsTrigger value="loyalty">Loyalty points</TabsTrigger>
            </TabsList>
            {canStatement && <TabsContent value="statement" className="pt-4"><StatementTab customer={customer} currency={currency} /></TabsContent>}
            <TabsContent value="loyalty" className="pt-4"><LoyaltyTab customer={customer} currency={currency} /></TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  )
}
