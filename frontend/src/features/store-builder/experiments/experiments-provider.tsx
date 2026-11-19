import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { builderAdminKeys } from '../api'
import { useEditorStoreApi } from '../store'
import { experimentKeys, runExperimentAction, type ExperimentAction } from './experiments-api'
import { actionError, ExperimentsContext, type ExperimentAutosave, type ExperimentsUi } from './experiments-context'
import type { ExperimentArm } from './experiments-model'

/*
 * B13: holds the A/B test state for the editor. A server action saves pending edits first, then
 * the server writes the draft and the editor loads it (like restoring a version: the undo history
 * starts again there).
 */

const DONE: Record<'start' | 'stop', string> = {
  start: 'The test starts when you publish. Shoppers are then split between version A and version B.',
  stop: 'The test stops when you publish. Until you keep a version, every shopper sees version A.',
}

export function ExperimentsProvider({ autosave, children }: { autosave: ExperimentAutosave; children: ReactNode }) {
  const store = useEditorStoreApi()
  const queryClient = useQueryClient()
  const [open, setOpenState] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, ExperimentArm>>({})
  const [pending, setPending] = useState<string | null>(null)
  const beforeOpen = useRef<(() => void) | null>(null)

  const setOpen = useCallback((next: boolean) => {
    if (next) beforeOpen.current?.()
    else setFocusId(null)
    setOpenState(next)
  }, [])
  const openTest = useCallback((experimentId: string | null) => {
    beforeOpen.current?.()
    setFocusId(experimentId)
    setOpenState(true)
  }, [])
  const setBeforeOpen = useCallback((run: (() => void) | null) => {
    beforeOpen.current = run
  }, [])
  const pick = useCallback((experimentId: string, arm: ExperimentArm) => setPicked((current) => (current[experimentId] === arm ? current : { ...current, [experimentId]: arm })), [])

  const run = useCallback(
    async (experimentId: string, action: ExperimentAction): Promise<boolean> => {
      setPending(`${experimentId}:${action.kind}`)
      try {
        if (!(await autosave.flush())) {
          toast.error('Your latest changes aren’t saved yet. Wait for “Saved”, then try again.')
          return false
        }
        const state = store.getState()
        const detail = await runExperimentAction(state.document.id, experimentId, state.revision, action)
        autosave.reset()
        store.getState().load(detail)
        if (action.kind === 'keep') {
          setPicked(({ [experimentId]: _gone, ...rest }) => rest)
          toast.success(`Version ${action.arm} kept. The other version is gone from the draft — publish to make it live.`)
        } else toast.success(DONE[action.kind])
        void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
        void queryClient.invalidateQueries({ queryKey: experimentKeys.all })
        return true
      } catch (error) {
        toast.error(actionError(error))
        return false
      } finally {
        setPending(null)
      }
    },
    [autosave, store, queryClient],
  )

  const value = useMemo<ExperimentsUi>(() => ({ open, setOpen, openTest, focusId, setBeforeOpen, picked, pick, run, pending }), [open, setOpen, openTest, focusId, setBeforeOpen, picked, pick, run, pending])
  return <ExperimentsContext value={value}>{children}</ExperimentsContext>
}
