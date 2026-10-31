import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FormField } from '@/components/common/form-field'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDeleteFaqMutation, useFaqQuery, useReorderFaqMutation, useSaveFaqMutation, type FaqItem } from '@/features/content/api'
import { ContentHeader } from '@/features/content/components/content-header'
import { RichTextEditor } from '@/features/content/components/rich-text-editor'
import { fieldErrorMap } from '@/lib/forms'

/** Mounted inside DialogContent, so each opening starts from the entry (or empty). */
function FaqForm({ item, onDone }: { item: FaqItem | null; onDone: () => void }) {
  const save = useSaveFaqMutation()
  const [question, setQuestion] = useState(item?.question ?? '')
  const [answer, setAnswer] = useState(item?.answer_html ?? '')
  const [group, setGroup] = useState(item?.group ?? '')
  const [active, setActive] = useState(item?.is_active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!question.trim()) local.question = 'Enter the question.'
    if (!answer) local.answer_html = 'Enter the answer.'
    if (Object.keys(local).length > 0) return setErrors(local)

    save.mutate(
      { id: item?.id, input: { question: question.trim(), answer_html: answer, group: group.trim() || null, is_active: active } },
      {
        onSuccess: () => {
          toast.success(item ? 'Entry saved.' : 'Entry added.')
          onDone()
        },
        onError: (error) => setErrors(fieldErrorMap(error)),
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{item ? 'Edit FAQ entry' : 'New FAQ entry'}</DialogTitle>
        <DialogDescription>Shown on pages with the FAQ layout, grouped by topic.</DialogDescription>
      </DialogHeader>
      <FormField label="Question" error={errors.question}>
        <Input maxLength={255} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </FormField>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="faq-answer">Answer</Label>
        <RichTextEditor id="faq-answer" label="Answer" value={answer} onChange={setAnswer} invalid={!!errors.answer_html} />
        {errors.answer_html && <p className="text-sm text-destructive">{errors.answer_html}</p>}
      </div>
      <FormField label="Topic" hint="Optional, e.g. Delivery. Entries without a topic come first.">
        <Input maxLength={80} value={group} onChange={(e) => setGroup(e.target.value)} />
      </FormField>
      <div className="flex items-center gap-2">
        <Switch id="faq-active" checked={active} onCheckedChange={setActive} />
        <Label htmlFor="faq-active">Shown in the store</Label>
      </div>
      {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />} {item ? 'Save entry' : 'Add entry'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function FaqPage() {
  const faq = useFaqQuery()
  const reorder = useReorderFaqMutation()
  const remove = useDeleteFaqMutation()
  const [editing, setEditing] = useState<FaqItem | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<FaqItem | null>(null)

  const move = (items: FaqItem[], index: number, direction: -1 | 1) => {
    const ids = items.map((i) => i.id)
    const [moved] = ids.splice(index, 1)
    if (moved) ids.splice(index + direction, 0, moved)
    reorder.mutate(ids, { onError: (e) => toast.error(e.message) })
  }

  return (
    <div className="flex flex-col gap-6">
      <ContentHeader actions={<Button onClick={() => setEditing(null)}><PlusIcon data-icon="inline-start" /> New entry</Button>} />

      <Card>
        <CardHeader>
          <CardTitle>Frequently asked questions</CardTitle>
          <CardDescription>Create a page with the FAQ layout to show these entries in the store.</CardDescription>
        </CardHeader>
        <CardContent>
          {faq.isPending ? (
            <LoadingState label="Loading FAQ" />
          ) : faq.error ? (
            <ErrorState error={faq.error} onRetry={() => faq.refetch()} />
          ) : faq.data.length === 0 ? (
            <EmptyState title="No entries yet" description="Answer the questions customers ask most: delivery, payment, returns." />
          ) : (
            <ol className="flex flex-col divide-y" aria-label="FAQ entries">
              {faq.data.map((item, i) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.question}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.group && <Badge variant="outline">{item.group}</Badge>}
                      {!item.is_active && <Badge variant="soft">Hidden</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon-sm" aria-label={`Move "${item.question}" up`} disabled={i === 0 || reorder.isPending} onClick={() => move(faq.data, i, -1)}><ArrowUpIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Move "${item.question}" down`} disabled={i === faq.data.length - 1 || reorder.isPending} onClick={() => move(faq.data, i, 1)}><ArrowDownIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit "${item.question}"`} onClick={() => setEditing(item)}><PencilIcon /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete "${item.question}"`} onClick={() => setDeleting(item)}><Trash2Icon /></Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing !== undefined && <FaqForm item={editing} onDone={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this entry?"
        description={deleting?.question}
        confirmLabel="Delete entry"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Entry deleted.')
              setDeleting(null)
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </div>
  )
}
