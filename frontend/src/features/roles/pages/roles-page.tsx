import { useState } from 'react'
import { EyeIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingState } from '@/components/common/state-views'
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
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCan } from '@/features/auth/use-auth'
import { useDeleteRoleMutation, usePermissionCatalogQuery, useRolesQuery, type Role } from '@/features/roles/api'
import { RoleFormDialog } from '@/features/roles/components/role-form-dialog'

export function RolesPage() {
  const can = useCan()
  const canManage = can('roles.manage')
  const roles = useRolesQuery()
  const catalog = usePermissionCatalogQuery()
  const deleteRole = useDeleteRoleMutation()
  const [editing, setEditing] = useState<Role | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Role | null>(null)

  const error = roles.error ?? catalog.error
  const loading = roles.isPending || catalog.isPending

  const confirmDelete = () => {
    if (!deleting) return
    deleteRole.mutate(deleting.id, {
      onSuccess: () => toast.success(`Role ${deleting.name} deleted.`),
      onError: (e) => toast.error(e.message),
      onSettled: () => setDeleting(null),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles & permissions"
        description="Built-in roles cover common jobs; create custom roles for anything else."
        actions={
          canManage && (
            <Button onClick={() => setEditing(null)} disabled={!catalog.data}>
              <PlusIcon data-icon="inline-start" /> New role
            </Button>
          )
        }
      />

      {loading ? (
        <LoadingState rows={4} label="Loading roles" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => { void roles.refetch(); void catalog.refetch() }} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.data?.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {role.is_system && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Built-in role" />}
                  {role.name}
                </CardTitle>
                <CardDescription>{role.description ?? 'No description.'}</CardDescription>
                <CardAction className="flex gap-1">
                  {role.is_system || !canManage ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`View ${role.name}`} onClick={() => setEditing(role)}>
                      <EyeIcon />
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${role.name}`} onClick={() => setEditing(role)}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${role.name}`} onClick={() => setDeleting(role)}>
                        <Trash2Icon />
                      </Button>
                    </>
                  )}
                </CardAction>
                <div className="col-span-full flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary">{role.users_count} {role.users_count === 1 ? 'user' : 'users'}</Badge>
                  <Badge variant="outline">{role.permissions.length} permissions</Badge>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {catalog.data && (
        <RoleFormDialog
          open={editing !== undefined}
          onOpenChange={(open) => !open && setEditing(undefined)}
          role={editing ?? null}
          catalog={catalog.data}
          readOnly={!!editing && (editing.is_system || !canManage)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && deleting.users_count > 0
                ? `${deleting.users_count} user(s) still have this role. Remove it from them first.`
                : 'This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={deleteRole.isPending || (deleting?.users_count ?? 0) > 0}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
