import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSaveMethodMutation, type ShippingMethod, type ShippingZone } from '@/features/shipping/api'
import { METHOD_DESCRIPTION_MAX, METHOD_FIELDS, METHOD_NAME_MAX, methodSchema, toMethodInput, toMethodValues, type MethodValues } from '@/features/shipping/shipping'
import { BanglaTranslations } from '@/features/translations/components/bangla-translations'
import { handleTranslatedFormError, rhfBnErrors } from '@/features/translations/translations'

type Props = {
  zone: ShippingZone
  /** null = new method. Render with a `key` so each opening starts fresh. */
  method: ShippingMethod | null
  currency: string | undefined
  onClose: () => void
}

export function MethodDialog({ zone, method, currency, onClose }: Props) {
  const save = useSaveMethodMutation()
  const form = useForm<MethodValues>({ resolver: zodResolver(methodSchema), defaultValues: toMethodValues(method, zone.methods.length) })
  const { errors } = form.formState
  const [codAllowed, isActive, name, description] = useWatch({ control: form.control, name: ['cod_allowed', 'is_active', 'name', 'description'] })
  const money = currency ? ` (${currency})` : ''

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { zoneId: zone.id, id: method?.id, input: toMethodInput(values, method?.translations) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          onClose()
        },
        onError: (error) => handleTranslatedFormError(error, form.setError, METHOD_FIELDS),
      },
    ),
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{method ? `Edit ${method.name}` : `New delivery method in ${zone.name}`}</DialogTitle>
          <DialogDescription>Fees are added after VAT at checkout.</DialogDescription>
        </DialogHeader>
        <form id="method-form" noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus maxLength={METHOD_NAME_MAX} placeholder="e.g. Home delivery" {...form.register('name')} />
          </FormField>
          <FormField label="Description (optional)" error={errors.description?.message} className="sm:col-span-2">
            <Textarea rows={2} maxLength={METHOD_DESCRIPTION_MAX} {...form.register('description')} />
          </FormField>
          <FormField label={`Delivery fee${money}`} error={errors.fee?.message}>
            <Input inputMode="decimal" className="font-mono" {...form.register('fee')} />
          </FormField>
          <FormField label={`Free over${money}`} error={errors.free_over?.message} hint="Leave empty if never free.">
            <Input inputMode="decimal" className="font-mono" {...form.register('free_over')} />
          </FormField>
          <FormField label="Delivery from (days)" error={errors.eta_min_days?.message}>
            <Input type="number" min={0} max={30} {...form.register('eta_min_days', { valueAsNumber: true })} />
          </FormField>
          <FormField label="Delivery to (days)" error={errors.eta_max_days?.message}>
            <Input type="number" min={0} max={30} {...form.register('eta_max_days', { valueAsNumber: true })} />
          </FormField>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="method-cod" checked={codAllowed} onCheckedChange={(v) => form.setValue('cod_allowed', v, { shouldDirty: true })} />
            <Label htmlFor="method-cod" className="font-normal">Cash on delivery allowed</Label>
          </div>
          {codAllowed && (
            <FormField label={`COD fee${money}`} error={errors.cod_fee?.message}>
              <Input inputMode="decimal" className="font-mono" {...form.register('cod_fee')} />
            </FormField>
          )}
          <FormField label="Sort order" error={errors.sort_order?.message}>
            <Input type="number" min={0} {...form.register('sort_order', { valueAsNumber: true })} />
          </FormField>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="method-active" checked={isActive} onCheckedChange={(v) => form.setValue('is_active', v, { shouldDirty: true })} />
            <Label htmlFor="method-active" className="font-normal">Active</Label>
          </div>
          <Controller control={form.control} name="translations.bn" render={({ field }) => (
            <BanglaTranslations
              className="sm:col-span-2"
              fields={[
                { name: 'name', label: 'Name', base: name, max: METHOD_NAME_MAX },
                { name: 'description', label: 'Description', base: description, kind: 'textarea', max: METHOD_DESCRIPTION_MAX },
              ]}
              value={field.value}
              onChange={field.onChange}
              errors={rhfBnErrors(errors.translations)}
            />
          )} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="method-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {method ? 'Save method' : 'Add method'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
