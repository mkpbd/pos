import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { Device } from '@/storefront/builder/types'
import { useDocumentsQuery, type DocumentSummary } from './api'
import { ELEMENT_HINTS } from './catalogue'
import { ACTION_WORDS, ELEMENT_WORDS } from './command-words'
import type { CommandItem } from './command-model'
import { CUSTOM_HTML_DENIED, nodeName, useCommands, useEditorUi } from './commands'
import { allowedIn, kindInfo } from './document-kind'
import { useGlobalsQuery } from './global-api'
import { flattenLayers } from './layers'
import { useEditor, useEditorStoreApi } from './store'
import { usableIn } from './templates/model'
import { useTemplatesQuery } from './templates/api'
import type { TemplateInserter } from './templates/use-insert-template'

/*
 * B12: everything the command box can find, built while it is open: the editor's actions, the
 * elements of this document's context, its section templates, the nodes of the page (Go to) and
 * the other builder documents (Open page).
 */

export type CommandActions = {
  publish: (() => void) | null
  submit: (() => void) | null
  preview: (() => void) | null
  check: () => void
  history: () => void
  styles: () => void
  shortcuts: () => void
}

const DEVICE_NAMES: Record<Device, string> = { desktop: 'Computer view', tablet: 'Tablet view', mobile: 'Phone view' }

export function documentHint(doc: Pick<DocumentSummary, 'kind' | 'key' | 'path' | 'target'>): string {
  if (doc.kind === 'page') return doc.path ? `Page · ${doc.path}` : 'Page'
  if (doc.kind === 'popup') return 'Popup'
  if (doc.kind === 'global') return 'Global section'
  return kindInfo({ kind: doc.kind, key: doc.key, target: doc.target ?? null }).noun.replace(/^./, (c) => c.toUpperCase())
}

export function useCommandItems(open: boolean, actions: CommandActions, inserter: TemplateInserter | null): CommandItem[] {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const { registry, context = 'page', canCustomHtml = true, globals } = useEditorUi()
  const navigate = useNavigate()
  const content = useEditor((s) => s.content)
  const documentId = useEditor((s) => s.document.id)
  const documentTitle = useEditor((s) => s.document.title)
  const device = useEditor((s) => s.device)
  const canUndo = useEditor((s) => s.history.past.length > 0)
  const canRedo = useEditor((s) => s.history.future.length > 0)
  const documents = useDocumentsQuery()
  const globalsList = useGlobalsQuery(open)
  const templates = useTemplatesQuery(context, open && inserter !== null)

  return useMemo(() => {
    if (!open) return []
    const items: CommandItem[] = []
    const action = (id: string, label: string, run: () => void, extra: Partial<CommandItem> = {}) => items.push({ id: `action:${id}`, group: 'action', label, run, words: ACTION_WORDS[id] ?? '', ...extra })

    if (actions.publish) action('publish', 'Publish', actions.publish, { hint: 'Make this draft live on your store' })
    if (actions.submit) action('publish', 'Submit for review', actions.submit, { hint: 'Send this draft to someone who can publish it' })
    if (actions.preview) action('preview', 'Preview', actions.preview, { hint: 'See your draft on the store (new tab)' })
    action('check', 'Check page', actions.check, { hint: 'Missing picture descriptions, hard-to-read text, broken links …' })
    action('history', 'Version history', actions.history, { hint: 'Published versions and named copies' })
    action('save-copy', 'Save a named copy…', actions.history, { hint: 'Keep the draft as it is now, without publishing it', words: ACTION_WORDS['save-copy'] })
    action('styles', 'Site styles', actions.styles, { hint: 'Colours, fonts and buttons of the whole store' })
    for (const value of ['desktop', 'tablet', 'mobile'] as const) {
      if (value !== device) items.push({ id: `action:device-${value}`, group: 'action', label: `Switch to ${DEVICE_NAMES[value].toLowerCase()}`, words: ACTION_WORDS.device, run: () => store.getState().setDevice(value) })
    }
    action('undo', 'Undo', () => store.getState().undo(), { disabled: canUndo ? null : 'Nothing to undo yet.' })
    action('redo', 'Redo', () => store.getState().redo(), { disabled: canRedo ? null : 'Nothing to redo.' })
    action('shortcuts', 'Keyboard shortcuts', actions.shortcuts)

    for (const meta of registry.types) {
      if (!allowedIn(meta, context)) continue
      items.push({
        id: `add:${meta.type}`,
        group: 'add',
        label: meta.label,
        hint: ELEMENT_HINTS[meta.type],
        words: `${meta.type.replace(/_/g, ' ')} ${ELEMENT_WORDS[meta.type] ?? ''}`,
        disabled: meta.type === 'custom_html' && !canCustomHtml ? CUSTOM_HTML_DENIED : null,
        run: () => void commands.insert(meta.type),
      })
    }

    if (inserter) {
      for (const template of usableIn(templates.data ?? [], context)) {
        if (template.scope !== 'section') continue
        items.push({ id: `template:${template.id}`, group: 'template', label: template.name, hint: template.description ?? undefined, words: template.category ?? '', run: () => void inserter.insert({ id: template.id, name: template.name }) })
      }
    }

    for (const row of flattenLayers(content)) {
      if (row.kind === 'column') continue
      const id = row.node.id
      items.push({
        id: `goto:${id}`,
        group: 'goto',
        label: nodeName(row.node, registry, globals),
        run: () => {
          store.getState().select(id)
          commands.reveal(id)
        },
      })
    }

    const back = { state: { back: { id: documentId, title: documentTitle } } }
    const seen = new Set<string>()
    for (const doc of [...(documents.data ?? []), ...(globalsList.data ?? [])]) {
      if (doc.id === documentId || doc.kind === 'theme' || seen.has(doc.id)) continue
      seen.add(doc.id)
      items.push({ id: `page:${doc.id}`, group: 'page', label: doc.title, hint: documentHint(doc), words: doc.key, run: () => void navigate(`/storefront/builder/${doc.id}`, back) })
    }
    return items
  }, [open, actions, inserter, registry, context, canCustomHtml, globals, content, documentId, documentTitle, device, canUndo, canRedo, documents.data, globalsList.data, templates.data, store, commands, navigate])
}
