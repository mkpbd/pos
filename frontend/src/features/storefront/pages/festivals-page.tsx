import { useMemo, useState } from 'react'
import { CalendarHeartIcon, CircleAlertIcon, PartyPopperIcon, SendIcon, SparklesIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCurrentUserQuery } from '@/features/auth/api'
import { useCan } from '@/features/auth/use-auth'
import type { ScreenLang } from '@/features/store-builder/pages/messages'
import { LanguageToggle } from '@/features/store-builder/pages/screen-ui'
import { rememberScreenLang, ScreenLangContext, storedScreenLang } from '@/features/store-builder/pages/screen-language'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'
import { useFestivalsQuery, type Festival } from '@/features/storefront/festivals/api'
import { FestivalDialog, type FestivalDialogRequest } from '@/features/storefront/festivals/festival-dialog'
import type { FestivalMessageKey } from '@/features/storefront/festivals/messages'
import { currentSetup, dayWord, festivalStatus, formatDay, formatInstant, todayIn, type FestivalStatus } from '@/features/storefront/festivals/model'
import { useFestivalText } from '@/features/storefront/festivals/text'
import { cn } from '@/lib/utils'

/*
 * Online store → Festivals (B17): the festivals and special days of the next 12 months with their
 * next date ("expected" for moon / panjika dates), what is set up, and one-click setup → review →
 * publish all. Visible with storefront.view; setting up needs storefront.manage, publishing
 * storefront.publish. English / বাংলা like the Page builder screen.
 */

const STATUS_VARIANT: Record<FestivalStatus, 'soft' | 'warning' | 'success' | 'info'> = { none: 'soft', drafts_ready: 'warning', live_on_dates: 'success', ended: 'info' }
const STATUS_KEY: Record<FestivalStatus, FestivalMessageKey> = { none: 'status.none', drafts_ready: 'status.drafts_ready', live_on_dates: 'status.live_on_dates', ended: 'status.ended' }

function DateTile({ festival, lang }: { festival: Festival; lang: ScreenLang }) {
  const date = new Date(`${festival.next.starts_on}T00:00:00Z`)
  const loc = lang === 'bn' ? 'bn-BD' : 'en-GB'
  const day = new Intl.DateTimeFormat(loc, { timeZone: 'UTC', day: 'numeric' }).format(date)
  const month = new Intl.DateTimeFormat(loc, { timeZone: 'UTC', month: 'short' }).format(date)
  return (
    <div aria-hidden className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg border bg-primary/5 py-2 text-center">
      <span className="text-2xl leading-none font-semibold">{day}</span>
      <span className="mt-1 text-xs text-muted-foreground uppercase">{month}</span>
    </div>
  )
}

