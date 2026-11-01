import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/features/auth/use-auth'
import {
  useDeleteSectionMutation,
  useDuplicateSectionMutation,
  useReorderSectionsMutation,
  useSaveSectionMutation,
  useSectionsQuery,
  useSectionTypesQuery,
  type HomepageSection,
  type SectionState,
  type SectionConfigs,
  type SectionTypeInfo,
} from '@/features/storefront/api'
import { HotDealsSummary } from '@/features/storefront/components/hot-deals-fields'
import { BlogPostsSummary } from '@/features/storefront/components/blog-posts-fields'
import { SectionEditor } from '@/features/storefront/components/section-editor'
import { StorefrontHeader } from '@/features/storefront/components/storefront-header'

const STATE: Record<SectionState, { label: string; variant: 'success' | 'soft' | 'info' | 'warning' }> = {
  live: { label: 'Live', variant: 'success' },
  disabled: { label: 'Hidden', variant: 'soft' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  expired: { label: 'Ended', variant: 'warning' },
}

function TypePicker({ types, onPick }: { types: SectionTypeInfo[]; onPick: (info: SectionTypeInfo) => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a section</DialogTitle>
        <DialogDescription>New sections go to the end of the homepage; move them where you want afterwards.</DialogDescription>
      </DialogHeader>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Section types">
        {types.map((t) => (
          <li key={t.type}>
            <button type="button" onClick={() => onPick(t)} className="flex h-full w-full flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span className="font-medium">{t.label}</span>
              <span className="text-sm text-muted-foreground">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function SectionRow({ section, index, count, canManage, onMove, onEdit, onDelete }: {
  section: HomepageSection
  index: number
  count: number
  canManage: boolean
  onMove: (direction: -1 | 1) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const save = useSaveSectionMutation()
  const duplicate = useDuplicateSectionMutation()
  const name = section.title ?? section.type_label
  const state = STATE[section.state]
  const itemCount = section.item_ids?.length ?? 0

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium" aria-hidden>{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-sm text-muted-foreground">
          {section.type_label}
          {section.banner_ids.length > 0 && ` · ${section.banner_ids.length} banner${section.banner_ids.length === 1 ? '' : 's'}`}
          {itemCount > 0 && ` · ${itemCount} hand-picked`}
          {section.type === 'hot_deals' && <HotDealsSummary config={section.config as SectionConfigs['hot_deals']} />}
          {section.type === 'blog_posts' && <BlogPostsSummary config={section.config as SectionConfigs['blog_posts']} />}
        </p>
      </div>
      <Badge variant={state.variant}>{state.label}</Badge>
      {canManage && (
        <div className="flex items-center gap-1">
          <Switch
            aria-label={`Show ${name}`}
            checked={section.is_enabled}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate({ id: section.id, input: { is_enabled: v } }, { onError: (e) => toast.error(e.message) })}
          />
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUpIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDownIcon /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${name}`} onClick={onEdit}><PencilIcon /></Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Duplicate ${name}`}
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate(section.id, { onSuccess: () => toast.success('Copy added below, hidden until you switch it on.'), onError: (e) => toast.error(e.message) })}
          >
            <CopyIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} onClick={onDelete}><Trash2Icon /></Button>
        </div>
      )}
    </li>
  )
}

export function HomepagePage() {
  const can = useCan()
  const canManage = can('storefront.manage')
  const sections = useSectionsQuery()
  const types = useSectionTypesQuery()
  const reorder = useReorderSectionsMutation()
  const remove = useDeleteSectionMutation()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ info: SectionTypeInfo; section?: HomepageSection } | null>(null)
  const [deleting, setDeleting] = useState<HomepageSection | null>(null)
  const infoOf = (type: string) => types.data?.find((t) => t.type === type)

  const move = (list: HomepageSection[], index: number, direction: -1 | 1) => {
    const ids = list.map((s) => s.id)
    const [moved] = ids.splice(index, 1)
    if (moved) ids.splice(index + direction, 0, moved)
    reorder.mutate(ids, { onError: (e) => toast.error(e.message) })
  }

  return (
    <div className="flex flex-col gap-6">
      <StorefrontHeader />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Homepage sections</CardTitle>
            <CardDescription>Shown from top to bottom. Hidden, scheduled and empty sections are skipped; the preview shows them in place.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <a href="/?preview=1" target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" /> Preview</a>
            </Button>
            {canManage && <Button onClick={() => setAdding(true)} disabled={!types.data}><PlusIcon data-icon="inline-start" /> Add section</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {sections.isPending ? (
            <LoadingState label="Loading sections" />
          ) : sections.error ? (
            <ErrorState error={sections.error} onRetry={() => sections.refetch()} />
          ) : sections.data.length === 0 ? (
            <EmptyState title="The homepage has no sections yet" description="Add a hero slider, banners, products, flash-sale deals, categories, brands, blog posts, text, features, testimonials or a newsletter sign-up." />
          ) : (
            <ol className="flex flex-col divide-y" aria-label="Homepage sections">
              {sections.data.map((s, i) => (
                <SectionRow
                  key={s.id}
                  section={s}
                  index={i}
                  count={sections.data.length}
                  canManage={canManage && !reorder.isPending}
                  onMove={(direction) => move(sections.data, i, direction)}
                  onEdit={() => {
                    const info = infoOf(s.type)
                    if (info) setEditing({ info, section: s })
                  }}
                  onDelete={() => setDeleting(s)}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-2xl">
          {types.data && (
            <TypePicker
              types={types.data}
              onPick={(info) => {
                setAdding(false)
                setEditing({ info })
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          {editing && <SectionEditor info={editing.info} section={editing.section} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this section?"
        description="Its banners stay in the banner list."
        confirmLabel="Delete section"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Section deleted.')
              setDeleting(null)
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
