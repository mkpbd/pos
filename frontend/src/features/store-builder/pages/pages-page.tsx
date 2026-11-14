import { useState } from 'react'
import { useNavigate } from 'react-router'
import { FilePlusIcon, HouseIcon, Loader2Icon, MegaphoneIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCan } from '@/features/auth/use-auth'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { cn } from '@/lib/utils'
import { documentPath, useCreateDocumentMutation, useDeleteDocumentMutation, useDocumentsQuery, type DocumentSummary } from '../api'
import { isProductZone, parseZoneKey } from '../document-kind'
import { CmsPagesCard, SitePartsCard, ZonesCard, type RemoveRequest } from './builder-parts'
import { DemoLooksCard } from './demo-looks'
import { ListingColumnsCard } from './listing-columns-card'
import { PopupsCard } from './popups-card'
import { ProductZonesCard } from './product-zones-card'
import type { ScreenLang } from './messages'
import { NewLandingDialog } from './new-landing-dialog'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow, StatusBadges, ViewLink } from './page-rows'
import { rememberScreenLang, ScreenLangContext, storedScreenLang, useScreenText } from './screen-language'
import { LanguageToggle, ScreenConfirm } from './screen-ui'
import { StartGuide } from './start-guide'

/*
 * Online store → Page builder (/admin/storefront/pages), in three groups (B4):
 *  - Your pages: the home page, campaign (landing) pages and content pages (CMS) designed with the builder;
 *  - Header & footer: the store's header and footer;
 *  - Shop pages: the areas around the product grid, the products per row of the listings (theme
 *    `layout.listing_columns`) and, P1b, the product page areas with their versions for one
 *    category or one product.
 * Status, creating, editing and deleting (back to the classic rendering) for each. B5: above the
 * groups, the demo looks (drafts → review → publish all).
 * B7: English / বাংলা for this screen (remembered in the browser), a state-aware 3-step guide on
 * top, the looks with a preview, live demos and "use and publish now", and plain wording.
 * B8b: Popups & bars (list, on / off, new from a template, delete).
 * P2a: a new campaign page may start from a landing page template (new-landing-dialog.tsx).
 */

function PageRow({ summary, canManage, onDelete }: { summary: DocumentSummary; canManage: boolean; onDelete?: () => void }) {
  const { t, lang } = useScreenText()
  const path = documentPath(summary)
  return (
    <ListRow
      testId={`page-row-${summary.key}`}
      title={summary.title}
      detail={
        <>
          <span className="font-mono">{path}</span> · {lastEdited(summary, lang)}
        </>
      }
      status={<StatusBadges summary={summary} />}
    >
      {canManage && <EditLink summary={summary} name={summary.title} />}
      <ViewLink summary={summary} name={summary.title} />
      {canManage && onDelete && (
        <Button variant="ghost" size="icon-sm" aria-label={t('landing.deleteAria', { name: summary.title })} title={t('landing.deleteHint')} onClick={onDelete}>
          <Trash2Icon />
        </Button>
      )}
    </ListRow>
  )
}

