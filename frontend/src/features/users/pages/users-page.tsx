import { useState } from 'react'
import { PencilIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { useRolesQuery } from '@/features/roles/api'
import { useUsersQuery, type ManagedUser, type UserStatus } from '@/features/users/api'
import { UserFormDialog } from '@/features/users/components/user-form-dialog'
import { useDebouncedValue } from '@/lib/use-debounced-value'

const ALL = 'all'

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'Never'
}

export function UsersPage() {
  const me = useAuth()
  const can = useCan()
  const canManage = can('users.manage')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL)
  const [roleId, setRoleId] = useState<string>(ALL)
  const [editing, setEditing] = useState<ManagedUser | null | undefined>(undefined)
  const debouncedSearch = useDebouncedValue(search)

  const roles = useRolesQuery(can('roles.view'))
  const { data, error, isPending, refetch } = useUsersQuery({
    page,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : status,
    role_id: roleId === ALL ? undefined : roleId,
  })
  const branchNames = new Map(me.branches.map((b) => [b.id, b.name]))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="People who can sign in to your organization."
        actions={
          canManage && (
            <Button onClick={() => setEditing(null)} disabled={!roles.data}>
              <PlusIcon data-icon="inline-start" /> New user
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search users"
            placeholder="Search by name or e-mail"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v as UserStatus | typeof ALL); setPage(1) }}>
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {roles.data && (
          <Select value={roleId} onValueChange={(v) => { setRoleId(v); setPage(1) }}>
            <SelectTrigger aria-label="Filter by role" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {roles.data.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isPending ? (
        <LoadingState rows={5} label="Loading users" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No users found" description="Adjust the search or filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="hidden lg:table-cell">Branches</TableHead>
                  <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name}{user.id === me.user.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => <Badge key={r.id} variant="outline">{r.name}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {user.branch_ids.map((id) => branchNames.get(id) ?? '—').join(', ') || '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDateTime(user.last_login_at)}</TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'active' ? 'secondary' : 'outline'}>{user.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell>
                      {canManage && roles.data && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${user.name}`} onClick={() => setEditing(user)}>
                          <PencilIcon />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar pagination={data.pagination} onPageChange={setPage} />
        </>
      )}

      {canManage && roles.data && (
        <UserFormDialog
          open={editing !== undefined}
          onOpenChange={(open) => !open && setEditing(undefined)}
          user={editing ?? null}
          roles={roles.data}
          branches={me.branches}
          isSelf={editing?.id === me.user.id}
        />
      )}
    </div>
  )
}
