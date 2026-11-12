import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Loader2Icon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { DocumentContext } from '@/storefront/builder/types'
import type { Dragged } from '../drop-targets'
import { useDeleteTemplateMutation, useTemplatesQuery, type BuilderTemplate } from './api'
import { categoryLabel, filterTemplates, PRESET_LABELS, templateCategories, usableIn, type TemplateFilter } from './model'
import { TemplateThumbnail } from './template-thumbnail'
import type { TemplateInserter } from './use-insert-template'

/*
 * The Templates tab of the editor (B5): ready-made sections and pages for this kind of document
 * (`allowed_in`), filtered by All / this theme's look / Mine, by category and by words. Insert
 * adds a template after the selection (or at the end); its picture can also be dragged onto the
 * canvas like an element. Own templates can be deleted here.
 */

const isPreset = (value: string | null | undefined): value is keyof typeof PRESET_LABELS => value === 'vegan' || value === 'handmade' || value === 'classic'

function TemplateCard({ template, pending, disabled, onInsert, onDelete }: { template: BuilderTemplate; pending: boolean; disabled: boolean; onInsert: () => void; onDelete?: () => void }) {
  const dragged: Dragged = { kind: 'template', id: template.id, type: 'section', name: template.name }
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: `template:${template.id}`, data: { dragged }, disabled })
  // Pointer drags only; keyboard users use the Insert button.
  const { onKeyDown: _keyboardDrag, ...pointerListeners } = listeners ?? {}
  return (
    <li data-testid={`template-${template.id}`} className={cn('flex flex-col gap-2 rounded-lg border bg-background p-2', isDragging && 'opacity-50')}>
      <div ref={setNodeRef} {...pointerListeners} title="Drag onto the page" className={cn('touch-none', disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing')}>
        <TemplateThumbnail template={template} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{template.name}</span>
          {template.scope === 'page' && <Badge variant="soft" className="shrink-0">Whole page</Badge>}
        </p>
        {template.description && (
          <p className="truncate text-xs text-muted-foreground" title={template.description}>
            {template.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant="outline" className="flex-1" disabled={disabled} aria-label={`Insert ${template.name}`} onClick={onInsert}>
          {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <PlusIcon aria-hidden />}
          {pending ? 'Adding…' : 'Insert'}
        </Button>
        {onDelete && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Delete template ${template.name}`} title="Delete this template" onClick={onDelete}>
            <Trash2Icon />
          </Button>
        )}
      </div>
    </li>
  )
}

function FilterButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        pressed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function TemplatesPanel({ context, currentPreset, inserter, enabled = true }: { context: DocumentContext; currentPreset: string | null | undefined; inserter: TemplateInserter; enabled?: boolean }) {
  const query = useTemplatesQuery(context, enabled)
  const remove = useDeleteTemplateMutation()
  const [filter, setFilter] = useState<TemplateFilter>('all')
  const [category, setCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<BuilderTemplate | null>(null)

  const usable = useMemo(() => usableIn(query.data ?? [], context), [query.data, context])
  const preset = isPreset(currentPreset) ? currentPreset : null
  const hasLook = preset !== null && usable.some((t) => t.preset === preset)
  const effectiveFilter: TemplateFilter = filter === 'look' && !hasLook ? 'all' : filter
  const scoped = useMemo(() => filterTemplates(usable, { filter: effectiveFilter, preset, category: null, search: '' }), [usable, effectiveFilter, preset])
  const categories = useMemo(() => templateCategories(scoped), [scoped])
  const effectiveCategory = category && categories.includes(category) ? category : null
  const shown = useMemo(() => filterTemplates(scoped, { filter: 'all', preset: null, category: effectiveCategory, search }), [scoped, effectiveCategory, search])
  const sections = shown.filter((t) => t.scope === 'section')
  const pages = shown.filter((t) => t.scope === 'page')

  const list = (items: BuilderTemplate[]) => (
    <ul className="flex flex-col gap-3">
      {items.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          pending={inserter.pendingId === template.id}
          disabled={inserter.pendingId !== null}
          onInsert={() => void inserter.insert(template)}
          onDelete={template.source === 'mine' ? () => setDeleting(template) : undefined}
        />
      ))}
    </ul>
  )

  let body
  if (query.isPending) body = <LoadingState rows={3} label="Loading templates" />
  else if (query.error) body = <ErrorState title="Templates couldn’t be loaded" error={query.error} onRetry={() => void query.refetch()} />
  else if (shown.length === 0) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {search.trim()
          ? `No template matches “${search.trim()}”.`
          : effectiveFilter === 'mine'
            ? 'You haven’t saved any sections yet. Select a section, then choose “Save as template” in its toolbar or in Layers.'
            : 'No templates fit here yet.'}
      </p>
    )
  } else {
    body = (
      <>
        {sections.length > 0 && (
          <section aria-label="Section templates" className="mb-4">
            {pages.length > 0 && (
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Sections
              </h3>
            )}
            {list(sections)}
          </section>
        )}
        {pages.length > 0 && (
          <section aria-label="Page templates" className="mb-4">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Whole pages
            </h3>
            {list(pages)}
          </section>
        )}
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="templates-panel">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div role="group" aria-label="Show templates" className="flex gap-0.5 rounded-md bg-muted p-0.5">
          <FilterButton pressed={effectiveFilter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterButton>
          {hasLook && (
            <FilterButton pressed={effectiveFilter === 'look'} onClick={() => setFilter('look')}>
              {`${PRESET_LABELS[preset]} look`}
            </FilterButton>
          )}
          <FilterButton pressed={effectiveFilter === 'mine'} onClick={() => setFilter('mine')}>
            Mine
          </FilterButton>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="pl-8" />
        </div>
        {categories.length > 1 && (
          <select
            aria-label="Category"
            value={effectiveCategory ?? ''}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">Insert adds a template after the selected section. You can also drag its picture onto the page.</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{body}</div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the template “${deleting?.name ?? ''}”?`}
        description="It is removed from your templates. Pages where you already used it keep their sections."
        confirmLabel="Delete template"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return
          const name = deleting.name
          remove.mutate(deleting.id, {
            onSuccess: () => toast.success(`Template “${name}” deleted.`),
            onError: (error) => toast.error(error.message),
          })
          setDeleting(null)
        }}
      />
    </div>
  )
}
