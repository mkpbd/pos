import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useBranchesQuery } from '@/features/branches/api'
import { useReplenishmentSettingsQuery, useSaveReplenishmentSettingsMutation, type ReplenishmentSettings } from '@/features/supply-chain/api'
import { handleFormError } from '@/lib/forms'

const NONE = '__none__'

const days = (min: number, max: number) =>
  z.string().trim().regex(/^\d{1,3}$/, `Whole days, ${min}–${max}.`).refine((v) => Number(v) >= min && Number(v) <= max, `Whole days, ${min}–${max}.`)

const schema = z.object({
  source_store_id: z.string(),
  coverage_days: days(1, 180),
  velocity_days: days(7, 180),
  safety_days: days(0, 60),
})
type Values = z.infer<typeof schema>

const toValues = (s: ReplenishmentSettings | undefined): Values => ({
  source_store_id: s?.source_store_id ?? NONE,
  coverage_days: String(s?.coverage_days ?? 14),
  velocity_days: String(s?.velocity_days ?? 30),
  safety_days: String(s?.safety_days ?? 3),
})

function SourceStoreSelect({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const branches = useBranchesQuery({ page: 1, per_page: 100, is_active: true })
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Central store" aria-invalid={invalid || undefined}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No central store (purchase only)</SelectItem>
        {(branches.data?.items ?? []).map((b) => {
          const stores = b.stores.filter((s) => s.is_active || s.id === value)
          return stores.length === 0 ? null : (
            <SelectGroup key={b.id}>
              <SelectLabel>{b.name}</SelectLabel>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-muted-foreground">({s.code})</span></SelectItem>)}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}

/** Organization-wide replenishment settings used by reorder suggestions. */
export function ReplenishmentSettingsCard() {
  const settings = useReplenishmentSettingsQuery()
  const save = useSaveReplenishmentSettingsMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(undefined) })
  const { errors, isDirty } = form.formState

  useEffect(() => {
    if (settings.data) form.reset(toValues(settings.data))
  }, [settings.data, form])

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      {
        source_store_id: v.source_store_id === NONE ? null : v.source_store_id,
        coverage_days: Number(v.coverage_days),
        velocity_days: Number(v.velocity_days),
        safety_days: Number(v.safety_days),
      },
      {
        onSuccess: (saved) => {
          form.reset(toValues(saved))
          toast.success('Replenishment settings saved.')
        },
        onError: (e) => handleFormError(e, form.setError, ['source_store_id', 'coverage_days', 'velocity_days', 'safety_days']),
      },
    ),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Replenishment</CardTitle>
        <CardDescription>How reorder suggestions are calculated. Stores below their reorder point are refilled from the central store first, then from suppliers.</CardDescription>
      </CardHeader>
      {settings.isPending ? (
        <CardContent><LoadingState rows={3} label="Loading replenishment settings" /></CardContent>
      ) : settings.error ? (
        <CardContent><ErrorState error={settings.error} onRetry={() => settings.refetch()} /></CardContent>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Central store" error={errors.source_store_id?.message} hint="Other stores get transfer suggestions from it." className="sm:col-span-2">
              <Controller control={form.control} name="source_store_id" render={({ field }) => <SourceStoreSelect value={field.value} onChange={field.onChange} invalid={!!errors.source_store_id} />} />
            </FormField>
            <FormField label="Coverage (days)" error={errors.coverage_days?.message} hint="Order enough for this many days of sales (1–180).">
              <Input inputMode="numeric" {...form.register('coverage_days')} />
            </FormField>
            <FormField label="Sales history (days)" error={errors.velocity_days?.message} hint="Average daily sales are measured over this period (7–180).">
              <Input inputMode="numeric" {...form.register('velocity_days')} />
            </FormField>
            <FormField label="Safety stock (days)" error={errors.safety_days?.message} hint="Extra days of sales on top of the lead time (0–60).">
              <Input inputMode="numeric" {...form.register('safety_days')} />
            </FormField>
          </CardContent>
          <CardFooter className="justify-end pt-4">
            <Button type="submit" disabled={save.isPending || !isDirty}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              Save settings
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