function HomeCard({ home, canManage }: { home: DocumentSummary | undefined; canManage: boolean }) {
  const { t } = useScreenText()
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const start = (from: 'blank' | 'homepage') =>
    create.mutate(
      { kind: 'page', key: 'home', title: 'Home', from },
      {
        onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`),
        onError: (error) => toast.error(error.message),
      },
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HouseIcon className="size-5" aria-hidden /> {t('home.title')}
        </CardTitle>
        <CardDescription>{t('home.text')}</CardDescription>
      </CardHeader>
      <CardContent>
        {home ? (
          <ul className="divide-y">
            <PageRow summary={home} canManage={canManage} />
          </ul>
        ) : canManage ? (
          <div className="flex flex-col gap-3 rounded-md border border-dashed p-4">
            <p className="text-sm">{t('home.empty')}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={create.isPending} onClick={() => start('homepage')}>
                {create.isPending && create.variables?.from === 'homepage' ? <Loader2Icon className="animate-spin" aria-hidden /> : <FilePlusIcon aria-hidden />}
                {t('home.copy')}
              </Button>
              <Button variant="outline" disabled={create.isPending} onClick={() => start('blank')}>
                {create.isPending && create.variables?.from === 'blank' ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
                {t('home.blank')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('home.none')}</p>
        )}
      </CardContent>
    </Card>
  )
}

function GroupHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export function StoreBuilderPagesPage() {
  const [lang, setLangState] = useState<ScreenLang>(storedScreenLang)
  const setLang = (next: ScreenLang) => {
    setLangState(next)
    rememberScreenLang(next)
  }
  return (
    <ScreenLangContext value={{ lang, setLang }}>
      <PagesScreen />
    </ScreenLangContext>
  )
}

function PagesScreen() {
  const { lang, t } = useScreenText()
  const can = useCan()
  const canManage = can('storefront.manage')
  const canPublish = can('storefront.publish')
  const canManageContent = can('cms.manage')
  const documents = useDocumentsQuery()
  const remove = useDeleteDocumentMutation()
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<RemoveRequest | null>(null)

  const all = documents.data ?? []
  const pages = all.filter((d) => d.kind === 'page')
  const home = pages.find((d) => d.key === 'home')
  const landings = pages.filter((d) => d.key.startsWith('landing:')).sort((a, b) => a.title.localeCompare(b.title))
  const cmsDocs = pages.filter((d) => d.key.startsWith('cms:'))
  const parts = all.filter((d) => d.kind === 'header' || d.kind === 'footer')
  const zones = all.filter((d) => d.kind === 'zone')
  // P1b: the product page areas and their versions for a category or a product.
  const productZones = zones.filter((d) => {
    const parsed = parseZoneKey(d.key)
    return parsed !== null && isProductZone(parsed.zone)
  })
  const popups = all.filter((d) => d.kind === 'popup')

  const deleteLanding = (summary: DocumentSummary) =>
    setRemoving({
      summary,
      title: t('landing.deleteTitle', { name: summary.title }),
      description: t('landing.deleteText'),
      confirmLabel: t('landing.deleteConfirm'),
      done: t('landing.deleted'),
    })

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {/* The screen's own language (B7): `lang` lets the browser pick Bangla fonts and line breaks. */}
      <div lang={lang} className={cn('flex flex-col gap-6', lang === 'bn' && 'leading-relaxed')} data-testid="pages-screen">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-3xl flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('screen.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('screen.intro')}</p>
          </div>
          <LanguageToggle />
        </div>
        {documents.isPending ? (
          <LoadingState rows={3} label={t('screen.loading')} />
        ) : documents.error ? (
          <ErrorState title={t('screen.error')} error={documents.error} onRetry={() => void documents.refetch()} />
        ) : (
          <>
            {canManage && <StartGuide documents={all} canPublish={canPublish} />}
            <DemoLooksCard documents={all} canManage={canManage} canPublish={canPublish} />
            <section aria-labelledby="group-pages" className="flex flex-col gap-4">
              <GroupHeading id="group-pages" title={t('group.pages.title')} description={t('group.pages.text')} />
              <HomeCard home={home} canManage={canManage} />
              <CmsPagesCard documents={cmsDocs} canManage={canManage} canManageContent={canManageContent} onRemove={setRemoving} />
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MegaphoneIcon className="size-5" aria-hidden /> {t('landing.title')}
                    </CardTitle>
                    <CardDescription>{t('landing.text')}</CardDescription>
                  </div>
                  {canManage && (
                    <Button onClick={() => setCreating(true)}>
                      <PlusIcon aria-hidden /> {t('landing.new')}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {landings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('landing.empty')}</p>
                  ) : (
                    <ul className="divide-y" aria-label={t('landing.listLabel')}>
                      {landings.map((summary) => (
                        <PageRow key={summary.id} summary={summary} canManage={canManage} onDelete={() => deleteLanding(summary)} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
            <section aria-labelledby="group-parts" className="flex flex-col gap-4">
              <GroupHeading id="group-parts" title={t('group.parts.title')} description={t('group.parts.text')} />
              <SitePartsCard documents={parts} canManage={canManage} onRemove={setRemoving} />
            </section>
            <section aria-labelledby="group-shop" className="flex flex-col gap-4">
              <GroupHeading id="group-shop" title={t('group.shop.title')} description={t('group.shop.text')} />
              <ZonesCard documents={zones} canManage={canManage} onRemove={setRemoving}>
                <ListingColumnsCard canManage={canManage} canPublish={canPublish} />
              </ZonesCard>
              <ProductZonesCard documents={productZones} canManage={canManage} onRemove={setRemoving} />
            </section>
            <section aria-labelledby="group-popups" className="flex flex-col gap-4">
              <GroupHeading id="group-popups" title={t('group.popups.title')} description={t('group.popups.text')} />
              <PopupsCard documents={popups} canManage={canManage} canPublish={canPublish} onRemove={setRemoving} />
            </section>
          </>
        )}
      </div>
      <NewLandingDialog open={creating} onOpenChange={setCreating} />
      <ScreenConfirm
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.title ?? ''}
        description={removing?.description ?? ''}
        confirmLabel={removing?.confirmLabel ?? ''}
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return
          const done = removing.done
          remove.mutate(removing.summary.id, {
            onSuccess: () => {
              toast.success(done)
              setRemoving(null)
            },
            onError: (error) => toast.error(error.message),
          })
        }}
      />
    </div>
  )
}
