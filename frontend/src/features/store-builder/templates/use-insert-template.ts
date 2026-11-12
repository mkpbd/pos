import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DocumentContext, Section } from '@/storefront/builder/types'
import { containsCustomHtml, CUSTOM_HTML_DENIED, useEditorUi } from '../commands'
import { useEditorStoreApi } from '../store'
import { instantiateTemplate, type BuilderTemplate, type InstantiateResult } from './api'
import { insertionIndex, insertSections, prepareSections } from './model'

/*
 * Inserting a template (B5): POST instantiate (the server imports its images into the media
 * library, creates its banners and gives fresh nodes for this context), then every section goes
 * into the draft in ONE edit (one undo step) — after the selection's section, at a dropped
 * position, or at the end — and the first one is selected. The usual autosave follows.
 */

type Instantiate = (id: string, context: DocumentContext) => Promise<InstantiateResult>

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** What the apply added outside the page, for the success toast. */
export function insertedMessage(name: string, result: Pick<InstantiateResult, 'imported'>): string {
  const extras: string[] = []
  const media = result.imported?.media ?? 0
  const banners = result.imported?.banners ?? 0
  if (media) extras.push(`${plural(media, 'image was', 'images were')} added to your media library`)
  if (banners) extras.push(`${plural(banners, 'banner was', 'banners were')} created`)
  return extras.length ? `“${name}” added. ${extras.join(' and ')}.` : `“${name}” added.`
}

export type TemplateInserter = {
  /** `index`: the section position (a drop); omitted = after the selection's section, else the end. */
  insert: (template: Pick<BuilderTemplate, 'id' | 'name'>, index?: number) => Promise<boolean>
  /** The template being instantiated. */
  pendingId: string | null
}

export function useTemplateInserter(instantiate: Instantiate = instantiateTemplate): TemplateInserter {
  const store = useEditorStoreApi()
  const { canvas, context = 'page', canCustomHtml = true } = useEditorUi()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const busy = useRef(false)

  const insert = useCallback(
    async (template: Pick<BuilderTemplate, 'id' | 'name'>, index?: number) => {
      if (busy.current) return false
      busy.current = true
      setPendingId(template.id)
      try {
        const result = await instantiate(template.id, context)
        const nodes = (result.nodes ?? []).filter((node): node is Section => node?.type === 'section')
        if (nodes.length === 0) {
          toast.error('This template has nothing to add here.')
          return false
        }
        if (!canCustomHtml && nodes.some(containsCustomHtml)) {
          toast.error(CUSTOM_HTML_DENIED)
          return false
        }
        const state = store.getState()
        const sections = prepareSections(nodes, state.content)
        const at = index ?? insertionIndex(state.content, state.selection)
        const ok = state.apply((content) => insertSections(content, sections, at), { select: sections[0]!.id })
        if (!ok) {
          toast.error('The page is full: remove a few sections first, then add the template.')
          return false
        }
        const first = sections[0]!.id
        setTimeout(() => canvas.current?.scrollTo(first), 50)
        toast.success(insertedMessage(template.name, result))
        return true
      } catch (error) {
        toast.error(error instanceof Error ? `The template couldn’t be added: ${error.message}` : 'The template couldn’t be added.')
        return false
      } finally {
        busy.current = false
        setPendingId(null)
      }
    },
    [canCustomHtml, canvas, context, instantiate, store],
  )

  return { insert, pendingId }
}
