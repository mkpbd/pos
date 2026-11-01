import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSaveCourierMutation, type Courier } from '@/features/shipping/api'
import { COURIER_FIELDS, courierSchema, toCourierInput, toCourierValues, trackingUrl, type CourierValues } from '@/features/shipping/shipping'
import { handleFormError } from '@/lib/forms'

type Props = {
  /** null = new courier. Render with a `key` so each opening starts fresh. */
  courier: Courier | null
  nextSortOrder: number
  onClose: () => void
}

export function CourierDialog({ courier, nextSortOrder, onClose }: Props) {
  const save = useSaveCourierMutation()
  const form = useForm<CourierValues>({ resolver: zodResolver(courierSchema), defaultValues: toCourierValues(courier, nextSortOrder) })
  const { errors } = form.formState
  const [isActive, template] = useWatch({ control: form.control, name: ['is_active', 'tracking_url_template'] })
  const example = courierSchema.shape.tracking_url_template.safeParse(template).success ? trackingUrl(template.trim(), 'ABC123') : null

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: courier?.id, input: toCourierInput(values) },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`)
          onClose()
        },
        onError: (error) => handleFormError(error, form.setError, COURIER_FIELDS),
      },
    ),
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{courier ? `Edit ${courier.name}` : 'New courier'}</DialogTitle>
          <DialogDescription>Couriers are offered when an order is shipped. Customers see the name and, with a tracking link, can follow their parcel.</DialogDescription>
        </DialogHeader>
        <form id="courier-form" noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors.name?.message} className="sm:col-span-2">
            <Input autoFocus maxLength={80} placeholder="e.g. Pathao" {...form.register('name')} />
          </FormField>
          <FormField label="Phone (optional)" error={errors.phone?.message}>
            <Input type="tel" maxLength={20} {...form.register('phone')} />
          </FormField>
          <FormField label="Sort order" error={errors.sort_order?.message}>
            <Input type="number" min={0} {...form.register('sort_order', { valueAsNumber: true })} />
          </FormField>
          <FormField
            label="Tracking link (optional)"
            error={errors.tracking_url_template?.message}
            className="sm:col-span-2"
            hint={example ? <>Example: <span className="break-all">{example}</span></> : <>Put <code>{'{tracking}'}</code> where the tracking number goes.</>}
          >
            <Input type="url" maxLength={500} placeholder="https://courier.example/track?id={tracking}" {...form.register('tracking_url_template')} />
          </FormField>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="courier-active" checked={isActive} onCheckedChange={(v) => form.setValue('is_active', v, { shouldDirty: true })} />
            <Label htmlFor="courier-active" className="font-normal">Active — offered when shipping orders</Label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="courier-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {courier ? 'Save courier' : 'Add courier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
