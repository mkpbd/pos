import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Element, WrappedElement } from '@/storefront/builder/types'
import { B4Form } from './b4-forms'
import { errorMap } from './errors'
import { finishSetup, getSetupSnapshot, newSetupHostId, registerSetupHost, subscribeSetup, type SetupRequest } from './setup-store'
import { B6Form } from './b6-forms'
import { B4_TYPES, B6_TYPES, validateNode } from './validate'
import { WrappedSectionForm } from './wrapped-form'

function SetupForm({ request, canCustomHtml, documentId }: { request: SetupRequest; canCustomHtml: boolean; documentId?: string }) {
  const [node, setNode] = useState<Element>(request.node)
  const problems = validateNode(node)
  const label = request.label.toLowerCase()
  const errors = errorMap(node, problems, [])
  const b4 = B4_TYPES.has(node.type)
  const b6 = B6_TYPES.has(node.type)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add {label}</DialogTitle>
        <DialogDescription>Choose what the {label} shows. You can change everything later in the panel on the right.</DialogDescription>
      </DialogHeader>
      {b6 ? (
        <B6Form node={node} onChange={(next) => setNode(next as Element)} errors={errors} bangla={false} context={request.context} setup />
      ) : b4 ? (
        // Only the fields still missing are marked; everything else can be changed later too.
        <B4Form node={node} onChange={(next) => setNode(next as Element)} errors={errors} bangla={false} context={request.context} canCustomHtml={canCustomHtml} />
      ) : (
        <WrappedSectionForm
          node={node as WrappedElement}
          onChange={(next) => setNode(next as WrappedElement)}
          errors={errors}
          bangla={false}
          documentId={documentId}
          // A banner edited here is saved for this page; a copy replaces the original in the new element.
          onCommand={(command) => {
            if (command.type !== 'banner-edited' || !command.replaced) return
            const { old_id, new_id } = command.replaced
            setNode((current) => {
              const props = (current as WrappedElement).props
              return { ...current, props: { ...props, items: props.items.map((item) => (item.item_type === 'banner' && item.item_id === old_id ? { ...item, item_id: new_id } : item)) } } as Element
            })
          }}
        />
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => finishSetup(null)}>Cancel</Button>
        <Button type="button" disabled={problems.length > 0} title={problems.length > 0 ? 'Complete the highlighted fields first.' : undefined} onClick={() => finishSetup(node)}>
          Insert
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * Renders createElement()'s setup dialog. The Inspector mounts one; with several mounted only
 * the first renders.
 */
export function ElementSetupHost({ canCustomHtml = false, documentId }: { canCustomHtml?: boolean; documentId?: string }) {
  const [hostId] = useState(newSetupHostId)
  const snapshot = useSyncExternalStore(subscribeSetup, getSetupSnapshot, getSetupSnapshot)

  useEffect(() => registerSetupHost(hostId), [hostId])

  const request = snapshot.host === hostId ? snapshot.request : null

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && finishSetup(null)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {request && <SetupForm key={request.node.id} request={request} canCustomHtml={canCustomHtml} documentId={documentId} />}
      </DialogContent>
    </Dialog>
  )
}
