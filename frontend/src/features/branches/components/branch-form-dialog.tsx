import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useSaveBranchMutation, type Branch } from '@/features/branches/api'
import { handleFormError } from '@/lib/forms'

const schema = z.object({
  code: z.string().trim().min(1, 'Required.').max(20).regex(/^[A-Za-z0-9\-_]+$/, 'Letters, digits, - and _ only.'),
  name: z.string().trim().min(1, 'Required.').max(255),
  email: z.union([z.email('Invalid e-mail.'), z.literal('')]),
  phone: z.string().trim().max(32),
  address: z.string().trim().max(1000),
  timezone: z.string().trim().max(64),
  allow_negative_stock: z.boolean(),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>
const FIELDS = ['code', 'name', 'email', 'phone', 'address', 'timezone', 'allow_negative_stock', 'is_active'] as const

function toValues(branch: Branch | null): Values {
  return {
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    email: branch?.email ?? '',
    phone: branch?.phone ?? '',
    address: branch?.address ?? '',
    timezone: branch?.timezone ?? '',
    allow_negative_stock: branch?.allow_negative_stock ?? false,
    is_active: branch?.is_active ?? true,
  }
}

export function BranchFormDialog({ open, onOpenChange, branch }: { open: boolean; onOpenChange: (open: boolean) => void; branch: Branch | null }) {
  const save = useSaveBranchMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(branch) })
  const { errors } = form.formState
  const [watchedAllowNegativeStock, watchedIsActive] = useWatch({ control: form.control, name: ['allow_negative_stock', 'is_active'] })

  useEffect(() => {
    if (open) form.reset(toValues(branch))
  }, [open, branch, form])

  const onSubmit = form.handleSubmit(({ is_active, ...values }) => {
    const input = {
      ...values,
      email: values.email || null,
      phone: values.phone || null,
      address: values.address || null,
      timezone: values.timezone || null,
      ...(branch ? { is_active } : {}),
    }
    save.mutate(
      { id: branch?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(branch ? `Branch ${saved.name} updated.` : `Branch ${saved.name} created with its main store.`)
          onOpenChange(false)
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS),
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : 'New branch'}</DialogTitle>
          <DialogDescription>{branch ? 'Update branch details and trading rules.' : 'A main store is created automatically.'}</DialogDescription>
        </DialogHeader>
        <form id="branch-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Code" error={errors.code?.message}>
            <Input className="uppercase" {...form.register('code')} />
          </FormField>
          <FormField label="Name" error={errors.name?.message}>
            <Input {...form.register('name')} />
          </FormField>
          <FormField label="E-mail" error={errors.email?.message}>
            <Input type="email" {...form.register('email')} />
          </FormField>
          <FormField label="Phone" error={errors.phone?.message}>
            <Input type="tel" {...form.register('phone')} />
          </FormField>
          <FormField label="Address" error={errors.address?.message} className="sm:col-span-2">
            <Textarea rows={2} {...form.register('address')} />
          </FormField>
          <FormField label="Timezone" error={errors.timezone?.message} hint="Leave empty to use the organization timezone." className="sm:col-span-2">
            <Input placeholder="Asia/Dhaka" {...form.register('timezone')} />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="allow-negative">Allow negative stock</Label>
              <p className="text-xs text-muted-foreground">Permit selling items beyond recorded stock in this branch.</p>
            </div>
            <Switch id="allow-negative" checked={watchedAllowNegativeStock} onCheckedChange={(v) => form.setValue('allow_negative_stock', v)} />
          </div>
          {branch && (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="branch-active">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive branches cannot be selected for work.</p>
              </div>
              <Switch id="branch-active" checked={watchedIsActive} onCheckedChange={(v) => form.setValue('is_active', v)} />
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="branch-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {branch ? 'Save changes' : 'Create branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
