import { useId, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import { EmptyState } from '@/components/common/state-views'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCan } from '@/features/auth/use-auth'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import { useApplyCategoriesMutation, useSuggestCategoriesMutation, type CategorySuggestion } from './api'
import { AI_HELP_PERMISSIONS, describeAiHelpError, MAX_CATEGORY_PRODUCTS, plural, skipReasonText } from './model'
import { AiHelpErrorAlert, ChosenList, ConfidenceBadge, type ChosenItem } from './parts'

type RowState = 'open' | 'applied' | 'skipped'

/*
 * Categories tab (contract §3): the AI suggests a category for products without one (or chosen
 * ones) from the shop's own category tree. Nothing changes until staff apply a suggestion; applying
 * is also a product edit, so it needs products.manage as well.
 */
export function CategorySuggestionsPanel() {
  const can = useCan()
  const id = useId()
  const canManage = can(AI_HELP_PERMISSIONS.manage)
  const canApply = canManage && can(AI_HELP_PERMISSIONS.applyCategory)
  const [which, setWhich] = useState<'missing' | 'chosen'>('missing')
  const [chosen, setChosen] = useState<ChosenItem[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const suggest = useSuggestCategoriesMutation()
  const apply = useApplyCategoriesMutation()

  const run = () => {
    setRows({})
    suggest.mutate(which === 'chosen' ? chosen.map((c) => c.id) : [])
  }

  const applyItems = (items: CategorySuggestion[]) => {
    const payload = items.flatMap((s) => (s.category ? [{ product_id: s.product.id, category_id: s.category.id }] : []))
    if (payload.length === 0) return
    apply.mutate(payload, {
      onSuccess: (result) => {
        setRows((current) => {
          const next = { ...current }
          for (const pid of result.applied) next[pid] = 'applied'
          for (const s of result.skipped) if (s.reason === 'unchanged') next[s.product_id] = 'applied'
          return next
        })
        if (result.applied.length > 0) toast.success(`Category set for ${plural(result.applied.length, 'product')}.`)
        for (const s of result.skipped) {
          const name = items.find((i) => i.product.id === s.product_id)?.product.name ?? 'A product'
          toast.message(`${name} was not changed: ${skipReasonText(s.reason)}.`)
        }
      },
      onError: (error) => toast.error(describeAiHelpError(error).message),
    })
  }

  const data = suggest.data
  const open = (data?.suggestions ?? []).filter((s) => (rows[s.product.id] ?? 'open') === 'open')
  const highOpen = open.filter((s) => s.confidence === 'high' && s.category)

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-base font-semibold">Suggest categories</h2>
          <p className="text-sm text-muted-foreground">
            The AI looks at product names, brands and options and picks the best fit from your own categories. Nothing changes until you apply a suggestion.
          </p>
        </div>
        {canManage ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Which products</legend>
              <div className="flex items-center gap-2">
                <input type="radio" id={`${id}-missing`} name={`${id}-which`} className="size-4 accent-primary" checked={which === 'missing'} onChange={() => setWhich('missing')} />
                <Label htmlFor={`${id}-missing`} className="font-normal">Products without a category (newest {MAX_CATEGORY_PRODUCTS})</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="radio" id={`${id}-chosen`} name={`${id}-which`} className="size-4 accent-primary" checked={which === 'chosen'} onChange={() => setWhich('chosen')} />
                <Label htmlFor={`${id}-chosen`} className="font-normal">Products I choose (up to {MAX_CATEGORY_PRODUCTS})</Label>
              </div>
            </fieldset>
            {which === 'chosen' && (
              <div className="flex flex-col gap-2 pl-6">
                <ChosenList label="Chosen products" items={chosen} onRemove={(pid) => setChosen(chosen.filter((c) => c.id !== pid))} />
                {chosen.length < MAX_CATEGORY_PRODUCTS && (
                  <ProductSearchAdder label="Add a product" exclude={chosen.map((c) => c.id)} onPick={(item) => setChosen([...chosen, { id: item.id, name: item.name }])} />
                )}
              </div>
            )}
            <div>
              <Button type="button" onClick={run} disabled={suggest.isPending || (which === 'chosen' && chosen.length === 0)}>
                {suggest.isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
                {suggest.isPending ? 'Suggesting…' : 'Suggest categories'}
              </Button>
            </div>
          </>
        ) : (
          <p role="note" className="text-sm text-muted-foreground">Ask someone who manages the online store to get category suggestions.</p>
        )}
      </section>

      <div aria-live="polite" aria-busy={suggest.isPending} className="flex flex-col gap-4">
        {suggest.isError ? (
          <AiHelpErrorAlert error={suggest.error} />
        ) : data && data.suggestions.length === 0 ? (
          <EmptyState title={which === 'missing' ? 'Every active product has a category.' : 'No suggestions'} description={which === 'missing' ? 'There is nothing to suggest right now.' : undefined} />
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {plural(data.suggestions.length, 'suggestion')}
                {data.categories_considered > 0 && ` · checked against ${plural(data.categories_considered, 'category', 'categories')}`}
              </p>
              {canApply && (
                <Button type="button" variant="outline" disabled={highOpen.length === 0 || apply.isPending} onClick={() => applyItems(highOpen)}>
                  <CheckIcon data-icon="inline-start" /> Apply all high-confidence ({highOpen.length})
                </Button>
              )}
            </div>
            {!canApply && canManage && <p role="note" className="text-sm text-muted-foreground">Ask someone who can edit products to apply these.</p>}
            <div className="overflow-x-auto rounded-md border">
              <Table aria-label="Category suggestions">
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Suggested category</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="hidden md:table-cell">Why</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.suggestions.map((s) => {
                    const state = rows[s.product.id] ?? 'open'
                    return (
                      <TableRow key={s.product.id} data-testid={`suggestion-${s.product.id}`}>
                        <TableCell>
                          <span className="font-medium">{s.product.name}</span>
                          {s.reason && <span className="mt-0.5 block max-w-56 text-xs whitespace-normal text-muted-foreground md:hidden">{s.reason}</span>}
                        </TableCell>
                        <TableCell>{s.category ? s.category.path : <span className="text-muted-foreground">No good match</span>}</TableCell>
                        <TableCell><ConfidenceBadge confidence={s.confidence} /></TableCell>
                        <TableCell className="hidden max-w-xs text-sm text-muted-foreground md:table-cell">{s.reason}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {state === 'applied' ? (
                            <span className="inline-flex items-center gap-1 text-sm"><CheckIcon className="size-4" aria-hidden /> Applied</span>
                          ) : state === 'skipped' ? (
                            <span className="text-sm text-muted-foreground">Skipped</span>
                          ) : (
                            <span className="inline-flex gap-2">
                              {canApply && s.category && (
                                <Button type="button" size="sm" disabled={apply.isPending} aria-label={`Apply ${s.category.path} to ${s.product.name}`} onClick={() => applyItems([s])}>
                                  Apply
                                </Button>
                              )}
                              <Button type="button" size="sm" variant="ghost" aria-label={`Skip ${s.product.name}`} onClick={() => setRows({ ...rows, [s.product.id]: 'skipped' })}>
                                Skip
                              </Button>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
