import { FlaskConicalIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useCommands, useEditorUi } from '../commands'
import { useEditor, useEditorStoreApi } from '../store'
import type { NodeKind } from '../tree'
import { useExperimentsUi } from './experiments-context'
import { armOf, createTest, findExperiment, testReason } from './experiments-model'
import { testNameFor } from './test-name'

/*
 * B13: the A/B test item of a section's ⋯ menu (canvas mini toolbar and Layers): "Test a different
 * version" (version B = a copy right after it, a draft test, the panel opens), or "Open A/B test"
 * for a section that is already in one.
 */

export function ExperimentMenuItems({ id, kind }: { id: string; kind: NodeKind }) {
  const ui = useExperimentsUi()
  const store = useEditorStoreApi()
  const documentKind = useEditor((s) => s.document.kind)
  const { single = false } = useEditorUi()
  const commands = useCommands()
  if (!ui || kind !== 'section') return null
  const content = store.getState().content
  const section = content.sections.find((s) => s.id === id)
  const arm = armOf(section)
  const experiment = arm ? findExperiment(content, arm.id) : null

  if (arm && experiment) {
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ui.openTest(experiment.id)} data-testid="open-ab-test">
          <FlaskConicalIcon />
          <span className="flex flex-col">
            Open A/B test
            <span className="text-xs text-muted-foreground">“{experiment.name}”, version {arm.arm}</span>
          </span>
        </DropdownMenuItem>
      </>
    )
  }

  const reason = testReason(content, id, { kind: documentKind, single })
  const start = () => {
    const state = store.getState()
    const result = createTest(state.content, id, testNameFor(state.content, id))
    if (!result) return
    if (!state.apply(() => result.content, { select: result.copyId })) return
    ui.pick(result.experimentId, 'B')
    ui.openTest(result.experimentId)
    commands.reveal(result.copyId)
    toast.success('Version B is a copy of the section, right below it. Change it, then start the test.')
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={reason !== null} onSelect={start} data-testid="test-different-version">
        <FlaskConicalIcon />
        <span className="flex flex-col">
          Test a different version
          <span className="text-xs text-muted-foreground">{reason ?? 'Show half your shoppers a changed copy and see which sells more.'}</span>
        </span>
      </DropdownMenuItem>
    </>
  )
}
