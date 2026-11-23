import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, Loader2Icon, MonitorSmartphoneIcon } from 'lucide-react'
import { ErrorState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useCanvasContextQuery, useDocumentQuery, useElementsQuery, type DocumentDetail } from '../api'
import { Editor } from '../editor'
import { createEditorStore, EditorStoreContext } from '../store'

const FRESH_MS = 5_000

/** Below the `md` breakpoint (768 px) the editor's panels do not fit. */
const PHONE_QUERY = '(max-width: 767.98px)'

const isPhoneWidth = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

/**
 * Whether the builder opened on a phone-sized screen. Decided when the page opens; it only switches
 * from the notice to the editor (rotating a phone, widening a window) — never the other way, so a
 * narrowed desktop window does not throw away the editor and its unsaved work.
 */
function usePhoneNotice(): boolean {
  const [phone, setPhone] = useState(isPhoneWidth)
  useEffect(() => {
    if (!phone) return
    const media = window.matchMedia(PHONE_QUERY)
    const onChange = () => {
      if (!media.matches) setPhone(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [phone])
  return phone
}

/** Q1 §8: shown instead of the cramped editor on a phone. */
function PhoneNotice() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <MonitorSmartphoneIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="font-heading text-xl font-semibold">Open the page builder on a bigger screen</h1>
      <p className="text-sm text-muted-foreground">The page builder works on a computer or tablet — open this page there.</p>
      <Button variant="outline" asChild>
        <Link to="/storefront/pages">
          <ArrowLeftIcon /> Back to pages
        </Link>
      </Button>
    </main>
  )
}

/** /admin/storefront/builder/:documentId — the full-screen editor, outside the admin shell. */
export function StoreBuilderEditorPage() {
  const { documentId = '' } = useParams()
  const phone = usePhoneNotice()
  if (phone) return <PhoneNotice />
  return <DocumentEditorRoute key={documentId} documentId={documentId} />
}

function DocumentEditorRoute({ documentId }: { documentId: string }) {
  const document = useDocumentQuery(documentId)
  const elements = useElementsQuery()
  const context = useCanvasContextQuery()
  // B9: a document opened again in this session (back from a global section, say) is fetched again,
  // so the editor never starts from an old draft and revision. Data set just before opening (a new
  // document) counts as fresh.
  const [openedAt] = useState(() => Date.now())
  const stale = document.data !== undefined && document.dataUpdatedAt < openedAt - FRESH_MS
  const { refetch, isFetching } = document
  useEffect(() => {
    if (stale && !isFetching) void refetch()
  }, [stale, isFetching, refetch])

  const error = document.error ?? elements.error ?? context.error
  if (error) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState title={missing ? 'This page does not exist' : 'Could not open the page builder'} error={error} onRetry={missing ? undefined : () => {
          void document.refetch()
          void elements.refetch()
          void context.refetch()
        }} />
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/storefront/pages">
            <ArrowLeftIcon /> Back to pages
          </Link>
        </Button>
      </div>
    )
  }

  if (!document.data || stale || !elements.data || !context.data) {
    return (
      <div role="status" aria-label="Opening the page builder" className="flex min-h-svh items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  return <LoadedEditor detail={document.data} registry={elements.data} canvasContext={context.data} />
}

function LoadedEditor({ detail, registry, canvasContext }: { detail: DocumentDetail; registry: Parameters<typeof Editor>[0]['registry']; canvasContext: Parameters<typeof Editor>[0]['canvasContext'] }) {
  const [store] = useState(() => createEditorStore(detail))
  const title = store.getState().document.title
  useEffect(() => {
    const previous = window.document.title
    window.document.title = `${title} · Page builder`
    return () => {
      window.document.title = previous
    }
  }, [title])
  return (
    <EditorStoreContext value={store}>
      <Editor registry={registry} canvasContext={canvasContext} />
    </EditorStoreContext>
  )
}
