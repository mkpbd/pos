import { useState } from 'react'
import { PencilIcon, PlusIcon, SearchIcon, WarehouseIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import { useBranchesQuery, type Branch } from '@/features/branches/api'
import { BranchFormDialog } from '@/features/branches/components/branch-form-dialog'
import { StoresSheet } from '@/features/branches/components/stores-sheet'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export function BranchesPage() {
  const can = useCan()
  const canManage = can('branches.manage')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [formBranch, setFormBranch] = useState<Branch | null | undefined>(undefined)
  const [storesBranchId, setStoresBranchId] = useState<string | null>(null)

  const { data, error, isPending, refetch } = useBranchesQuery({ page, search: debouncedSearch || undefined })
  const storesBranch = data?.items.find((b) => b.id === storesBranchId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branches"
        description="Outlets of your organization and their stock locations."
        actions={
          canManage && (
            <Button onClick={() => setFormBranch(null)}>
              <PlusIcon data-icon="inline-start" /> New branch
            </Button>
          )
        }
      />

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search branches"
          placeholder="Search by code or name"
          className="pl-8"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {isPending ? (
        <LoadingState rows={4} label="Loading branches" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No branches found" description={search ? 'Try a different search.' : undefined} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead>Stores</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-mono text-xs">{branch.code}</TableCell>
                    <TableCell className="font-medium">
                      {branch.name}
                      {branch.allow_negative_stock && <Badge variant="outline" className="ml-2">Negative stock</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{branch.phone ?? '—'}</TableCell>
                    <TableCell>{branch.stores.length}</TableCell>
                    <TableCell>
                      <Badge variant={branch.is_active ? 'success' : 'outline'}>{branch.is_active ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Stores of ${branch.name}`} onClick={() => setStoresBranchId(branch.id)}>
                        <WarehouseIcon />
                      </Button>
                      {canManage && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${branch.name}`} onClick={() => setFormBranch(branch)}>
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

      {canManage && (
        <BranchFormDialog open={formBranch !== undefined} onOpenChange={(open) => !open && setFormBranch(undefined)} branch={formBranch ?? null} />
      )}
      <StoresSheet branch={storesBranch} canManage={canManage} onOpenChange={(open) => !open && setStoresBranchId(null)} />
    </div>
  )
}
