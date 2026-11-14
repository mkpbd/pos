import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, GlobeIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, UnlinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DocumentContext, Section } from '@/storefront/builder/types'
import type { GlobalUsage } from './api'
import { useCommands, useEditorUi } from './commands'
import { useBackTo, useGlobalsQuery, type GlobalSummary } from './global-api'
import { globalFits, referenceFor, unavailableReason, usageText, type GlobalContext, type GlobalSectionRef } from './global-sections'
import { useEditor, useEditorStoreApi } from './store'
import { collectIds, findNode, insertSection, newId } from './tree'

/*
 * B9 global sections in the editor:
 *  - GlobalSectionsPanel, the left panel's Global tab: the store's global sections that fit this
 *    document, to insert (a reference after the selection's section, one undo step) or open;
 *  - GlobalRefPanel, the right panel while a reference is selected: what it is, where else it is
 *    used, Edit (opens the global's own document), Detach, hide and delete;
 *  - GlobalDocBar / GlobalDocPanel, in a global's own document: "Used on N pages" and the way back.
 */

function usedInNames(list: readonly GlobalUsage[], max = 3): string {
  const names = list.slice(0, max).map((u) => u.title)
  const more = list.length - names.length
  return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ')
}

function StatusBadge({ summary }: { summary: Pick<GlobalSummary, 'published' | 'has_unpublished_changes'> }) {
  if (!summary.published) return <Badge variant="warning">Not published</Badge>
  if (summary.has_unpublished_changes) return <Badge variant="warning">Unpublished changes</Badge>
  return <Badge variant="success">Published</Badge>
}

