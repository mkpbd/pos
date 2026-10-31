import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PencilIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useSaveStoreMutation, type Branch, type Store } from '@/features/branches/api'
import { handleFormError } from '@/lib/forms'

const schema = z.object({
  code: z.string().trim().min(1, 'Required.').max(20).regex(/^[A-Za-z0-9\-_]+$/, 'Letters, digits, - and _ only.'),
  name: z.string().trim().min(1, 'Required.').max(255),
  type: z.enum(['store', 'warehouse']),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>

function StoreForm({ branchId, store, onDone }: { branchId: string; store: Store | null; onDone: () => void }) {
  const save = useSaveStoreMutation(branchId)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: store?.code ?? '', name: store?.name ?? '', type: store?.type ?? 'store', is_active: store?.is_active ?? true },
  })
  const { errors } = form.formState
  const [watchedType, watchedIsActive] = useWatch({ control: form.control, name: ['type', 'is_active'] })

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: store?.id, input: values },
      {
        onSuccess: (saved) => {
          toast.success(store ? `${saved.name} updated.` : `${saved.name} added.`)
          onDone()
        },
        onError: (error) => handleFormError(error, form.setError, ['code', 'name', 'type', 'is_active']),
      },
    ),
  )

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Code" error={errors.code?.message}>
          <Input className="uppercase" {...form.register('code')} />
        </FormField>
        <FormField label="Type" error={errors.type?.message}>
          <Select value={watchedType} onValueChange={(v) => form.setValue('type', v as Values['type'])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="store">Sales floor</SelectItem>
              <SelectItem value="warehouse">Warehouse</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <FormField label="Name" error={errors.name?.message}>
        <Input {...form.register('name')} />
      </FormField>
      {store && (
        <div className="flex items-center gap-2">
          <Switch id={`store-active-${store.id}`} checked={watchedIsActive} onCheckedChange={(v) => form.setValue('is_active', v)} />
          <Label htmlFor={`store-active-${store.id}`}>Active</Label>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          {store ? 'Save' : 'Add store'}
        </Button>
      </div>
    </form>
  )
}

export function StoresSheet({ branch, canManage, onOpenChange }: { branch: Branch | null; canManage: boolean; onOpenChange: (open: boolean) => void }) {
  const [editing, setEditing] = useState<Store | 'new' | null>(null)

  return (
    <Sheet
      open={branch !== null}
      onOpenChange={(open) => {
        if (!open) setEditing(null)
        onOpenChange(open)
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Stores of {branch?.name}</SheetTitle>
          <SheetDescription>Stock locations of this branch: sales floors and warehouses.</SheetDescription>
        </SheetHeader>
        {branch && (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {canManage && editing === null && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing('new')}>
                <PlusIcon data-icon="inline-start" /> Add store
              </Button>
            )}
            {editing === 'new' && <StoreForm branchId={branch.id} store={null} onDone={() => setEditing(null)} />}
            <ul className="flex flex-col gap-2">
              {branch.stores.map((store) =>
                editing !== 'new' && editing?.id === store.id ? (
                  <li key={store.id}>
                    <StoreForm branchId={branch.id} store={store} onDone={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={store.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{store.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{store.code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{store.type === 'warehouse' ? 'Warehouse' : 'Sales floor'}</Badge>
                      {!store.is_active && <Badge variant="secondary">Inactive</Badge>}
                      {canManage && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${store.name}`} onClick={() => setEditing(store)}>
                          <PencilIcon />
                        </Button>
                      )}
                    </div>
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
