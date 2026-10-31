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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { passwordRule } from '@/features/auth/schemas'
import type { BranchSummary } from '@/features/auth/types'
import type { Role } from '@/features/roles/api'
import { useSaveUserMutation, type ManagedUser } from '@/features/users/api'
import { handleFormError } from '@/lib/forms'

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Required.').max(255),
  email: z.email('Enter a valid e-mail address.'),
  phone: z.string().trim().max(32),
  status: z.enum(['active', 'inactive']),
  role_ids: z.array(z.string()).min(1, 'Assign at least one role.'),
  branch_ids: z.array(z.string()),
})
const createSchema = baseSchema.extend({ password: passwordRule })
const editSchema = baseSchema.extend({ password: z.union([passwordRule, z.literal('')]) })
type Values = z.infer<typeof editSchema>
const FIELDS = ['name', 'email', 'phone', 'status', 'role_ids', 'branch_ids', 'password'] as const

function toValues(user: ManagedUser | null): Values {
  return {
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    status: user?.status ?? 'active',
    role_ids: user?.roles.map((r) => r.id) ?? [],
    branch_ids: user?.branch_ids ?? [],
    password: '',
  }
}

function toggle(list: string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...list, id])] : list.filter((x) => x !== id)
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: ManagedUser | null
  roles: Role[]
  branches: BranchSummary[]
  /** The signed-in user cannot change their own roles or status. */
  isSelf: boolean
}

export function UserFormDialog({ open, onOpenChange, user, roles, branches, isSelf }: Props) {
  const save = useSaveUserMutation()
  const form = useForm<Values>({ resolver: zodResolver(user ? editSchema : createSchema), defaultValues: toValues(user) })
  const { errors } = form.formState
  const [roleIds, branchIds, status] = useWatch({ control: form.control, name: ['role_ids', 'branch_ids', 'status'] })

  useEffect(() => {
    if (open) form.reset(toValues(user))
  }, [open, user, form])

  const onSubmit = form.handleSubmit(({ password, phone, ...values }) => {
    const input = {
      ...values,
      phone: phone || null,
      ...(password ? { password } : {}),
    }
    if (isSelf) {
      delete (input as Partial<typeof input>).status
      delete (input as Partial<typeof input>).role_ids
    }
    save.mutate(
      { id: user?.id, input },
      {
        onSuccess: (saved) => {
          toast.success(user ? `${saved.name} updated.` : `${saved.name} can now sign in.`)
          onOpenChange(false)
        },
        onError: (error) => handleFormError(error, form.setError, FIELDS),
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : 'New user'}</DialogTitle>
          <DialogDescription>
            {user ? 'Changing the password or deactivating signs the user out everywhere.' : 'The user signs in with this e-mail and password.'}
          </DialogDescription>
        </DialogHeader>
        <form id="user-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" error={errors.name?.message}>
            <Input autoComplete="off" {...form.register('name')} />
          </FormField>
          <FormField label="E-mail" error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...form.register('email')} />
          </FormField>
          <FormField label="Phone" error={errors.phone?.message}>
            <Input type="tel" {...form.register('phone')} />
          </FormField>
          <FormField label={user ? 'New password' : 'Password'} error={errors.password?.message} hint={user ? 'Leave empty to keep the current password.' : undefined}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <FormField label="Status" error={errors.status?.message} hint={isSelf ? 'You cannot change your own status.' : undefined}>
            <Select value={status} onValueChange={(v) => form.setValue('status', v as Values['status'])} disabled={isSelf}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <fieldset className="flex flex-col gap-2 sm:col-span-2" disabled={isSelf}>
            <legend className="mb-1 text-sm font-medium">Roles {isSelf && <span className="font-normal text-muted-foreground">(you cannot change your own roles)</span>}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <div key={role.id} className="flex items-start gap-2 rounded-md border p-2">
                  <Checkbox
                    id={`role-${role.id}`}
                    checked={roleIds.includes(role.id)}
                    onCheckedChange={(checked) => form.setValue('role_ids', toggle(roleIds, role.id, checked === true), { shouldValidate: form.formState.isSubmitted })}
                  />
                  <Label htmlFor={`role-${role.id}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="font-medium">{role.name}</span>
                    {role.description && <span className="text-xs text-muted-foreground">{role.description}</span>}
                  </Label>
                </div>
              ))}
            </div>
            {errors.role_ids?.message && <p className="text-sm text-destructive">{errors.role_ids.message}</p>}
          </fieldset>

          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Branches</legend>
            <p className="text-xs text-muted-foreground">Roles with “work in every branch” access ignore this list.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.map((branch) => (
                <div key={branch.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`branch-${branch.id}`}
                    checked={branchIds.includes(branch.id)}
                    onCheckedChange={(checked) => form.setValue('branch_ids', toggle(branchIds, branch.id, checked === true))}
                  />
                  <Label htmlFor={`branch-${branch.id}`} className="font-normal">
                    {branch.name} <span className="text-muted-foreground">({branch.code})</span>
                  </Label>
                </div>
              ))}
            </div>
            {errors.branch_ids?.message && <p className="text-sm text-destructive">{errors.branch_ids.message}</p>}
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="user-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
