import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

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
  return (
    <FullPageMessage title="There is no open store at this address">
      <p>Check the address, or come back later.</p>
    </FullPageMessage>
  )
}

export function StoreErrorView({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <FullPageMessage title="The store could not be loaded">
      <p>Check your connection and try again.</p>
      <Button onClick={onRetry} disabled={retrying} className="rounded-sf-button">
        {retrying ? 'Retrying…' : 'Try again'}
      </Button>
    </FullPageMessage>
  )
}

export function StoreLoadingView() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-screen place-items-center bg-sf-canvas">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
      <span className="sr-only">Loading the store</span>
    </div>
  )
}

/** While a page's code is fetched (lazy routes): announced politely, sized like a page body. */
export function PageLoadingView() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[50vh] place-items-center" data-testid="page-loading">
      <span className="size-10 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent motion-reduce:animate-none" aria-hidden />
      <span className="sr-only">Loading the page</span>
    </div>
  )
}
