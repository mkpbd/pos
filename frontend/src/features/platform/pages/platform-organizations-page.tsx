import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PlusIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { passwordRule } from '@/features/auth/schemas'
import type { Organization } from '@/features/organization/api'
import { usePlatformOrganizationsQuery, useProvisionOrganizationMutation, useSetOrganizationStatusMutation } from '@/features/platform/api'
import { handleFormError } from '@/lib/forms'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const schema = z
  .object({
    organization_name: z.string().trim().min(2, 'Required.').max(255),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Three-letter ISO code, e.g. BDT.'),
    name: z.string().trim().min(2, 'Required.').max(255),
    email: z.email('Enter a valid e-mail address.'),
    password: passwordRule,
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, { path: ['password_confirmation'], message: 'Passwords do not match.' })
type Values = z.infer<typeof schema>

function ProvisionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const provision = useProvisionOrganizationMutation()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { organization_name: '', currency: 'BDT', name: '', email: '', password: '', password_confirmation: '' },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit((values) =>
    provision.mutate(
      { ...values, currency: values.currency.toUpperCase() },
      {
        onSuccess: (org) => {
          toast.success(`${org.name} provisioned.`)
          form.reset()
          onOpenChange(false)
        },
        onError: (error) => handleFormError(error, form.setError, ['organization_name', 'currency', 'name', 'email', 'password', 'password_confirmation']),
      },
    ),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>Creates the organization, its main branch, built-in roles and the first administrator.</DialogDescription>
        </DialogHeader>
        <form id="provision-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <FormField label="Organization name" error={errors.organization_name?.message}><Input {...form.register('organization_name')} /></FormField>
          <FormField label="Base currency" error={errors.currency?.message}><Input className="uppercase" maxLength={3} {...form.register('currency')} /></FormField>
          <FormField label="Admin name" error={errors.name?.message}><Input {...form.register('name')} /></FormField>
          <FormField label="Admin e-mail" error={errors.email?.message}><Input type="email" {...form.register('email')} /></FormField>
          <FormField label="Password" error={errors.password?.message}><Input type="password" autoComplete="new-password" {...form.register('password')} /></FormField>
          <FormField label="Confirm password" error={errors.password_confirmation?.message}><Input type="password" autoComplete="new-password" {...form.register('password_confirmation')} /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="provision-form" disabled={provision.isPending}>
            {provision.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PlatformOrganizationsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [toggling, setToggling] = useState<Organization | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const setStatus = useSetOrganizationStatusMutation()
  const { data, error, isPending, refetch } = usePlatformOrganizationsQuery({ page, search: debouncedSearch || undefined })

  const confirmToggle = () => {
    if (!toggling) return
    const status = toggling.status === 'active' ? 'suspended' : 'active'
    setStatus.mutate(
      { id: toggling.id, status },
      {
        onSuccess: (org) => toast.success(`${org.name} is now ${org.status}.`),
        onError: (e) => toast.error(e.message),
        onSettled: () => setToggling(null),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All organizations"
        description="Platform administration of every tenant."
        actions={<Button onClick={() => setCreating(true)}><PlusIcon data-icon="inline-start" /> New organization</Button>}
      />
      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search organizations" placeholder="Search by name" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>

      {isPending ? (
        <LoadingState rows={4} label="Loading organizations" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No organizations found" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="hidden md:table-cell">Timezone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div className="font-medium">{org.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{org.slug}</div>
                    </TableCell>
                    <TableCell>{org.base_currency}</TableCell>
                    <TableCell className="hidden md:table-cell">{org.timezone}</TableCell>
                    <TableCell>
                      <Badge variant={org.status === 'active' ? 'success' : 'destructive'}>{org.status === 'active' ? 'Active' : 'Suspended'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setToggling(org)}>
                        {org.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      <ProvisionDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog open={toggling !== null} onOpenChange={(open) => !open && setToggling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toggling?.status === 'active' ? `Suspend ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {toggling?.status === 'active'
                ? 'All users of this organization are blocked immediately, including signed-in sessions and devices.'
                : 'Users of this organization can sign in again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={toggling?.status === 'active' ? 'destructive' : 'default'} onClick={confirmToggle} disabled={setStatus.isPending}>
              {toggling?.status === 'active' ? 'Suspend' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
