import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WrappedElement } from '@/storefront/builder/types'
import { errorMap } from './errors'
import { finishSetup, getSetupSnapshot, newSetupHostId, registerSetupHost, subscribeSetup, type SetupRequest } from './setup-store'
import { validateNode } from './validate'
import { WrappedSectionForm } from './wrapped-form'

function SetupForm({ request }: { request: SetupRequest }) {
  const [node, setNode] = useState<WrappedElement>(request.node)
  const problems = validateNode(node)
  const label = request.label.toLowerCase()

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add {label}</DialogTitle>
        <DialogDescription>Choose what the {label} shows. You can change everything later in the panel on the right.</DialogDescription>
      </DialogHeader>
      <WrappedSectionForm node={node} onChange={(next) => setNode(next as WrappedElement)} errors={errorMap(node, problems, [])} bangla={false} />
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
export function ElementSetupHost() {
  const [hostId] = useState(newSetupHostId)
  const snapshot = useSyncExternalStore(subscribeSetup, getSetupSnapshot, getSetupSnapshot)

  useEffect(() => registerSetupHost(hostId), [hostId])

  const request = snapshot.host === hostId ? snapshot.request : null

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && finishSetup(null)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {request && <SetupForm key={request.node.id} request={request} />}
      </DialogContent>
    </Dialog>
  )
}
