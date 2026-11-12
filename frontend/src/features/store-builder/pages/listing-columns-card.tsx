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
import { useScreenText } from './screen-language'

/*
 * Products per row on the shop, category, brand and search pages (B4): the theme's
 * `layout.listing_columns`, saved to the theme draft (the same draft as Site styles) and, for
 * people who can publish, published at once.
 */

type Device = keyof ListingColumns
const DEVICES: { device: Device; icon: typeof MonitorIcon }[] = [
  { device: 'desktop', icon: MonitorIcon },
  { device: 'tablet', icon: TabletIcon },
  { device: 'mobile', icon: SmartphoneIcon },
]

type WithColumns = ThemeDocument & { layout: ThemeDocument['layout'] & { listing_columns?: Partial<ListingColumns> } }

/** The theme's setting with every device filled in (invalid or missing values = today's grid). */
function listingColumnsOf(settings: ThemeDocument | undefined): ListingColumns {
  return normalizeListingColumns((settings as WithColumns | undefined)?.layout?.listing_columns)
}

export function ListingColumnsCard({ canManage, canPublish }: { canManage: boolean; canPublish: boolean }) {
  const { t, tc } = useScreenText()
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
        toast.success(t('columns.saved'))
      } else toast.success(t('columns.savedDraft'))
      setEdited(null)
    } catch (error) {
      toast.error(error instanceof ApiError && error.status === 409 ? t('columns.conflict') : error instanceof Error ? error.message : t('columns.saveFailed'))
      if (error instanceof ApiError && error.status === 409) void draft.refetch()
    }
  }

  return (
    <section aria-labelledby="listing-columns-title" className="flex flex-col gap-3 rounded-md border p-4" data-testid="listing-columns">
      <div>
        <h3 id="listing-columns-title" className="font-medium">{t('columns.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('columns.text')}</p>
      </div>
      {draft.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : draft.error ? (
        <p className="text-sm text-destructive">{t('columns.error')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {DEVICES.map(({ device, icon: Icon }) => {
              const label = t(`columns.device.${device}` as const)
              return (
              <div key={device} className="flex flex-col gap-1.5">
                <Label htmlFor={`listing-columns-${device}`} className="flex items-center gap-1.5">
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {label}
                </Label>
                <Select value={String(value[device])} disabled={!canManage || busy} onValueChange={(v) => setEdited({ ...value, [device]: Number(v) } as ListingColumns)}>
                  <SelectTrigger id={`listing-columns-${device}`} className="w-full" aria-label={t('columns.aria', { device: label.toLowerCase() })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_COLUMN_OPTIONS[device].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {tc('columns.option', n)}
                        {n === DEFAULT_LISTING_COLUMNS[device] ? ` ${t('columns.standard')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )
            })}
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" disabled={!changed || busy} onClick={() => void submit()}>
                {busy && <Loader2Icon className="animate-spin" aria-hidden />}
                {canPublish ? t('columns.savePublish') : t('columns.saveDraft')}
              </Button>
              {changed && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEdited(null)}>
                  {t('common.cancel')}
                </Button>
              )}
              {canPublish && otherChanges && <p className="text-xs text-muted-foreground">{t('columns.otherChanges')}</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