/** The Global tab of the left panel. */
export function GlobalSectionsPanel({ context, enabled }: { context: DocumentContext; enabled: boolean }) {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const query = useGlobalsQuery(enabled)
  const [search, setSearch] = useState('')
  const usable = useMemo(() => (query.data ?? []).filter((g) => globalFits(g.context, context)), [query.data, context])
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return words ? usable.filter((g) => g.title.toLowerCase().includes(words)) : usable
  }, [usable, search])

  const insert = (global: GlobalSummary) => {
    const state = store.getState()
    const info = findNode(state.content, state.selection)
    const index = info ? state.content.sections.findIndex((s) => s.id === info.sectionId) + 1 : state.content.sections.length
    const id = newId('s', collectIds(state.content))
    const ref = referenceFor({ id, hidden: false, schedule: null }, global.id)
    const ok = state.apply((content) => insertSection(content, ref as unknown as Section, index), { select: id })
    if (!ok) {
      toast.error('There’s no room for another section here.')
      return
    }
    commands.reveal(id)
    if (!global.published) toast.warning(`“${global.title}” isn’t published yet. Shoppers see it only after it is published.`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2">
      <p className="px-1 text-xs text-muted-foreground">
        The same section on many pages. Change it once and every page that uses it updates when you publish it. To make one, open a section’s menu (⋯) and choose <span className="font-medium">Make global</span>.
      </p>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search global sections" aria-label="Search global sections" className="pl-8" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <LoadingState rows={3} label="Loading global sections" />
        ) : query.error ? (
          <ErrorState title="Global sections couldn’t be loaded" error={query.error} onRetry={() => void query.refetch()} />
        ) : shown.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            {usable.length === 0 ? 'No global sections for this yet.' : 'No global section matches your search.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Global sections">
            {shown.map((global) => (
              <li key={global.id} data-testid={`global-${global.id}`} className="flex flex-col gap-1.5 rounded-lg border bg-background p-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 truncate">{global.title}</span>
                </p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{usageText(global.usage_count)}</span>
                  <StatusBadge summary={global} />
                </p>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="outline" className="flex-1" aria-label={`Insert ${global.title}`} onClick={() => insert(global)}>
                    <PlusIcon aria-hidden /> Insert
                  </Button>
                  {commands.openGlobal && (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${global.title}`} title="Edit this global section" onClick={() => commands.openGlobal?.(global.id)}>
                      <PencilIcon />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The right panel while a global section reference is selected. */
export function GlobalRefPanel({ node }: { node: GlobalSectionRef }) {
  const commands = useCommands()
  const { globals, context = 'page' } = useEditorUi()
  const documentId = useEditor((s) => s.document.id)
  const list = useGlobalsQuery()
  const entry = globals?.get(node.ref)
  const summary = list.data?.find((g) => g.id === node.ref)
  const title = entry?.title || summary?.title || 'Global section'
  const others = (summary?.used_in ?? []).filter((u) => u.id !== documentId)
  const reason = unavailableReason(entry, context)
  const hidden = node.hidden === true

  return (
    <aside aria-label="Inspector" className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4" data-testid="global-ref-panel">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <GlobeIcon className="size-4" aria-hidden /> Global section
        </h2>
        <p className="text-sm font-medium break-words">{title}</p>
        {summary && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{usageText(summary.usage_count)}</span>
            <StatusBadge summary={summary} />
          </p>
        )}
      </div>
      {reason ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {reason}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Its content is edited in one place. Changes show on every page that uses it once you publish the global section.
          {others.length > 0 && ` Also on: ${usedInNames(others)}.`}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {!reason && commands.openGlobal && (
          <Button type="button" onClick={() => commands.openGlobal?.(node.ref)}>
            <PencilIcon aria-hidden /> Edit global section
          </Button>
        )}
        {!reason && commands.requestDetach && (
          <Button type="button" variant="outline" onClick={() => commands.requestDetach?.(node.id)}>
            <UnlinkIcon aria-hidden /> Detach from global
          </Button>
        )}
        <Button type="button" variant="outline" aria-pressed={hidden} onClick={() => commands.toggleHidden(node.id)}>
          {hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />} {hidden ? 'Show on this page' : 'Hide on this page'}
        </Button>
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => commands.requestDelete(node.id)}>
          <Trash2Icon aria-hidden /> Remove from this page
        </Button>
      </div>
      {!reason && <p className="text-xs text-muted-foreground">Detach turns it into a normal section of this page only; the other pages keep the global one.</p>}
    </aside>
  )
}

/** The strip above the canvas of a global's own document. */
export function GlobalDocBar() {
  const usage = useEditor((s) => s.document.usage)
  const context = useEditor((s) => s.document.context)
  const back = useBackTo()
  const count = usage?.usage_count ?? 0
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-blue-50 px-4 py-2 text-sm text-blue-950 dark:bg-blue-950/40 dark:text-blue-100" data-testid="global-usage-banner">
      <GlobeIcon className="size-4 shrink-0" aria-hidden />
      <p role="note" className="min-w-0 flex-1">
        <span className="font-medium">{usageText(count)}</span>
        {count > 0 && usage ? `: ${usedInNames(usage.used_in)}.` : '.'} When you publish, every {context === 'page' || !context ? 'page' : context} that uses it updates.
      </p>
      {back && (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/storefront/builder/${back.id}`}>
            <ArrowLeftIcon aria-hidden /> Back to {back.title}
          </Link>
        </Button>
      )}
    </div>
  )
}

const CONTEXT_LABEL: Record<GlobalContext, string> = { page: 'Pages, content pages and shop areas', header: 'The header', footer: 'The footer' }

/** The right panel of a global's own document while nothing is selected. */
export function GlobalDocPanel({ onOpenSiteStyles }: { onOpenSiteStyles: () => void }) {
  const document = useEditor((s) => s.document)
  const usage = document.usage
  const context = (document.context ?? 'page') as GlobalContext
  return (
    <aside aria-label="Inspector" className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-base font-semibold">Global section</h2>
        <p className="text-sm text-muted-foreground">Select something in the section to change it. It always has exactly one section.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="min-w-0 break-words">{document.title}</dd>
        <dt className="text-muted-foreground">Can be used on</dt>
        <dd>{CONTEXT_LABEL[context]}</dd>
        <dt className="text-muted-foreground">Last published</dt>
        <dd>{document.published ? `Version ${document.published.number}` : 'Not published yet'}</dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">{usageText(usage?.usage_count ?? 0)}</h3>
        {usage && usage.used_in.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {usage.used_in.map((u) => (
              <li key={u.id}>
                <Link to={`/storefront/builder/${u.id}`} className="underline underline-offset-2">
                  {u.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Add it to a {context === 'page' ? 'page' : context} from the Global tab of the editor.</p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">Changes are saved as a draft automatically. Shoppers see them on every page above once you publish.</p>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onOpenSiteStyles}>
        Site styles
      </Button>
    </aside>
  )
}
