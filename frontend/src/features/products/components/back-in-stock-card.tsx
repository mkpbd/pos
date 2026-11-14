import { useId, useState } from 'react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBackInStockQuery } from '@/features/products/api'

type Status = 'open' | 'notified'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatDate = (iso: string) => dateFormat.format(new Date(iso))

/**
 * Shoppers who asked to hear when a sold-out variant is back (P1a §3). They get one e-mail as soon
 * as the variant can be sold again; the "Waiting" count also shows per row in the variant grid.
 */
export function BackInStockCard({ productId }: { productId: string }) {
  const ids = useId()
  const [status, setStatus] = useState<Status>('open')
  const [page, setPage] = useState(1)
  const query = useBackInStockQuery(productId, { page, status })

  return (
    <Card id="back-in-stock" role="region" aria-labelledby={`${ids}-title`}>
      <CardHeader>
        <CardTitle id={`${ids}-title`}>Back-in-stock requests</CardTitle>
        <CardDescription>
          Shoppers who pressed “Notify me” on a sold-out variant in your online store. Each gets one e-mail when you add stock again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as Status); setPage(1) }}>
          <TabsList aria-label="Request status">
            <TabsTrigger value="open">Waiting</TabsTrigger>
            <TabsTrigger value="notified">Already e-mailed</TabsTrigger>
          </TabsList>
        </Tabs>
        {query.isPending ? (
          <LoadingState rows={3} label="Loading back-in-stock requests" />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {status === 'open' ? 'Nobody is waiting for this product.' : 'No e-mails sent yet.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Asked on</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="break-all">{r.email}</TableCell>
                      <TableCell>{r.variant_label}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                      <TableCell>
                        {r.notified_at ? <Badge variant="success">E-mailed {formatDate(r.notified_at)}</Badge> : <Badge variant="warning">Waiting</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar pagination={query.data.pagination} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
