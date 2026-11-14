import { useEffect, useId, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api/client'
import type { Section } from '@/storefront/builder/types'
import { useCan } from '@/features/auth/use-auth'
import { fetchDocument, publishDocument } from './api'
import { nodeSummary, useEditorUi } from './commands'
import { createGlobal, entryFromDetail, globalKeys } from './global-api'
import { detachGlobal, GLOBAL_CONTEXT_WORDS, globalContextFor, globalRefOf, makeGlobal, sectionForGlobal } from './global-sections'
import { useEditor, useEditorStoreApi } from './store'
import { findNode } from './tree'

/*
 * B9: "Make global" (a section of this draft becomes a global section, and this page shows it by
 * reference) and "Detach" (a reference becomes an ordinary section again, a copy of the global).
 * Both are one undo step on this draft.
 */

const TITLE_MAX = 160

export function MakeGlobalDialog({ sectionId, onClose }: { sectionId: string | null; onClose: () => void }) {
  const store = useEditorStoreApi()
  const queryClient = useQueryClient()
  const { registry, context = 'page' } = useEditorUi()
  const content = useEditor((s) => s.content)
  const info = findNode(content, sectionId)
  const section = info?.kind === 'section' && !globalRefOf(info.node) ? (info.node as Section) : null
  const open = sectionId !== null && section !== null
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inputId = useId()
  const helpId = useId()
  const errorId = useId()
  const globalContext = globalContextFor(context)
  const canPublish = useCan()('storefront.publish')

  // A fresh name each time the dialog opens: what the section starts with.
  useEffect(() => {
    if (!open || !section) return
    setName((nodeSummary(section, registry) ?? 'Section').slice(0, 60))
    setProblem(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sectionId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const title = name.trim()
    if (!title) {
      setProblem('Enter a name.')
      return
    }
    const current = store.getState()
    const latest = findNode(current.content, sectionId)
    if (!latest || latest.kind !== 'section' || !globalContext) return
    setPending(true)
    try {
      const created = await createGlobal({ title, context: globalContext, section: sectionForGlobal(latest.node as Section) })
      // The canvas draws the reference from this draft at once.
      queryClient.setQueryData(globalKeys.content(created.id), created)
      store.getState().apply((c) => makeGlobal(c, latest.node.id, created.id), { select: latest.node.id })
      // Published at once (no page shows it live yet), so publishing this page later doesn't lose the section.
      let live = false
      if (canPublish) {
        try {
          await publishDocument(created.id, null)
          live = true
        } catch {
          live = false
        }
      }
      void queryClient.invalidateQueries({ queryKey: globalKeys.list })
      const where = GLOBAL_CONTEXT_WORDS[globalContext]
      if (live) toast.success(`“${created.title}” is now a global section. Add it to other ${where} from the Global tab.`)
      else toast.warning(`“${created.title}” is now a global section, but it isn’t published yet. Shoppers see it only after someone publishes it.`)
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.code === 'DOCUMENT_INVALID') setProblem('Something in this section isn’t finished (it is marked in red). Fix it first, then try again.')
      else setProblem(error instanceof Error ? error.message : 'It couldn’t be made global. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Make this section global</DialogTitle>
            <DialogDescription>
              A global section is kept in one place and can be added to many {globalContext ? GLOBAL_CONTEXT_WORDS[globalContext] : 'pages'}. When you change and publish it, every place that uses it updates.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              value={name}
              maxLength={TITLE_MAX}
              autoFocus
              aria-describedby={problem ? `${helpId} ${errorId}` : helpId}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => {
                setName(event.target.value)
                setProblem(null)
              }}
            />
            <p id={helpId} className="text-xs text-muted-foreground">Only you and your team see this name, for example “Free delivery strip”.</p>
            {problem && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />} Make global
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DetachConfirm({ refId, onClose }: { refId: string | null; onClose: () => void }) {
  const store = useEditorStoreApi()
  const { globals } = useEditorUi()
  const content = useEditor((s) => s.content)
  const node = globalRefOf(findNode(content, refId)?.node)
  const title = node ? globals?.get(node.ref)?.title : undefined
  const [pending, setPending] = useState(false)

  const detach = async () => {
    if (!node) return
    setPending(true)
    try {
      let entry = globals?.get(node.ref)
      if (!entry || entry.state !== 'ready') entry = entryFromDetail(await fetchDocument(node.ref))
      const section = entry.section
      if (!section) throw new Error('The global section couldn’t be read.')
      store.getState().apply((c) => detachGlobal(c, node.id, section), { select: node.id })
      toast.success('Detached. This section is now part of this page only.')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'It couldn’t be detached. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <ConfirmDialog
      open={node !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
      title={title ? `Detach “${title}”?` : 'Detach this global section?'}
      description="It becomes a normal section of this page that you can change here. Later changes to the global section won’t show here, and other pages keep using the global one. You can undo this."
      confirmLabel="Detach"
      destructive={false}
      pending={pending}
      onConfirm={() => void detach()}
    />
  )
}
