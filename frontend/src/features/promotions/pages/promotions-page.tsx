import { useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, SearchIcon, TimerIcon } from 'lucide-react'
import { ExportMenu } from '@/components/common/export-menu'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { PROMOTION_STATES, usePromotionsQuery, type PromotionRow, type PromotionState, type PromotionTrigger } from '@/features/promotions/api'
import { APPLICATION_RULE, offerLabel, SCOPE_LABELS, STATE_BADGES, stateBadge, TRIGGER_LABELS } from '@/features/promotions/promotions'
import { formatDateTime } from '@/features/web-orders/orders'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

function schedule(p: PromotionRow, timeZone: string | undefined): string {
  if (!p.starts_at && !p.ends_at) return 'No end date'
  if (!p.starts_at) return `Until ${formatDateTime(p.ends_at, timeZone)}`
  if (!p.ends_at) return `From ${formatDateTime(p.starts_at, timeZone)}`
  return `${formatDateTime(p.starts_at, timeZone)} – ${formatDateTime(p.ends_at, timeZone)}`
}

export function PromotionsPage() {
  const me = useAuth()
  const can = useCan()
  const timeZone = me.organization?.timezone
  const currency = me.organization?.base_currency
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PromotionState | typeof ALL>(ALL)
  const [trigger, setTrigger] = useState<PromotionTrigger | typeof ALL>(ALL)
  const term = useDebouncedValue(search.trim(), 300)
  const filters = { search: term || undefined, status: status === ALL ? undefined : status, trigger: trigger === ALL ? undefined : trigger }
  const promotions = usePromotionsQuery({ page, ...filters })
  const filtered = !!term || status !== ALL || trigger !== ALL

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promotions"
        description="Discounts, coupon codes, free shipping and flash sales for the online store."
        actions={
          <>
            <ExportMenu list="promotions" query={filters} disabled={!promotions.data?.items.length} />
            {can('promotions.manage') && (
              <Button asChild>
                <Link to="/promotions/new"><PlusIcon data-icon="inline-start" /> New promotion</Link>
              </Button>
            )}
          </>
        }
      />
      <p className="-mt-3 text-sm text-muted-foreground">{APPLICATION_RULE} Promotions apply to web orders only.</p>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search by name or code"
                aria-label="Search promotions"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as PromotionState | typeof ALL)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Filter by status" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {PROMOTION_STATES.map((s) => <SelectItem key={s} value={s}>{STATE_BADGES[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={trigger}
              onValueChange={(v) => {
                setTrigger(v as PromotionTrigger | typeof ALL)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Filter by trigger" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Automatic and coupons</SelectItem>
                <SelectItem value="automatic">Automatic</SelectItem>
                <SelectItem value="coupon">Coupon codes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {promotions.isPending ? (
            <LoadingState label="Loading promotions" />
          ) : promotions.error ? (
            <ErrorState error={promotions.error} onRetry={() => promotions.refetch()} />
          ) : promotions.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? 'No matching promotions' : 'No promotions yet'}
              description={filtered ? undefined : 'Create a discount on products, categories or brands, an order discount, free shipping or a coupon code.'}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Promotion</TableHead>
                      <TableHead>Offer</TableHead>
                      <TableHead className="hidden md:table-cell">Trigger</TableHead>
                      <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Used</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {promotions.data.items.map((p) => {
                      const badge = stateBadge(p.state)
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            <Link to={`/promotions/${p.id}`} className="hover:underline">{p.name}</Link>
                            {p.show_countdown && (
                              <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><TimerIcon className="size-3" aria-hidden /> Flash sale</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {offerLabel(p.type, p.value, currency)}
                            <div className="text-xs text-muted-foreground">{SCOPE_LABELS[p.scope] ?? p.scope}</div>
                          </TableCell>
                          <TableCell className="hidden text-sm md:table-cell">
                            {TRIGGER_LABELS[p.trigger] ?? p.trigger}
                            {p.trigger === 'coupon' && <div className="text-xs text-muted-foreground">{p.coupon_count} {p.coupon_count === 1 ? 'code' : 'codes'}</div>}
                          </TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">{schedule(p, timeZone)}</TableCell>
                          <TableCell className="hidden text-right text-sm sm:table-cell">
                            {p.redemption_count} {p.redemption_count === 1 ? 'order' : 'orders'}
                            <div className="font-mono text-xs text-muted-foreground">{formatMoney(p.discount_total, currency)}</div>
                          </TableCell>
                          <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <PaginationBar pagination={promotions.data.pagination} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
