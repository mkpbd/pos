import { useState } from 'react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { PaginationBar } from '@/components/common/pagination-bar'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { StoreCreditDialog } from '@/features/customers/components/store-credit-dialog'
import {
  STORE_CREDIT_ENTRY_LABELS,
  STORE_CREDIT_METHODS,
  useStoreCreditEntriesQuery,
  useStoreCreditQuery,
  type StoreCreditAction,
} from '@/features/customers/store-credit-api'
import { formatMoney, isZeroDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

const when = (iso: string, timeZone?: string) => new Date(iso).toLocaleString(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' })

/**
 * POS1b: the customer's store credit (store_credit.view) — balance, paged entries, "Add advance"
 * (payments.collect), "Adjust" and "Pay out" (store_credit.manage).
 */
export function StoreCreditCard({ customer }: { customer: { id: string; name: string } }) {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const [page, setPage] = useState(1)
  const [action, setAction] = useState<StoreCreditAction | null>(null)
  const credit = useStoreCreditQuery(customer.id)
  const entries = useStoreCreditEntriesQuery(customer.id, page)
  const currency = credit.data?.currency ?? me.organization?.base_currency
  const canManage = can('store_credit.manage')
  const balance = credit.data?.balance ?? null
  const hasBalance = balance !== null && !isZeroDecimal(balance)

  return (
    <Card size="sm" aria-labelledby="store-credit-title" role="region">
      <CardHeader>
        <CardTitle id="store-credit-title">Store credit</CardTitle>
        {(can('payments.collect') || canManage) && (
          <CardAction className="flex flex-wrap justify-end gap-2">
            {can('payments.collect') && <Button size="sm" onClick={() => setAction('top_up')}>Add advance</Button>}
            {canManage && <Button size="sm" variant="outline" onClick={() => setAction('adjustment')}>Adjust</Button>}
            {canManage && <Button size="sm" variant="outline" disabled={!hasBalance} onClick={() => setAction('withdrawal')}>Pay out</Button>}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {credit.isPending ? (
          <LoadingState rows={1} label="Loading store credit" />
        ) : credit.error ? (
          <ErrorState error={credit.error} onRetry={() => credit.refetch()} />
        ) : (
          <div>
            <div className="font-mono text-xl font-semibold" data-testid="store-credit-balance">{formatMoney(credit.data.balance, currency)}</div>
            <div className="text-xs text-muted-foreground">
              {credit.data.last_activity_at ? `Last activity ${when(credit.data.last_activity_at, timeZone)}` : 'No activity yet'}
            </div>
          </div>
        )}

        {entries.isPending ? (
          <LoadingState rows={2} label="Loading store credit entries" />
        ) : entries.error ? (
          <ErrorState error={entries.error} onRetry={() => entries.refetch()} />
        ) : entries.data.items.length === 0 ? null : (
          <>
            <div className="overflow-x-auto">
              <Table aria-label="Store credit entries">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm whitespace-nowrap">{when(e.created_at, timeZone)}</TableCell>
                      <TableCell className="text-sm">
                        {STORE_CREDIT_ENTRY_LABELS[e.type] ?? e.type}
                        {e.method && <span className="text-muted-foreground"> · {STORE_CREDIT_METHODS[e.method] ?? e.method}</span>}
                        {(e.receipt_number || e.reference_number) && <span className="font-mono text-xs text-muted-foreground"> {e.receipt_number ?? e.reference_number}</span>}
                        {(e.note || e.created_by?.name) && (
                          <div className="text-xs text-muted-foreground">{[e.note, e.created_by?.name && `by ${e.created_by.name}`].filter(Boolean).join(' · ')}</div>
                        )}
                      </TableCell>
                      <TableCell className={cn('text-right font-mono', e.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400')}>
                        {e.amount.startsWith('-') ? formatMoney(e.amount) : `+${formatMoney(e.amount)}`}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(e.balance_after)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={entries.data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>
      <StoreCreditDialog action={action} onOpenChange={(o) => !o && setAction(null)} customer={customer} balance={balance} currency={currency} />
    </Card>
  )
}
