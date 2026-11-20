import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { BotOffIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { isBatchActive, useAiBatchesQuery } from '@/features/online-catalog/ai-help/api'
import { BundleIdeasPanel } from '@/features/online-catalog/ai-help/bundle-ideas'
import { CategorySuggestionsPanel } from '@/features/online-catalog/ai-help/category-suggestions'
import { DraftsList } from '@/features/online-catalog/ai-help/drafts'
import { AI_HELP_PERMISSIONS, aiSwitchedOn } from '@/features/online-catalog/ai-help/model'
import { BatchProgress, WriteDraftsPanel, type DraftsPrefill } from '@/features/online-catalog/ai-help/write-drafts'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'

type TabKey = 'drafts' | 'categories' | 'bundles'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'drafts', label: 'Drafts' },
  { key: 'categories', label: 'Categories' },
  { key: 'bundles', label: 'Bundle ideas' },
]

/** Router state from the products list's "Write AI drafts" bulk action. */
export type AiHelpLocationState = { aiDraftProducts?: { id: string; name: string }[] }

function prefillFrom(state: unknown): DraftsPrefill | null {
  const items = (state as AiHelpLocationState | null)?.aiDraftProducts
  return Array.isArray(items) && items.length > 0 ? { subject: 'product', items } : null
}

/*
 * Online store → AI help (AI2a, /storefront/ai): AI drafts for listing texts, category
 * suggestions and bundle ideas. Needs online_catalog.view; writing and approving need
 * online_catalog.manage. Shown only when AI is on for the organization. The tab is in the address.
 */
export function AiHelpPage() {
  const me = useAuth()
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const [prefill] = useState(() => prefillFrom(location.state))
  const requested = search.get('tab')
  const active = TABS.find((t) => t.key === requested)?.key ?? 'drafts'

  const select = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    setSearch(next, { replace: true, state: location.state })
  }

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      {!aiSwitchedOn(me) ? (
        <div role="note" className="flex gap-3 rounded-lg border border-dashed p-4 text-sm">
          <BotOffIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">AI help is turned off</p>
            <p className="text-muted-foreground">An administrator can turn on AI under Organization → AI assistant.</p>
          </div>
        </div>
      ) : (
        <Tabs value={active} onValueChange={select}>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">AI help</h2>
            <p className="text-sm text-muted-foreground">Let AI draft your store texts, sort products into categories and spot bundles. You review everything before it goes on your store.</p>
          </div>
          <TabsList aria-label="AI help sections" className="mt-3 max-w-full overflow-x-auto">
            {TABS.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="drafts" className="pt-3"><DraftsTab prefill={prefill} /></TabsContent>
          <TabsContent value="categories" className="pt-3"><CategorySuggestionsPanel /></TabsContent>
          <TabsContent value="bundles" className="pt-3"><BundleIdeasPanel /></TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function DraftsTab({ prefill }: { prefill: DraftsPrefill | null }) {
  const can = useCan()
  const canManage = can(AI_HELP_PERMISSIONS.manage)
  const batches = useAiBatchesQuery()
  const [shown, setShown] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [batchFilter, setBatchFilter] = useState<string | null>(null)
  // A run already going on when the page opens is shown without asking.
  // It stays on screen when it finishes (until hidden), like a run started here.
  const running = batches.data?.find(isBatchActive) ?? null
  const [found, setFound] = useState<string | null>(null)
  if (running && running.id !== found) setFound(running.id)
  const batchId = shown ?? (found && !hidden.includes(found) ? found : null)

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <WriteDraftsPanel
          prefill={prefill}
          running={running !== null}
          onStarted={(batch) => setShown(batch.id)}
          onShowBatch={(id) => setShown(id)}
        />
      )}
      {batchId && (
        <BatchProgress
          batchId={batchId}
          canManage={canManage}
          onDismiss={() => {
            setHidden([...hidden, batchId])
            setShown(null)
          }}
        />
      )}
      <DraftsList canManage={canManage} batchFilter={batchFilter} onBatchFilter={setBatchFilter} />
    </div>
  )
}
