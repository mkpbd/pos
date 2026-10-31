import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSaveRoleMutation, type PermissionGroup, type Role } from '@/features/roles/api'
import { handleFormError } from '@/lib/forms'

const schema = z.object({
  name: z.string().trim().min(1, 'Required.').max(100),
  description: z.string().trim().max(255),
  permissions: z.array(z.string()),
})
type Values = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
  catalog: PermissionGroup[]
  /** Built-in roles are shown read-only. */
  readOnly: boolean
}

export function RoleFormDialog({ open, onOpenChange, role, catalog, readOnly }: Props) {
  const save = useSaveRoleMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', description: '', permissions: [] } })
  const { errors } = form.formState
  const selected = useWatch({ control: form.control, name: 'permissions' })

  useEffect(() => {
    if (open) form.reset({ name: role?.name ?? '', description: role?.description ?? '', permissions: role?.permissions ?? [] })
  }, [open, role, form])

  const setPermissions = (names: string[], checked: boolean) => {
    const next = new Set(selected)
    names.forEach((n) => (checked ? next.add(n) : next.delete(n)))
    form.setValue('permissions', [...next].sort())
  }

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id: role?.id, input: { ...values, description: values.description || null } },
      {
        onSuccess: (saved) => {
          toast.success(role ? `Role ${saved.name} updated.` : `Role ${saved.name} created.`)
          onOpenChange(false)
        },
        onError: (error) => handleFormError(error, form.setError, ['name', 'description', 'permissions']),
      },
    ),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? role?.name : role ? `Edit ${role.name}` : 'New role'}</DialogTitle>
          <DialogDescription>
            {readOnly ? 'Built-in role, managed by the system. Create a custom role to grant a different set of permissions.' : 'Grant exactly the permissions this job needs.'}
          </DialogDescription>
        </DialogHeader>
        <form id="role-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" error={errors.name?.message}>
              <Input {...form.register('name')} />
            </FormField>
            <FormField label="Description" error={errors.description?.message}>
              <Textarea rows={1} {...form.register('description')} />
            </FormField>
          </fieldset>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Permissions <span className="font-normal text-muted-foreground">({selected.length} selected)</span></p>
            {errors.permissions?.message && <p className="text-sm text-destructive">{errors.permissions.message}</p>}
            {catalog.map((group) => {
              const names = group.permissions.map((p) => p.name)
              const all = names.every((n) => selected.includes(n))
              const some = !all && names.some((n) => selected.includes(n))

              return (
                <fieldset key={group.module} disabled={readOnly} className="rounded-md border p-3">
                  <legend className="flex items-center gap-2 px-1">
                    <Checkbox
                      id={`group-${group.module}`}
                      checked={all ? true : some ? 'indeterminate' : false}
                      onCheckedChange={(checked) => setPermissions(names, checked === true)}
                      aria-label={`All ${group.module} permissions`}
                    />
                    <Label htmlFor={`group-${group.module}`} className="font-semibold">{group.module}</Label>
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((p) => (
                      <div key={p.name} className="flex items-start gap-2">
                        <Checkbox id={`perm-${p.name}`} checked={selected.includes(p.name)} onCheckedChange={(checked) => setPermissions([p.name], checked === true)} />
                        <Label htmlFor={`perm-${p.name}`} className="flex flex-col items-start gap-0.5 font-normal">
                          <span>{p.description}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p.name}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              )
            })}
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button type="submit" form="role-form" disabled={save.isPending}>
              {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {role ? 'Save changes' : 'Create role'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
