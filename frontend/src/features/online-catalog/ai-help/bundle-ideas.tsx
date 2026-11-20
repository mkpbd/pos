import { useId, useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, Loader2Icon, PlusIcon, SearchIcon, SparklesIcon } from 'lucide-react'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCan } from '@/features/auth/use-auth'
import { copyText } from '@/features/marketing/clipboard'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useApplyBundleMutation, useBundleIdeasQuery, useDescribeBundleMutation, type BundleIdea } from './api'
import { AI_HELP_PERMISSIONS, describeAiHelpError, LANGUAGE_LABELS, plural } from './model'
import { AiHelpErrorAlert, Thumb } from './parts'

/** A product can have up to 12 hand-picked "frequently bought together" products. */
const MAX_PICKS = 12

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDay = (day: string) => {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : dateFormat.format(date)
}

/*
 * Bundle ideas tab (contract §4): products often bought together in the same order (from the
 * nightly co-purchase run), not yet hand-picked. "Describe with AI" writes a title and a pitch to
 * copy (nothing saved); "Add to frequently bought together" adds the chosen ones to the product.
 */
export function BundleIdeasPanel() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const term = useDebouncedValue(search.trim())
  const ideas = useBundleIdeasQuery(term, page)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Products your shoppers often buy in the same order, which are not yet in the product’s “Frequently bought together” list.
        {ideas.data?.last_run && <> Based on orders up to {formatDay(ideas.data.last_run)}.</>}
      </p>
      <div className="relative w-full max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input aria-label="Search bundle ideas by product" placeholder="Search by product name" className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      {ideas.isPending ? (
        <LoadingState rows={4} label="Loading bundle ideas" />
      ) : ideas.isError ? (
        <ErrorState error={ideas.error} onRetry={() => ideas.refetch()} />
      ) : ideas.data.last_run === null ? (
        <EmptyState title="No bundle ideas yet" description="Ideas come from orders where products were bought together. They appear after the nightly check of your orders has run." />
      ) : ideas.data.items.length === 0 ? (
        <EmptyState title={term ? 'No bundle ideas match your search' : 'No new bundle ideas'} description={term ? 'Try another product name.' : 'Every product bought together often is already hand-picked.'} />
      ) : (
        <>
          <ul className="flex flex-col gap-4" aria-label="Bundle ideas">
            {ideas.data.items.map((idea) => <BundleCard key={`${idea.anchor.id}:${idea.products.map((p) => p.id).join(',')}`} idea={idea} />)}
          </ul>
          <PaginationBar pagination={ideas.data.pagination} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

function BundleCard({ idea }: { idea: BundleIdea }) {
  const id = useId()
  const can = useCan()
  const canManage = can(AI_HELP_PERMISSIONS.manage)
  const [picked, setPicked] = useState<string[]>(() => idea.products.map((p) => p.id))
  const describe = useDescribeBundleMutation()
  const apply = useApplyBundleMutation()
  const room = Math.max(0, MAX_PICKS - idea.frequently_bought_count)
  const chosen = idea.products.filter((p) => picked.includes(p.id))
  const titleId = `${id}-title`

  const add = () =>
    apply.mutate(
      { anchor_id: idea.anchor.id, product_ids: chosen.map((p) => p.id) },
      {
        onSuccess: (result) =>
          toast.success(result.added === 0 ? `${idea.anchor.name} already had these picks.` : `Added ${plural(result.added, 'product')} to “Frequently bought together” for ${idea.anchor.name}.`),
        onError: (error) => toast.error(describeAiHelpError(error).message),
      },
    )

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby={titleId} data-testid={`bundle-${idea.anchor.id}`}>
      <div className="flex items-center gap-3">
        <Thumb url={idea.anchor.image_url} />
        <div className="min-w-0">
          <h3 id={titleId} className="truncate font-semibold">{idea.anchor.name}</h3>
          <p className="text-xs text-muted-foreground">
            {idea.frequently_bought_count === 0 ? 'No hand-picked products yet' : `${plural(idea.frequently_bought_count, 'hand-picked product')} (up to ${MAX_PICKS})`}
          </p>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Often bought with it</legend>
        {idea.products.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            {canManage && (
              <Checkbox
                id={`${id}-${p.id}`}
                checked={picked.includes(p.id)}
                onCheckedChange={(v) => setPicked(v === true ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
              />
            )}
            <Thumb url={p.image_url} />
            <Label htmlFor={canManage ? `${id}-${p.id}` : undefined} className="flex min-w-0 flex-col items-start gap-0 font-normal">
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground">Bought together in {plural(p.orders_together, 'order')}</span>
            </Label>
          </div>
        ))}
      </fieldset>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={chosen.length === 0 || describe.isPending} onClick={() => describe.mutate({ anchor_id: idea.anchor.id, product_ids: chosen.map((p) => p.id) })}>
            {describe.isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
            {describe.isPending ? 'Writing…' : 'Describe with AI'}
          </Button>
          <Button type="button" size="sm" disabled={chosen.length === 0 || chosen.length > room || apply.isPending} onClick={add}>
            <PlusIcon data-icon="inline-start" /> Add to frequently bought together
          </Button>
        </div>
      )}
      {canManage && chosen.length > room && (
        <p className="text-sm text-muted-foreground">{room === 0 ? `${idea.anchor.name} already has ${MAX_PICKS} hand-picked products. Remove some on its listing first.` : `There is room for ${plural(room, 'more product')}. Untick some.`}</p>
      )}

      <div aria-live="polite" aria-busy={describe.isPending}>
        {describe.isError ? (
          <AiHelpErrorAlert error={describe.error} />
        ) : describe.data && describe.data.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3" data-testid="bundle-text">
            {describe.data.map((text) => (
              <div key={text.language} lang={text.language} className="flex flex-col gap-1">
                {describe.data.length > 1 && <p className="text-xs font-medium text-muted-foreground" lang="en">{LANGUAGE_LABELS[text.language]}</p>}
                <p className="font-medium">{text.title}</p>
                <p className="text-sm">{text.pitch}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  lang="en"
                  aria-label={`Copy the ${text.language === 'bn' ? 'Bangla' : 'English'} title and pitch`}
                  onClick={() => void copyText(`${text.title}\n${text.pitch}`, 'Title and pitch copied.')}
                >
                  <CopyIcon data-icon="inline-start" /> Copy
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Written by AI from the product names. Nothing is saved — copy it into a banner, post or page.</p>
          </div>
        ) : null}
      </div>
    </li>
  )
}
