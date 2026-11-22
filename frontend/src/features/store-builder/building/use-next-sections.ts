import { useMemo } from 'react'
import type { CommandItem } from '../command-model'
import { useEditorUi } from '../commands'
import { useEditor } from '../store'
import { usableIn } from '../templates/model'
import { useTemplatesQuery } from '../templates/api'
import type { TemplateInserter } from '../templates/use-insert-template'
import { findNode } from '../tree'
import { suggestNextSections, type NextSuggestion } from './next-sections'

/*
 * B21 "What next?" in the editor: the suggestions for the end of the page (the canvas strip) and
 * for after the selected section (Ctrl+K "Suggested next"), limited to the section templates this
 * store can insert here. Pages only (home, campaign and content pages) — not headers, footers,
 * zones, popups, store page designs or a global's own editor.
 */

export type NextSections = {
  /** Under the last section (the canvas strip; also the empty page's start). */
  atEnd: NextSuggestion[]
  /** For Ctrl+K: after the selection's section (else the end). */
  commandItems: CommandItem[]
  /** Inserts at the end (`end`) or after the selection's section; one undo step. */
  insert: (suggestion: NextSuggestion, where: 'end' | 'selection') => void
  pendingId: string | null
  available: boolean
}

export function useNextSections(inserter: TemplateInserter | null, enabled: boolean): NextSections {
  const { context = 'page', template = null, single = false } = useEditorUi()
  const content = useEditor((s) => s.content)
  const key = useEditor((s) => s.document.key)
  const title = useEditor((s) => s.document.title)
  const selection = useEditor((s) => s.selection)
  const on = enabled && inserter !== null && !single && template === null && (context === 'page' || context === 'cms')
  const templates = useTemplatesQuery(context, on)
  const afterId = findNode(content, selection)?.sectionId ?? null

  return useMemo(() => {
    const none: NextSections = { atEnd: [], commandItems: [], insert: () => undefined, pendingId: null, available: false }
    if (!on || !inserter || !templates.data) return none
    const available = new Set(usableIn(templates.data, context).filter((t) => t.scope === 'section').map((t) => t.id))
    const document = { key, title }
    const atEnd = suggestNextSections({ document, sections: content.sections, available })
    const afterSelection = afterId ? suggestNextSections({ document, sections: content.sections, afterId, available }) : atEnd
    const insert = (suggestion: NextSuggestion, where: 'end' | 'selection') =>
      void inserter.insert({ id: suggestion.templateId, name: suggestion.label }, where === 'end' ? content.sections.length : undefined)
    const commandItems: CommandItem[] = afterSelection.map((suggestion) => ({
      id: `suggest:${suggestion.role}`,
      group: 'suggest',
      label: suggestion.label,
      hint: suggestion.hint,
      words: `next suggested ${suggestion.role.replace(/_/g, ' ')}`,
      run: () => insert(suggestion, 'selection'),
    }))
    return { atEnd, commandItems, insert, pendingId: inserter.pendingId, available: true }
  }, [on, inserter, templates.data, context, key, title, content.sections, afterId])
}
