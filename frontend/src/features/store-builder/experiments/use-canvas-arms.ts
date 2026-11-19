import { useCallback, useMemo } from 'react'
import type { RenderSection } from '@/storefront/builder/types'
import { useCommands } from '../commands'
import { useEditor, useEditorStoreApi } from '../store'
import type { ArmSwitchLayer, ArmSwitchTest } from './arm-switchers'
import { useExperimentsUi } from './experiments-context'
import { armOfNode, armSections, experimentsOf, showArms, shownArms, type ExperimentArm } from './experiments-model'

/*
 * B13: what the canvas draws of the A/B tests — one version per test (the one picked, else the
 * one holding the selection, else A / the winner), and the "Showing version A | B" switches.
 * The canvas draws every section it is sent; leaving the other version out happens here.
 */

export function useCanvasArms(sections: RenderSection[]): { sections: RenderSection[]; layer: ArmSwitchLayer | null } {
  const ui = useExperimentsUi()
  const store = useEditorStoreApi()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const commands = useCommands()
  const picked = ui?.picked
  const pick = ui?.pick
  const shown = useMemo(() => shownArms(content, picked ?? {}, selection), [content, picked, selection])
  const drawn = useMemo(() => showArms(sections, content, shown), [sections, content, shown])

  const onShow = useCallback(
    (experimentId: string, arm: ExperimentArm) => {
      pick?.(experimentId, arm)
      const state = store.getState()
      const selected = armOfNode(state.content, state.selection)
      // The selection inside the other version would keep that one on the canvas: move it over.
      if (selected?.id === experimentId && selected.arm !== arm) {
        const first = armSections(state.content, experimentId)[arm][0]
        if (first) {
          state.select(first)
          commands.reveal(first)
        }
      }
    },
    [pick, store, commands],
  )

  const layer = useMemo<ArmSwitchLayer | null>(() => {
    if (!ui) return null
    const tests: ArmSwitchTest[] = []
    for (const experiment of experimentsOf(content)) {
      const arms = armSections(content, experiment.id)
      if (arms.A.length === 0 && arms.B.length === 0) continue
      const arm = shown[experiment.id] ?? 'A'
      tests.push({ id: experiment.id, name: experiment.name, shown: arm, ids: arms[arm], has: { A: arms.A.length > 0, B: arms.B.length > 0 } })
    }
    return tests.length > 0 ? { tests, onShow } : null
  }, [ui, content, shown, onShow])

  return { sections: drawn, layer }
}
