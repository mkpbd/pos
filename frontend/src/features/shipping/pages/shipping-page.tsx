import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '@/features/auth/use-auth'
import { useDeleteMethodMutation, useDeleteZoneMutation, useShippingZonesQuery, type ShippingMethod, type ShippingZone } from '@/features/shipping/api'
import { MethodDialog } from '@/features/shipping/components/method-dialog'
import { ShippingTabs } from '@/features/shipping/components/shipping-tabs'
import { ZoneDialog } from '@/features/shipping/components/zone-dialog'
import { feeSummary } from '@/features/shipping/shipping'
import { etaLabel } from '@/features/web-orders/orders'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { formatMoney } from '@/lib/money'

const MAX_LISTED_DISTRICTS = 8

function districtSummary(zone: ShippingZone): string {
  if (zone.districts.length === 0) return 'No districts yet — customers cannot choose this zone.'
  const names = zone.districts.map((d) => d.name).sort((a, b) => a.localeCompare(b))
  const shown = names.slice(0, MAX_LISTED_DISTRICTS).join(', ')
  return names.length > MAX_LISTED_DISTRICTS ? `${shown} and ${names.length - MAX_LISTED_DISTRICTS} more` : shown
}

type Deleting = { kind: 'zone'; zone: ShippingZone } | { kind: 'method'; method: ShippingMethod }

function ZoneCard({ zone, currency, onEdit, onAddMethod, onEditMethod, onDelete }: {
  zone: ShippingZone
  currency: string | undefined
  onEdit: () => void
  onAddMethod: () => void
  onEditMethod: (m: ShippingMethod) => void
  onDelete: (d: Deleting) => void
}) {
  const methods = [...zone.methods].sort((a, b) => a.sort_order - b.sort_order)
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            {zone.name}
            <Badge variant={zone.is_active ? 'success' : 'outline'}>{zone.is_active ? 'Active' : 'Inactive'}</Badge>
          </CardTitle>
          <CardDescription>
            <span className="font-medium">{zone.districts.length} {zone.districts.length === 1 ? 'district' : 'districts'}</span>
            {zone.districts.length > 0 && ': '}
            {districtSummary(zone)}
          </CardDescription>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={onEdit}><PencilIcon data-icon="inline-start" /> Edit zone</Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${zone.name}`} onClick={() => onDelete({ kind: 'zone', zone })}><Trash2Icon /></Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No delivery methods yet. Add one so customers in this zone can check out.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label={`Delivery methods in ${zone.name}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead className="hidden sm:table-cell">Cash on delivery</TableHead>
                  <TableHead className="hidden md:table-cell">Delivery time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {methods.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      {m.description && <div className="text-xs text-muted-foreground">{m.description}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{feeSummary(m, currency)}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{m.cod_allowed ? (/^0+(\.0+)?$/.test(m.cod_fee) ? 'Yes' : `Yes, fee ${formatMoney(m.cod_fee)}`) : 'No'}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{etaLabel(m.eta_min_days, m.eta_max_days)}</TableCell>
                    <TableCell><Badge variant={m.is_active ? 'success' : 'outline'}>{m.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.name}`} onClick={() => onEditMethod(m)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${m.name}`} onClick={() => onDelete({ kind: 'method', method: m })}><Trash2Icon /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Button variant="outline" size="sm" className="self-start" onClick={onAddMethod}><PlusIcon data-icon="inline-start" /> Add method</Button>
      </CardContent>
    </Card>
  )
}

export function ShippingPage() {
  const me = useAuth()
  const currency = me.organization?.base_currency
  const zones = useShippingZonesQuery()
  const deleteZone = useDeleteZoneMutation()
  const deleteMethod = useDeleteMethodMutation()
  // undefined = closed, null = new.
  const [editingZone, setEditingZone] = useState<ShippingZone | null | undefined>(undefined)
  const [editingMethod, setEditingMethod] = useState<{ zone: ShippingZone; method: ShippingMethod | null } | null>(null)
  const [deleting, setDeleting] = useState<Deleting | null>(null)

  const list = [...(zones.data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const deletingName = deleting ? (deleting.kind === 'zone' ? deleting.zone.name : deleting.method.name) : ''

  const confirmDelete = () => {
    if (!deleting) return
    const done = { onSuccess: () => toast.success(`${deletingName} deleted.`), onError: (e: Error) => toast.error(e.message), onSettled: () => setDeleting(null) }
    if (deleting.kind === 'zone') deleteZone.mutate(deleting.zone.id, done)
    else deleteMethod.mutate(deleting.method.id, done)
  }

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <ShippingTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Group districts into zones and give each zone its delivery methods. Customers in a district without an active zone and method cannot check out.
        </p>
        <Button onClick={() => setEditingZone(null)}><PlusIcon data-icon="inline-start" /> New zone</Button>
      </div>

      {zones.isPending ? (
        <LoadingState rows={4} label="Loading shipping zones" />
      ) : zones.error ? (
        <ErrorState error={zones.error} onRetry={() => zones.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title="No shipping zones yet" description="Create a zone such as “Inside Dhaka” and add a delivery method to it." />
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((zone) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              currency={currency}
              onEdit={() => setEditingZone(zone)}
              onAddMethod={() => setEditingMethod({ zone, method: null })}
              onEditMethod={(method) => setEditingMethod({ zone, method })}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {editingZone !== undefined && <ZoneDialog key={editingZone?.id ?? 'new'} zone={editingZone} zones={list} onClose={() => setEditingZone(undefined)} />}
      {editingMethod && (
        <MethodDialog
          key={`${editingMethod.zone.id}:${editingMethod.method?.id ?? 'new'}`}
          zone={editingMethod.zone}
          method={editingMethod.method}
          currency={currency}
          onClose={() => setEditingMethod(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deletingName}?`}
        description={
          deleting?.kind === 'zone'
            ? 'Its delivery methods are deleted too, and its districts can no longer check out until another zone covers them. Past orders keep their delivery details.'
            : 'Customers can no longer choose it. Past orders keep their delivery details.'
        }
        confirmLabel="Delete"
        pending={deleteZone.isPending || deleteMethod.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
