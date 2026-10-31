import { useMemo, useState, type FormEvent } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDistrictsQuery, useDivisionsQuery, useSaveZoneMutation, type ShippingZone } from '@/features/shipping/api'
import { districtOwners, groupDistricts, toggleDivision, zoneSaveError } from '@/features/shipping/shipping'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'

type Props = {
  /** null = new zone. Render with a `key` per zone so each opening starts fresh. */
  zone: ShippingZone | null
  zones: ShippingZone[]
  onClose: () => void
}

/** Zone name, status and its districts, picked per division; districts another zone covers are locked. */
export function ZoneDialog({ zone, zones, onClose }: Props) {
  const save = useSaveZoneMutation()
  const divisions = useDivisionsQuery()
  const districts = useDistrictsQuery()
  const [name, setName] = useState(zone?.name ?? '')
  const [active, setActive] = useState(zone?.is_active ?? true)
  const [sortOrder, setSortOrder] = useState(String(zone?.sort_order ?? zones.length))
  const [selected, setSelected] = useState<number[]>(zone?.districts.map((d) => d.id) ?? [])
  const [find, setFind] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const owners = useMemo(() => districtOwners(zones, zone?.id), [zones, zone?.id])
  const groups = useMemo(() => groupDistricts(divisions.data ?? [], districts.data ?? []), [divisions.data, districts.data])
  const term = find.trim().toLowerCase()
  const visibleGroups = term
    ? groups.map((g) => ({ ...g, districts: g.districts.filter((d) => d.name.toLowerCase().includes(term) || g.division.name.toLowerCase().includes(term)) })).filter((g) => g.districts.length > 0)
    : groups

  const toggle = (id: number, on: boolean) => setSelected((s) => (on ? [...s.filter((x) => x !== id), id] : s.filter((x) => x !== id)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const order = Number(sortOrder)
    if (!name.trim() || !Number.isInteger(order) || order < 0) return
    setErrors({})
    const input = { name: name.trim(), is_active: active, sort_order: order, district_ids: [...selected].sort((a, b) => a - b) }
    save.mutate(
      { id: zone?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'DISTRICT_IN_OTHER_ZONE') setErrors({ district_ids: zoneSaveError(error, districts.data ?? []) })
          else setErrors(fieldErrorMap(error))
        },
      },
    )
  }

  const sortInvalid = !/^\d{1,4}$/.test(sortOrder)
  const districtError = errors.district_ids ?? Object.entries(errors).find(([k]) => k.startsWith('district_ids.'))?.[1]

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{zone ? `Edit ${zone.name}` : 'New shipping zone'}</DialogTitle>
          <DialogDescription>Customers in the chosen districts see this zone's delivery methods at checkout. A district belongs to one zone only.</DialogDescription>
        </DialogHeader>
        <form id="zone-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label="Zone name" error={errors.name}>
              <Input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inside Dhaka" />
            </FormField>
            <FormField label="Sort order" error={errors.sort_order ?? (sortInvalid ? 'A whole number.' : undefined)}>
              <Input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </FormField>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="zone-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="zone-active" className="font-normal">Active</Label>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
              <span>Districts <span className="font-normal text-muted-foreground">({selected.length} selected)</span></span>
            </legend>
            <Input aria-label="Find a district" placeholder="Find a district or division" value={find} onChange={(e) => setFind(e.target.value)} />
            {divisions.isPending || districts.isPending ? (
              <LoadingState rows={3} label="Loading districts" />
            ) : divisions.error || districts.error ? (
              <ErrorState error={divisions.error ?? districts.error} onRetry={() => void Promise.all([divisions.refetch(), districts.refetch()])} />
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-md border p-3" role="group" aria-label="Districts">
                {visibleGroups.length === 0 && <p className="text-sm text-muted-foreground">No district matches.</p>}
                {visibleGroups.map((g) => {
                  const free = g.districts.filter((d) => !owners.has(d.id))
                  const chosen = free.filter((d) => selected.includes(d.id)).length
                  const groupState = chosen === 0 ? false : chosen === free.length ? true : 'indeterminate'
                  return (
                    <div key={g.division.id} className="mb-3 last:mb-0">
                      <div className="mb-1 flex items-center gap-2 border-b pb-1">
                        <Checkbox
                          id={`division-${g.division.id}`}
                          aria-label={`All of ${g.division.name} division`}
                          checked={groupState}
                          disabled={free.length === 0}
                          onCheckedChange={(v) => setSelected((s) => toggleDivision(s, g, owners, v === true))}
                        />
                        <Label htmlFor={`division-${g.division.id}`} className="text-sm font-semibold">{g.division.name}</Label>
                      </div>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 md:grid-cols-3">
                        {g.districts.map((d) => {
                          const owner = owners.get(d.id)
                          const id = `district-${d.id}`
                          return (
                            <div key={d.id} className="flex items-start gap-2 py-0.5">
                              <Checkbox
                                id={id}
                                aria-label={d.name}
                                aria-describedby={owner ? `${id}-owner` : undefined}
                                className="mt-0.5"
                                checked={selected.includes(d.id)}
                                disabled={!!owner}
                                onCheckedChange={(v) => toggle(d.id, v === true)}
                              />
                              <Label htmlFor={id} className={owner ? 'flex flex-col items-start gap-0 font-normal text-muted-foreground' : 'font-normal'}>
                                {d.name}
                                {owner && <span id={`${id}-owner`} className="text-xs">in {owner}</span>}
                              </Label>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {districtError && <p role="alert" className="text-sm text-destructive">{districtError}</p>}
          </fieldset>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="zone-form" disabled={save.isPending || !name.trim() || sortInvalid}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {zone ? 'Save zone' : 'Create zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
