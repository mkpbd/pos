import { useMemo, useState } from 'react'
import { FolderTreeIcon, Loader2Icon, PackageIcon, PlusIcon, ShoppingBagIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProductSearchQuery } from '@/features/online-catalog/api'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useCategoryTargetsQuery, ZONE_VERSION_LIMIT, type DocumentSummary, type ProductZoneKey, type ZoneTarget } from '../api'
import { isProductZone, parseZoneKey, PRODUCT_ZONE_KEYS, targetedZoneKey, ZONE_TITLES } from '../document-kind'
import type { RemoveRequest } from './builder-parts'
import type { MessageKey } from './messages'
import { categoryRows, lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'
import { useScreenText } from './screen-language'
import { useStartDocument } from './use-start-document'

/*
 * Product pages on the start screen (P1b): the three product page areas — under the price, under
 * the product details, the bottom of the page — each with its content for all products and its
 * versions for one category or one product (searchable pickers; at most 100 versions in all).
 * On a product page the most specific published version shows: the product's, then the nearest
 * category's, then the one for all products.
 */

type Version = { summary: DocumentSummary; target: { type: ZoneTarget['type']; id: string }; name: string | null }
type ZoneEntry = { all: DocumentSummary | undefined; versions: Version[] }

/** Product zone documents by zone, versions sorted (categories, then products; by name; gone ones last), and how many versions there are. */
function groupByZone(documents: DocumentSummary[]): { zones: Map<ProductZoneKey, ZoneEntry>; count: number } {
  const zones = new Map<ProductZoneKey, ZoneEntry>(PRODUCT_ZONE_KEYS.map((zone) => [zone, { all: undefined, versions: [] }]))
  let count = 0
  for (const summary of documents) {
    const parsed = parseZoneKey(summary.key)
    if (!parsed || !isProductZone(parsed.zone)) continue
    const entry = zones.get(parsed.zone)!
    if (!parsed.target) {
      entry.all = summary
      continue
    }
    count += 1
    // `target.name` null = the category or product is gone; a server without `target` still has the title.
    const name = summary.target ? (summary.target.id === parsed.target.id ? summary.target.name : null) : summary.title
    entry.versions.push({ summary, target: parsed.target, name })
  }
  const rank = (v: Version) => (v.target.type === 'category' ? 0 : 2) + (v.name === null ? 1 : 0)
  for (const entry of zones.values()) entry.versions.sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''))
  return { zones, count }
}

/** The (English) title a new version gets in the editor, e.g. "Under the price · Shoes". */
const versionTitle = (zone: ProductZoneKey, name: string) => `${ZONE_TITLES[zone]} · ${name}`.slice(0, 160)