function FestivalRow({ festival, today, timeZone, canManage, onOpen }: {
  festival: Festival
  today: string
  timeZone: string | undefined
  canManage: boolean
  onOpen: (request: FestivalDialogRequest) => void
}) {
  const { t, lang, num } = useFestivalText()
  const status = festivalStatus(festival)
  const setup = currentSetup(festival)
  const { next } = festival
  const primary = lang === 'bn' ? festival.name_bn || festival.name : festival.name
  const secondary = lang === 'bn' ? festival.name : festival.name_bn
  const sameDay = next.starts_on === next.ends_on
  const dates = sameDay ? formatDay(lang, next.starts_on) : t('dates.range', { from: formatDay(lang, next.starts_on), to: formatDay(lang, next.ends_on) })
  const when = dayWord(today, next.starts_on, next.ends_on)
  const note = lang === 'bn' ? (next.note_bn ?? next.note) : (next.note ?? next.note_bn)
  const nameId = `festival-${festival.key}-name`
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start" data-testid={`festival-${festival.key}`} aria-labelledby={nameId}>
      <DateTile festival={festival} lang={lang} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 id={nameId} className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
          <span lang={lang === 'bn' ? 'bn' : 'en'}>{primary}</span>
          {secondary && secondary !== primary && (
            <span lang={lang === 'bn' ? 'en' : 'bn'} className="text-sm font-normal text-muted-foreground">
              {secondary}
            </span>
          )}
        </h3>
        <p className="text-sm">
          {dates} <span className="text-muted-foreground">· {t(when.key, when.count !== undefined ? { count: when.count } : undefined)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[status]} aria-label={t('status.label', { status: t(STATUS_KEY[status]) })} data-testid="festival-status">
            {t(STATUS_KEY[status])}
          </Badge>
          <Badge variant="outline">{t(`kind.${festival.kind}` as FestivalMessageKey)}</Badge>
          {next.expected && (
            <Badge variant="warning" data-testid="festival-expected">
              <CircleAlertIcon aria-hidden /> {t('expected')}
            </Badge>
          )}
        </div>
        {next.expected && (
          <p className="text-sm text-muted-foreground">
            {t('expected.help')}
            {note ? ` ${note}` : ''}
          </p>
        )}
        {!festival.sale_wording && <p className="text-sm text-muted-foreground">{t('tribute')}</p>}
        {setup && (
          <p className="text-sm text-muted-foreground" data-testid="festival-window">
            {t('setup.window', { from: formatInstant(lang, setup.starts_at, timeZone), to: formatInstant(lang, setup.ends_at, timeZone) })}
            {setup.year !== next.year ? ` (${num(setup.year)})` : ''}
          </p>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {status === 'drafts_ready' && (
            <Button size="sm" aria-label={t('action.reviewAria', { name: primary })} onClick={() => onOpen({ festival, mode: 'review' })}>
              <SendIcon aria-hidden /> {t('action.review')}
            </Button>
          )}
          <Button
            size="sm"
            variant={status === 'none' ? 'default' : 'outline'}
            aria-label={t(status === 'none' ? 'action.setupAria' : 'action.changeAria', { name: primary })}
            onClick={() => onOpen({ festival, mode: 'setup' })}
          >
            <SparklesIcon aria-hidden /> {t(status === 'none' ? 'action.setup' : 'action.change')}
          </Button>
        </div>
      )}
    </li>
  )
}

function FestivalsScreen() {
  const { t } = useFestivalText()
  const can = useCan()
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone ?? undefined
  const festivals = useFestivalsQuery()
  const [request, setRequest] = useState<FestivalDialogRequest | null>(null)
  const today = useMemo(() => todayIn(timeZone), [timeZone])
  const canManage = can('storefront.manage')
  const canPublish = can('storefront.publish')
  // The open dialog follows the list's latest data (after a setup or publish).
  const live = request ? { ...request, festival: festivals.data?.find((f) => f.key === request.festival.key) ?? request.festival } : null

  return (
    <section aria-labelledby="festivals-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-3xl flex-col gap-1">
          <h2 id="festivals-title" className="flex items-center gap-2 text-lg font-semibold">
            <PartyPopperIcon className="size-5" aria-hidden /> {t('page.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('page.intro')}</p>
        </div>
        <LanguageToggle />
      </div>
      {!canManage && <p className="text-sm text-muted-foreground">{t('noManage')}</p>}
      {festivals.isPending ? (
        <LoadingState rows={4} label={t('list.loading')} />
      ) : festivals.error ? (
        <ErrorState title={t('list.error')} error={festivals.error} onRetry={() => void festivals.refetch()} />
      ) : festivals.data.length === 0 ? (
        <EmptyState title={t('list.empty')} />
      ) : (
        <ul className={cn('divide-y rounded-lg border bg-background px-4')} aria-label={t('list.label')} data-testid="festival-list">
          {festivals.data.map((festival) => (
            <FestivalRow key={festival.key} festival={festival} today={today} timeZone={timeZone} canManage={canManage} onOpen={setRequest} />
          ))}
        </ul>
      )}
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarHeartIcon className="size-4" aria-hidden /> {t('expected.help')}
      </p>
      <FestivalDialog request={live} timeZone={timeZone} canManage={canManage} canPublish={canPublish} onClose={() => setRequest(null)} />
    </section>
  )
}

export function FestivalsPage() {
  const [lang, setLangState] = useState<ScreenLang>(storedScreenLang)
  const language = useMemo(
    () => ({
      lang,
      setLang: (next: ScreenLang) => {
        setLangState(next)
        rememberScreenLang(next)
      },
    }),
    [lang],
  )
  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <ScreenLangContext.Provider value={language}>
        <div lang={lang}>
          <FestivalsScreen />
        </div>
      </ScreenLangContext.Provider>
    </div>
  )
}
