import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale } from '../i18n/locale'

function FullPageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-sf-canvas px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  )
}

export function StoreNotFoundView() {
  const { t } = useLocale()
  return (
    <FullPageMessage title={t('common.store.notFoundTitle')}>
      <p>{t('common.store.notFoundText')}</p>
    </FullPageMessage>
  )
}

export function StoreErrorView({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useLocale()
  return (
    <FullPageMessage title={t('common.store.errorTitle')}>
      <p>{t('common.store.errorText')}</p>
      <Button onClick={onRetry} disabled={retrying} className="h-11 rounded-sf-button px-6">
        {retrying ? t('common.retrying') : t('common.tryAgain')}
      </Button>
    </FullPageMessage>
  )
}

export function StoreLoadingView() {
  const { t } = useLocale()
  return (
    <div role="status" aria-live="polite" className="grid min-h-screen place-items-center bg-sf-canvas">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
      <span className="sr-only">{t('common.store.loading')}</span>
    </div>
  )
}

/** While a page's code is fetched (lazy routes): announced politely, sized like a page body. */
export function PageLoadingView() {
  const { t } = useLocale()
  return (
    <div role="status" aria-live="polite" className="grid min-h-[50vh] place-items-center" data-testid="page-loading">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">{t('common.page.loading')}</span>
    </div>
  )
}
