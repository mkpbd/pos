import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useSupplierQuery, type Supplier } from '@/features/suppliers/api'
import { SUPPLY_PERMISSIONS } from '@/features/supply-chain/api'
import { SupplierCatalog } from '@/features/supply-chain/components/supplier-catalog'
import { SupplierPerformanceTab } from '@/features/supplier-performance/components/supplier-performance-tab'

const SECONDARY_TABS = ['performance', 'details'] as const

function Details({ supplier }: { supplier: Supplier }) {
  const rows: [string, string | null][] = [
    ['Contact person', supplier.contact_person],
    ['Phone', supplier.phone],
    ['E-mail', supplier.email],
    ['Tax / BIN number', supplier.tax_number],
    ['Payment terms', supplier.payment_terms_days ? `${supplier.payment_terms_days} days` : 'Cash'],
    ['Address', supplier.address],
    ['Notes', supplier.notes],
  ]
  return (
    <Card>
      <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-muted-foreground">{label}</div>
            <div className="font-medium whitespace-pre-line">{value || '—'}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** One supplier: contact details and (with purchasing access) the catalog of what it sells and its performance. */
export function SupplierPage() {
  const { supplierId } = useParams()
  const can = useCan()
  const me = useAuth()
  const [params, setParams] = useSearchParams()
  const { data, error, isPending, refetch } = useSupplierQuery(supplierId)
  const canCatalog = can(SUPPLY_PERMISSIONS.viewPurchasing)
  const requested = params.get('tab')
  const tab = !canCatalog ? 'details' : (SECONDARY_TABS as readonly string[]).includes(requested ?? '') ? (requested as string) : 'catalog'

  if (isPending) return <LoadingState rows={6} label="Loading supplier" />
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to suppliers"><Link to="/suppliers"><ArrowLeftIcon /></Link></Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.name}</h1>
        <span className="font-mono text-sm text-muted-foreground">{data.code}</span>
        {data.archived_at ? <Badge variant="outline">Archived</Badge> : !data.is_active && <Badge variant="outline">Inactive</Badge>}
      </div>
      {canCatalog ? (
        <Tabs value={tab} onValueChange={(v) => setParams(v === 'catalog' ? {} : { tab: v }, { replace: true })}>
          <TabsList>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="catalog" className="pt-4">
            <SupplierCatalog supplierId={data.id} supplierName={data.name} currency={me.organization?.base_currency} />
          </TabsContent>
          <TabsContent value="performance" className="pt-4">
            {tab === 'performance' && <SupplierPerformanceTab supplierId={data.id} />}
          </TabsContent>
          <TabsContent value="details" className="pt-4">
            <Details supplier={data} />
          </TabsContent>
        </Tabs>
      ) : (
        <Details supplier={data} />
      )}
    </div>
  )
}
