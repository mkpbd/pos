import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { branchKeys, type Branch } from '@/features/branches/api'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import type { ReportDefinition, ReportParam } from '@/features/reports/api'
import { DateRangeFilter } from '@/features/reports/components/date-range-filter'
import { EntityFilter } from '@/features/reports/components/entity-filter'
import { ENTITY_SOURCES } from '@/features/reports/entity-sources'
import { isRanged } from '@/features/reports/params'
import { api, toPaginated } from '@/lib/api/client'

const ALL = '__all__'

type Props = {
  definition: ReportDefinition
  values: Record<string, string>
  onChange: (changes: Record<string, string | null>) => void
}

/** Params handled by dedicated controls; anything else renders from its type. */
const RANGE_KEYS = new Set(['date_from', 'date_to'])

/**
 * The filter bar of a report, rendered from its params schema. Values come from (and go to)
 * the URL. Filters whose lookup list the user may not read are left out — unless a shared
 * link already set them, in which case they show as a removable chip.
 */
export function ReportFilters({ definition, values, onChange }: Props) {
  const me = useAuth()
  const timeZone = me.organization?.timezone
  const params = definition.params.filter((p) => !RANGE_KEYS.has(p.key))

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:p-4" role="group" aria-label="Report filters">
      {isRanged(definition) && (
        <DateRangeFilter
          key={`${values.date_from}|${values.date_to}`}
          idPrefix="report"
          from={values.date_from ?? ''}
          to={values.date_to ?? ''}
          timeZone={timeZone}
          onChange={(r) => onChange({ date_from: r.from, date_to: r.to })}
        />
      )}
      {params.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {params.map((p) => <ParamControl key={p.key} param={p} values={values} onChange={onChange} />)}
        </div>
      )}
    </div>
  )
}

function ParamControl({ param, values, onChange }: { param: ReportParam; values: Record<string, string>; onChange: Props['onChange'] }) {
  const me = useAuth()
  const can = useCan()
  const value = values[param.key] ?? ''
  const id = `report-${param.key}`
  const set = (v: string | null) => onChange({ [param.key]: v })
  const entity = param.type === 'id' ? param.entity : null

  if (entity === 'branch') {
    if (me.branches.length <= 1 && !value) return null
    return (
      <ChoiceField
        id={id}
        label={param.label}
        value={value}
        allLabel={param.required ? null : 'All branches'}
        options={me.branches.map((b) => ({ value: b.id, label: b.name }))}
        onChange={(v) => onChange({ [param.key]: v, ...(values.store_id ? { store_id: null } : {}) })}
      />
    )
  }
  if (entity === 'store') return <StoreField id={id} label={param.label} value={value} branchId={values.branch_id ?? ''} required={param.required} onChange={set} />
  if (entity === 'category' || entity === 'brand') {
    if (!can('products.view')) return value ? <EntityChip label={param.label} onClear={() => set(null)} /> : null
    return <TaxonomyField id={id} kind={entity === 'category' ? 'categories' : 'brands'} label={param.label} value={value} required={param.required} onChange={set} />
  }
  if (entity && entity in ENTITY_SOURCES && param.options.length === 0) {
    const allowed = can((ENTITY_SOURCES[entity] as { permission: string }).permission)
    if (!allowed && !value) return null
    return <EntityFilter paramKey={param.key} entity={entity} label={param.label} value={value} onChange={set} canSearch={allowed} />
  }
  if (param.type === 'enum' || param.options.length > 0) {
    // A choice with a default (e.g. channel = all) always has a value; others may be cleared.
    const clearable = !param.required && param.default === null && !param.options.some((o) => o.value === 'all')
    return <ChoiceField id={id} label={param.label} value={value} allLabel={clearable ? 'Any' : null} options={param.options} onChange={set} />
  }
  if (param.type === 'date') {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{param.label}</Label>
        <Input id={id} type="date" className="w-40" value={value} onChange={(e) => e.target.value && set(e.target.value)} />
      </div>
    )
  }
  if (param.type === 'boolean') {
    return (
      <div className="flex h-9 items-center gap-2">
        <Switch id={id} checked={value === '1' || value === 'true'} onCheckedChange={(on) => set(on ? '1' : '0')} />
        <Label htmlFor={id}>{param.label}</Label>
      </div>
    )
  }
  if (param.type === 'id') return value ? <EntityChip label={param.label} onClear={() => set(null)} /> : null
  return <TextField id={id} param={param} value={value} onChange={set} />
}

function ChoiceField({ id, label, value, options, allLabel, onChange }: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  /** Label of the "no filter" choice, or null when a value is required. */
  allLabel: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || (allLabel ? ALL : undefined)} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className="w-full sm:w-44"><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function StoreField({ id, label, value, branchId, required, onChange }: { id: string; label: string; value: string; branchId: string; required: boolean; onChange: (v: string | null) => void }) {
  const can = useCan()
  const allowed = can('branches.view')
  const params = { page: 1, per_page: 100, is_active: true }
  const branches = useQuery({
    queryKey: branchKeys.list(params),
    queryFn: ({ signal }) => api.get<Branch[]>('/branches', { signal, query: { ...params, is_active: 1 } }).then(toPaginated),
    enabled: allowed,
  })
  const groups = useMemo(
    () => (branches.data?.items ?? []).filter((b) => !branchId || b.id === branchId).map((b) => ({ branch: b, stores: b.stores.filter((s) => s.is_active) })).filter((g) => g.stores.length > 0),
    [branches.data, branchId],
  )
  if (!allowed) return value ? <EntityChip label={label} onClear={() => onChange(null)} /> : null

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || (required ? undefined : ALL)} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className="w-full sm:w-48"><SelectValue placeholder={branches.isPending ? 'Loading stores…' : 'Choose a store'} /></SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={ALL}>All stores</SelectItem>}
          {groups.map(({ branch, stores }) => (
            <SelectGroup key={branch.id}>
              <SelectLabel>{branch.name}</SelectLabel>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function TaxonomyField({ id, kind, label, value, required, onChange }: { id: string; kind: 'categories' | 'brands'; label: string; value: string; required: boolean; onChange: (v: string | null) => void }) {
  const categories = useCatalogList('categories', kind === 'categories')
  const brands = useCatalogList('brands', kind === 'brands')
  const options = useMemo(
    () =>
      kind === 'categories'
        ? flattenCategoryTree(categories.data ?? []).map((c) => ({ value: c.id, label: c.path }))
        : (brands.data ?? []).map((b) => ({ value: b.id, label: b.name })),
    [kind, categories.data, brands.data],
  )
  return <ChoiceField id={id} label={label} value={value} options={options} allLabel={required ? null : kind === 'categories' ? 'All categories' : 'All brands'} onChange={onChange} />
}

/** Free text / number params apply on Enter or when the field loses focus. */
function TextField({ id, param, value, onChange }: { id: string; param: ReportParam; value: string; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value)
  const apply = () => {
    if (text.trim() !== value) onChange(text.trim() || null)
  }
  const numeric = param.type === 'integer'
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{param.label}</Label>
      <Input
        id={id}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        min={param.min ?? undefined}
        max={param.max ?? undefined}
        className={numeric ? 'w-28' : 'w-full sm:w-48'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
        }}
      />
    </div>
  )
}

function EntityChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm leading-none font-medium">{label}</span>
      <button type="button" className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted" onClick={onClear} aria-label={`Clear ${label.toLowerCase()} filter`}>
        Filtered · clear
      </button>
    </div>
  )
}
