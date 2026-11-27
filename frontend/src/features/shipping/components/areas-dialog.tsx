import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDeleteAreaMutation, useSaveAreaMutation, useShippingAreasQuery, type ShippingArea, type ShippingZone } from '@/features/shipping/api'
import { adjustmentLabel, AREA_FIELDS, AREA_NAME_MAX, areaSchema, sortAreas, toAreaInput, toAreaValues, type AreaValues } from '@/features/shipping/shipping'
import { handleFormError } from '@/lib/forms'

type Props = {
  zone: ShippingZone
  currency: string | undefined
  onClose: () => void
}

/**
 * BD2a: the areas / thanas of one of the zone's districts. Each area changes every method's fee by
 * its amount; a district with active areas asks shoppers to choose one at checkout.
 */
export function AreasDialog({ zone, currency, onClose }: Props) {
  const districts = [...zone.districts].sort((a, b) => a.name.localeCompare(b.name))
  const [districtId, setDistrictId] = useState<number | null>(districts[0]?.id ?? null)
  // undefined = adding a new one, otherwise the area being changed.
  const [editing, setEditing] = useState<ShippingArea | undefined>(undefined)
  const areas = useShippingAreasQuery(districtId)
  const remove = useDeleteAreaMutation()
  const list = sortAreas(areas.data ?? [])
  const districtName = districts.find((d) => d.id === districtId)?.name ?? ''

  const onDelete = (area: ShippingArea) =>
    remove.mutate(area.id, {
      onSuccess: () => {
        toast.success(`${area.name} deleted.`)
        if (editing?.id === area.id) setEditing(undefined)
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Areas in {zone.name}</DialogTitle>
          <DialogDescription>
            Areas or thanas of a district, each with a fee change added to every delivery method. When a district has active areas, customers must choose one.
          </DialogDescription>
        </DialogHeader>
        {districts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add districts to this zone first.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="areas-district">District</Label>
              <Select value={districtId !== null ? String(districtId) : ''} onValueChange={(v) => { setDistrictId(Number(v)); setEditing(undefined) }}>
                <SelectTrigger id="areas-district" className="w-full"><SelectValue placeholder="Choose a district" /></SelectTrigger>
                <SelectContent>
                  {districts.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {areas.isPending ? (
              <LoadingState rows={3} label="Loading areas" />
            ) : areas.error ? (
              <ErrorState error={areas.error} onRetry={() => areas.refetch()} />
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No areas in {districtName} yet: customers there type their area, and the methods’ fees apply as they are.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table aria-label={`Areas in ${districtName}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Area</TableHead>
                      <TableHead>Fee change</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="font-mono text-sm">{adjustmentLabel(a.fee_adjustment, currency)}</TableCell>
                        <TableCell><Badge variant={a.is_active ? 'success' : 'outline'}>{a.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon-sm" aria-label={`Edit area ${a.name}`} onClick={() => setEditing(a)}><PencilIcon /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete area ${a.name}`} disabled={remove.isPending} onClick={() => onDelete(a)}><Trash2Icon /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {districtId !== null && areas.data && (
              <AreaForm
                key={`${districtId}:${editing?.id ?? 'new'}`}
                districtId={districtId}
                districtName={districtName}
                area={editing ?? null}
                nextSortOrder={list.length}
                currency={currency}
                onDone={() => setEditing(undefined)}
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AreaForm({ districtId, districtName, area, nextSortOrder, currency, onDone }: {
  districtId: number
  districtName: string
  area: ShippingArea | null
  nextSortOrder: number
  currency: string | undefined
  onDone: () => void
}) {
  const save = useSaveAreaMutation()
  const form = useForm<AreaValues>({ resolver: zodResolver(areaSchema), defaultValues: toAreaValues(area, nextSortOrder) })
  const { errors } = form.formState
  const isActive = useWatch({ control: form.control, name: 'is_active' })
  const money = currency ? ` (${currency})` : ''

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: area?.id, input: toAreaInput(values, districtId) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          if (area) onDone()
          else form.reset(toAreaValues(null, nextSortOrder + 1))
        },
        onError: (error) => handleFormError(error, form.setError, AREA_FIELDS),
      },
    ),
  )

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-label={area ? `Change ${area.name}` : `New area in ${districtName}`}>
      <p className="text-sm font-medium sm:col-span-3">{area ? `Change ${area.name}` : `New area in ${districtName}`}</p>
      <FormField label="Area name" error={errors.name?.message}>
        <Input maxLength={AREA_NAME_MAX} placeholder="e.g. Mirpur" {...form.register('name')} />
      </FormField>
      <FormField label={`Fee change${money}`} error={errors.fee_adjustment?.message} hint="Use a minus for less, e.g. -10.">
        <Input inputMode="decimal" className="font-mono" {...form.register('fee_adjustment')} />
      </FormField>
      <FormField label="Position" error={errors.sort_order?.message}>
        <Input type="number" min={0} {...form.register('sort_order', { valueAsNumber: true })} />
      </FormField>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Switch id="area-offered" checked={isActive} onCheckedChange={(v) => form.setValue('is_active', v, { shouldDirty: true })} />
        <Label htmlFor="area-offered" className="font-normal">Offered at checkout</Label>
        <span className="flex-1" />
        {area && <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>Cancel</Button>}
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {area ? 'Save area' : 'Add area'}
        </Button>
      </div>
    </form>
  )
}
