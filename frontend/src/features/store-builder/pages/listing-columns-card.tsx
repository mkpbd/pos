import { useState } from 'react'
import { Loader2Icon, MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePublishThemeMutation, useSaveThemeDraftMutation, useThemeDraftQuery, type ThemeDocument } from '@/features/storefront/api'
import { ApiError } from '@/lib/api/client'
import { DEFAULT_LISTING_COLUMNS, LISTING_COLUMN_OPTIONS, normalizeListingColumns } from '@/storefront/builder/validate'
import type { ListingColumns } from '@/storefront/types'

/*
 * Products per row on the shop, category, brand and search pages (B4): the theme's
 * `layout.listing_columns`, saved to the theme draft (the same draft as Site styles) and, for
 * people who can publish, published at once.
 */

type Device = keyof ListingColumns
const DEVICES: { device: Device; label: string; icon: typeof MonitorIcon }[] = [
  { device: 'desktop', label: 'Computers', icon: MonitorIcon },
  { device: 'tablet', label: 'Tablets', icon: TabletIcon },
  { device: 'mobile', label: 'Phones', icon: SmartphoneIcon },
]

type WithColumns = ThemeDocument & { layout: ThemeDocument['layout'] & { listing_columns?: Partial<ListingColumns> } }

/** The theme's setting with every device filled in (invalid or missing values = today's grid). */
function listingColumnsOf(settings: ThemeDocument | undefined): ListingColumns {
  return normalizeListingColumns((settings as WithColumns | undefined)?.layout?.listing_columns)
}

export function ListingColumnsCard({ canManage, canPublish }: { canManage: boolean; canPublish: boolean }) {
  const draft = useThemeDraftQuery()
  const save = useSaveThemeDraftMutation()
  const publish = usePublishThemeMutation()
  const current = listingColumnsOf(draft.data?.settings)
  const [edited, setEdited] = useState<ListingColumns | null>(null)
  const value = edited ?? current
  const changed = edited !== null && (edited.desktop !== current.desktop || edited.tablet !== current.tablet || edited.mobile !== current.mobile)
  const otherChanges = draft.data?.has_unpublished_changes === true
  const busy = save.isPending || publish.isPending

  const submit = async () => {
    if (!draft.data || !edited) return
    const settings = draft.data.settings as WithColumns
    try {
      await save.mutateAsync({ revision: draft.data.draft_revision, settings: { ...settings, layout: { ...settings.layout, listing_columns: edited } } as ThemeDocument })
      if (canPublish) {
        await publish.mutateAsync(null)
        toast.success('Products per row saved and published.')
      } else toast.success('Saved to the theme draft. Someone with permission to publish makes it live.')
      setEdited(null)
    } catch (error) {
      toast.error(error instanceof ApiError && error.status === 409 ? 'The theme was changed somewhere else. Its latest version is loaded; try again.' : error instanceof Error ? error.message : 'Could not save.')
      if (error instanceof ApiError && error.status === 409) void draft.refetch()
    }
  }

  return (
    <section aria-labelledby="listing-columns-title" className="flex flex-col gap-3 rounded-md border p-4" data-testid="listing-columns">
      <div>
        <h3 id="listing-columns-title" className="font-medium">Products per row</h3>
        <p className="text-sm text-muted-foreground">How many products sit side by side in the shop, category, brand and search results.</p>
      </div>
      {draft.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : draft.error ? (
        <p className="text-sm text-destructive">The setting couldn’t be loaded. Try again later.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {DEVICES.map(({ device, label, icon: Icon }) => (
              <div key={device} className="flex flex-col gap-1.5">
                <Label htmlFor={`listing-columns-${device}`} className="flex items-center gap-1.5">
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {label}
                </Label>
                <Select value={String(value[device])} disabled={!canManage || busy} onValueChange={(v) => setEdited({ ...value, [device]: Number(v) } as ListingColumns)}>
                  <SelectTrigger id={`listing-columns-${device}`} className="w-full" aria-label={`Products per row on ${label.toLowerCase()}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_COLUMN_OPTIONS[device].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === 1 ? 'product' : 'products'}
                        {n === DEFAULT_LISTING_COLUMNS[device] ? ' (standard)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" disabled={!changed || busy} onClick={() => void submit()}>
                {busy && <Loader2Icon className="animate-spin" aria-hidden />}
                {canPublish ? 'Save and publish' : 'Save to draft'}
              </Button>
              {changed && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEdited(null)}>
                  Cancel
                </Button>
              )}
              {canPublish && otherChanges && <p className="text-xs text-muted-foreground">Publishing also makes your other unpublished site style changes live.</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