export function ProductZonesCard({ documents, canManage, onRemove }: { documents: DocumentSummary[]; canManage: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { t, tc } = useScreenText()
  const { start, pendingKey, pending } = useStartDocument()
  const { zones, count } = useMemo(() => groupByZone(documents), [documents])
  const full = count >= ZONE_VERSION_LIMIT

  return (
    <Card data-testid="product-zones">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingBagIcon className="size-5" aria-hidden /> {t('productZones.title')}
        </CardTitle>
        <CardDescription>{t('productZones.text')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {PRODUCT_ZONE_KEYS.map((zone) => {
          const entry = zones.get(zone)!
          return (
            <ZoneBlock
              key={zone}
              zone={zone}
              entry={entry}
              canManage={canManage}
              onRemove={onRemove}
              pending={pending}
              pendingKey={pendingKey}
              addDisabled={full || pending}
              onCreateAll={() => start({ kind: 'zone', key: zone, title: ZONE_TITLES[zone], from: 'blank' })}
              onCreateVersion={(type, id, name) => start({ kind: 'zone', key: targetedZoneKey(zone, type, id), title: versionTitle(zone, name), from: 'blank' })}
            />
          )
        })}
        <p className="text-xs text-muted-foreground">{t('productZones.rule')}</p>
        {canManage && count > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="zone-version-count">
            {tc('productZones.count', count, { limit: ZONE_VERSION_LIMIT })}
          </p>
        )}
        {canManage && full && (
          <p role="status" className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t('productZones.limit', { limit: ZONE_VERSION_LIMIT })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

type ZoneBlockProps = {
  zone: ProductZoneKey
  entry: ZoneEntry
  canManage: boolean
  onRemove: (request: RemoveRequest) => void
  pending: boolean
  pendingKey: string | undefined
  addDisabled: boolean
  onCreateAll: () => void
  onCreateVersion: (type: ZoneTarget['type'], id: string, name: string) => void
}

function ZoneBlock({ zone, entry, canManage, onRemove, pending, pendingKey, addDisabled, onCreateAll, onCreateVersion }: ZoneBlockProps) {
  const { t, lang } = useScreenText()
  const title = t(`zone.${zone}` as MessageKey)
  const headingId = `product-zone-${zone.slice('zone:product.'.length)}`
  const { all, versions } = entry
  const taken = (type: ZoneTarget['type']) => new Set(versions.filter((v) => v.target.type === type).map((v) => v.target.id))
  const allDetail = t('productZones.allDetail')

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-md border p-4" data-testid={`product-zone-${zone}`}>
      <div>
        <h3 id={headingId} className="font-medium">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{t(`zone.${zone}.detail` as MessageKey)}</p>
      </div>
      <ul className="divide-y" aria-label={t('productZones.listLabel', { name: title })}>
        <ListRow
          testId={`page-row-${zone}`}
          title={t('productZones.all')}
          detail={all ? `${allDetail} ${lastEdited(all, lang)}` : `${allDetail} ${t('productZones.allEmpty')}`}
          status={all ? <StatusBadges summary={all} /> : undefined}
        >
          {all ? (
            <>
              {canManage && <EditLink summary={all} name={title} />}
              <ViewLink summary={all} name={title} />
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('zones.removeAria', { name: title })}
                  title={t('zones.removeHint')}
                  onClick={() =>
                    onRemove({ summary: all, title: t('zones.removeTitle', { name: title }), description: t('productZones.removeAllText'), confirmLabel: t('zones.removeConfirm'), done: t('zones.removed') })
                  }
                >
                  <Trash2Icon />
                </Button>
              )}
            </>
          ) : (
            canManage && (
              <Button size="sm" variant="outline" disabled={pending} aria-label={t('zones.addAria', { name: title })} onClick={onCreateAll}>
                {pendingKey === zone ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
                {t('zones.add')}
              </Button>
            )
          )}
        </ListRow>
        {versions.map((version) => (
          <VersionRow key={version.summary.id} zoneTitle={title} version={version} canManage={canManage} onRemove={onRemove} />
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <CategoryPicker zoneTitle={title} taken={taken('category')} disabled={addDisabled} busy={pendingKey?.startsWith(`${zone}@category:`) === true} onPick={(c) => onCreateVersion('category', c.id, c.name)} />
          <ProductPicker zoneTitle={title} taken={taken('product')} disabled={addDisabled} busy={pendingKey?.startsWith(`${zone}@product:`) === true} onPick={(p) => onCreateVersion('product', p.id, p.name)} />
        </div>
      )}
    </section>
  )
}

function VersionRow({ zoneTitle, version, canManage, onRemove }: { zoneTitle: string; version: Version; canManage: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { t, lang } = useScreenText()
  const { summary, target, name } = version
  const category = target.type === 'category'
  const targetName = name ?? t(category ? 'productZones.goneCategory' : 'productZones.goneProduct')
  const label = name === null ? targetName : t(category ? 'productZones.category' : 'productZones.product', { name })
  const versionName = t('productZones.versionName', { zone: zoneTitle, target: targetName })
  const Icon = category ? FolderTreeIcon : PackageIcon

  return (
    <ListRow
      testId={`page-row-${summary.key}`}
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {label}
        </span>
      }
      detail={
        name === null ? (
          <span className="text-amber-700 dark:text-amber-400">{t('productZones.goneDetail')}</span>
        ) : (
          `${t(category ? 'productZones.categoryDetail' : 'productZones.productDetail')} ${lastEdited(summary, lang)}`
        )
      }
      status={<StatusBadges summary={summary} />}
    >
      {canManage && <EditLink summary={summary} name={versionName} />}
      <ViewLink summary={summary} name={versionName} />
      {canManage && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('productZones.deleteAria', { name: versionName })}
          title={t('productZones.deleteHint')}
          onClick={() =>
            onRemove({
              summary,
              title: t('productZones.deleteTitle', { name: versionName }),
              description: t(category ? 'productZones.deleteText.category' : 'productZones.deleteText.product'),
              confirmLabel: t('productZones.deleteConfirm'),
              done: t('productZones.deleted'),
            })
          }
        >
          <Trash2Icon />
        </Button>
      )}
    </ListRow>
  )
}

/* ---------------------------------------------------------------------------------------------- */

type PickerProps = { zoneTitle: string; taken: Set<string>; disabled: boolean; busy: boolean; onPick: (item: { id: string; name: string }) => void }

/** Every category of the store (tree order, indented; while searching, with its path), searchable by name. */
function CategoryPicker({ zoneTitle, taken, disabled, busy, onPick }: PickerProps) {
  const { t, lang } = useScreenText()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const categories = useCategoryTargetsQuery(open)
  const rows = useMemo(() => categoryRows(categories.data ?? []), [categories.data])
  const query = search.trim().toLocaleLowerCase()
  const shown = query ? rows.filter((row) => row.path.toLocaleLowerCase().includes(query)) : rows
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={t('productZones.addCategoryAria', { name: zoneTitle })}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <FolderTreeIcon aria-hidden />}
          {t('productZones.addCategory')}
        </Button>
      </PopoverTrigger>
      <PopoverContent lang={lang} className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false} label={t('productZones.pickCategory')}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('productZones.searchCategories')} />
          <CommandList label={t('productZones.pickCategory')}>
            <CommandEmpty>{categories.isPending ? t('common.loading') : categories.isError ? t('productZones.categoriesError') : t('productZones.noCategories')}</CommandEmpty>
            {shown.length > 0 && (
              <CommandGroup>
                {shown.map((row) => {
                  const has = taken.has(row.id)
                  return (
                    <CommandItem
                      key={row.id}
                      value={row.id}
                      disabled={has}
                      onSelect={() => {
                        close(false)
                        onPick({ id: row.id, name: row.name })
                      }}
                    >
                      <span className="min-w-0 truncate" style={query ? undefined : { paddingLeft: `${Math.min(row.depth, 6) * 0.75}rem` }}>
                        {query ? row.path : row.name}
                      </span>
                      {has && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t('productZones.hasVersion')}</span>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The admin product search (GET /products?search=, name, SKU or barcode). */
function ProductPicker({ zoneTitle, taken, disabled, busy, onPick }: PickerProps) {
  const { t, lang } = useScreenText()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = results.data?.items ?? []
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={t('productZones.addProductAria', { name: zoneTitle })}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <PackageIcon aria-hidden />}
          {t('productZones.addProduct')}
        </Button>
      </PopoverTrigger>
      <PopoverContent lang={lang} className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false} label={t('productZones.pickProduct')}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('productZones.searchProducts')} />
          <CommandList label={t('productZones.pickProduct')}>
            <CommandEmpty>{results.isFetching ? t('productZones.searching') : results.isError ? t('productZones.productsError') : t('productZones.noProducts')}</CommandEmpty>
            {hits.length > 0 && (
              <CommandGroup>
                {hits.map((product) => {
                  const has = taken.has(product.id)
                  const detail = [product.variants[0]?.sku, product.is_active ? null : t('productZones.inactive'), has ? t('productZones.hasVersion') : null].filter(Boolean).join(' · ')
                  return (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      disabled={has}
                      onSelect={() => {
                        close(false)
                        onPick({ id: product.id, name: product.name })
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{product.name}</span>
                        {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
