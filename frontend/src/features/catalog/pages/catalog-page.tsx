import { useMemo, useState, type ReactNode } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCan } from '@/features/auth/use-auth'
import {
  flattenCategoryTree,
  useCatalogList,
  useDeleteCatalogRecord,
  useSaveCatalogRecord,
  type Brand,
  type CatalogKind,
  type Category,
  type TaxRate,
  type Unit,
} from '@/features/catalog/api'
import { CatalogRecordDialog, type FieldConfig } from '@/features/catalog/components/catalog-record-dialog'
import { decimalPattern, formatMoney, trimDecimal } from '@/lib/money'

type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string }

type SectionProps<T extends { id: string; name: string; is_active: boolean }, V extends Record<string, unknown>> = {
  kind: CatalogKind
  label: string
  rows: T[] | undefined
  isPending: boolean
  error: unknown
  onRetry: () => void
  canManage: boolean
  columns: Column<T>[]
  fields: FieldConfig<V>[]
  toValues: (row: T | null) => V
}

function CatalogSection<T extends { id: string; name: string; is_active: boolean }, V extends Record<string, unknown>>(props: SectionProps<T, V>) {
  const { kind, label, rows, isPending, error, onRetry, canManage, columns, fields, toValues } = props
  const save = useSaveCatalogRecord(kind)
  const remove = useDeleteCatalogRecord(kind)
  const [editing, setEditing] = useState<T | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<T | null>(null)
  // Form defaults are captured when the dialog opens, so re-renders never reset what the user typed.
  const [defaults, setDefaults] = useState<V>(() => toValues(null))
  const openEditor = (row: T | null) => {
    setDefaults(toValues(row))
    setEditing(row)
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Button className="self-start" variant="outline" onClick={() => openEditor(null)}>
          <PlusIcon data-icon="inline-start" /> New {label}
        </Button>
      )}

      {isPending ? (
        <LoadingState rows={4} label={`Loading ${label}s`} />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !rows?.length ? (
        <EmptyState title={`No ${label}s yet`} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c.header} className={c.className}>{c.header}</TableHead>)}
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((c) => <TableCell key={c.header} className={c.className}>{c.cell(row)}</TableCell>)}
                  <TableCell><Badge variant={row.is_active ? 'success' : 'outline'}>{row.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.name}`} onClick={() => openEditor(row)}><PencilIcon /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row)}><Trash2Icon /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CatalogRecordDialog<V>
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : `New ${label}`}
        fields={fields}
        defaultValues={defaults}
        submitLabel={editing ? 'Save changes' : `Create ${label}`}
        isPending={save.isPending}
        onSubmit={(values) =>
          save.mutateAsync({ id: editing?.id, input: values as never }).then((saved) => toast.success(`${(saved as { name: string }).name} saved.`))
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={`A ${label} that is still in use cannot be deleted — deactivate it instead.`}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(`${deleting.name} deleted.`),
            onError: (e) => toast.error(e.message),
            onSettled: () => setDeleting(null),
          })
        }
      />
    </div>
  )
}

const MONEY_RATE = decimalPattern(4)
const FACTOR = decimalPattern(6)

export function CatalogPage() {
  const can = useCan()
  const categories = useCatalogList('categories')
  const brands = useCatalogList('brands')
  const units = useCatalogList('units')
  const taxRates = useCatalogList('taxRates')

  const tree = useMemo(() => flattenCategoryTree(categories.data ?? []), [categories.data])
  const unitNames = new Map((units.data ?? []).map((u) => [u.id, u.code]))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Catalog" description="Categories, brands, units of measure and tax rates used by products." />
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="taxes">Tax rates</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="pt-4">
          <CatalogSection<Category & { depth: number }, { name: string; parent_id: string | null; description: string | null; is_active: boolean }>
            kind="categories"
            label="category"
            rows={tree}
            isPending={categories.isPending}
            error={categories.error}
            onRetry={() => categories.refetch()}
            canManage={can('categories.manage')}
            columns={[
              { header: 'Name', cell: (c) => <span style={{ paddingLeft: `${c.depth * 1.25}rem` }} className="font-medium">{c.depth > 0 && '└ '}{c.name}</span> },
              { header: 'Description', cell: (c) => c.description ?? '—', className: 'hidden md:table-cell text-muted-foreground' },
            ]}
            fields={[
              { name: 'name', label: 'Name', type: 'text', rules: { required: 'Required.' } },
              { name: 'parent_id', label: 'Parent category', type: 'select', noneLabel: 'None (top level)', options: tree.map((c) => ({ value: c.id, label: c.path })) },
              { name: 'description', label: 'Description', type: 'text' },
              { name: 'is_active', label: 'Active', type: 'switch' },
            ]}
            toValues={(c) => ({ name: c?.name ?? '', parent_id: c?.parent_id ?? null, description: c?.description ?? null, is_active: c?.is_active ?? true })}
          />
        </TabsContent>

        <TabsContent value="brands" className="pt-4">
          <CatalogSection<Brand, { name: string; description: string | null; is_active: boolean }>
            kind="brands"
            label="brand"
            rows={brands.data}
            isPending={brands.isPending}
            error={brands.error}
            onRetry={() => brands.refetch()}
            canManage={can('brands.manage')}
            columns={[
              { header: 'Name', cell: (b) => <span className="font-medium">{b.name}</span> },
              { header: 'Description', cell: (b) => b.description ?? '—', className: 'hidden md:table-cell text-muted-foreground' },
            ]}
            fields={[
              { name: 'name', label: 'Name', type: 'text', rules: { required: 'Required.' } },
              { name: 'description', label: 'Description', type: 'text' },
              { name: 'is_active', label: 'Active', type: 'switch' },
            ]}
            toValues={(b) => ({ name: b?.name ?? '', description: b?.description ?? null, is_active: b?.is_active ?? true })}
          />
        </TabsContent>

        <TabsContent value="units" className="pt-4">
          <CatalogSection<Unit, { name: string; code: string; allow_decimal: boolean; base_unit_id: string | null; conversion_factor: string | null; is_active: boolean }>
            kind="units"
            label="unit"
            rows={units.data}
            isPending={units.isPending}
            error={units.error}
            onRetry={() => units.refetch()}
            canManage={can('units.manage')}
            columns={[
              { header: 'Name', cell: (u) => <span className="font-medium">{u.name}</span> },
              { header: 'Code', cell: (u) => <span className="font-mono text-xs">{u.code}</span> },
              { header: 'Conversion', cell: (u) => (u.base_unit_id ? `1 ${u.code} = ${trimDecimal(u.conversion_factor)} ${unitNames.get(u.base_unit_id) ?? ''}` : 'Base unit') },
              { header: 'Fractions', cell: (u) => (u.allow_decimal ? 'Allowed' : 'Whole only'), className: 'hidden md:table-cell' },
            ]}
            fields={[
              { name: 'name', label: 'Name', type: 'text', rules: { required: 'Required.' } },
              { name: 'code', label: 'Code', type: 'text', rules: { required: 'Required.' }, hint: 'Short label printed on receipts, e.g. pcs, kg.' },
              { name: 'allow_decimal', label: 'Allow fractional quantities', type: 'switch', hint: 'For weighed or measured goods (kg, litre).' },
              { name: 'base_unit_id', label: 'Derived from', type: 'select', noneLabel: 'Nothing (base unit)', options: (units.data ?? []).filter((u) => !u.base_unit_id).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })) },
              { name: 'conversion_factor', label: 'Base units per unit', type: 'text', inputMode: 'decimal', rules: { pattern: { value: FACTOR, message: 'Up to 6 decimal places.' } }, hint: 'E.g. 12 for a box of 12 pieces.' },
              { name: 'is_active', label: 'Active', type: 'switch' },
            ]}
            toValues={(u) => ({ name: u?.name ?? '', code: u?.code ?? '', allow_decimal: u?.allow_decimal ?? false, base_unit_id: u?.base_unit_id ?? null, conversion_factor: u?.conversion_factor ?? null, is_active: u?.is_active ?? true })}
          />
        </TabsContent>

        <TabsContent value="taxes" className="pt-4">
          <CatalogSection<TaxRate, { name: string; rate: string; is_active: boolean }>
            kind="taxRates"
            label="tax rate"
            rows={taxRates.data}
            isPending={taxRates.isPending}
            error={taxRates.error}
            onRetry={() => taxRates.refetch()}
            canManage={can('taxes.manage')}
            columns={[
              { header: 'Name', cell: (t) => <span className="font-medium">{t.name}</span> },
              { header: 'Rate', cell: (t) => `${formatMoney(t.rate, undefined, 2)} %` },
            ]}
            fields={[
              { name: 'name', label: 'Name', type: 'text', rules: { required: 'Required.' } },
              { name: 'rate', label: 'Rate (%)', type: 'text', inputMode: 'decimal', rules: { required: 'Required.', pattern: { value: MONEY_RATE, message: 'A percentage with up to 4 decimals.' } } },
              { name: 'is_active', label: 'Active', type: 'switch' },
            ]}
            toValues={(t) => ({ name: t?.name ?? '', rate: t?.rate ?? '', is_active: t?.is_active ?? true })}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
