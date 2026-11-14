import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { InfoIcon, SlidersHorizontalIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCurrentUserQuery } from '@/features/auth/api'
import { useCan } from '@/features/auth/use-auth'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import type { CanvasProduct, CanvasSurroundings } from '@/storefront/builder/canvas/protocol'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { RenderSection } from '@/storefront/builder/types'
import { AddPanel } from './add-panel'
import { elementsShowingBanners, replaceBanner } from './banner-refs'
import {
  builderAdminKeys,
  discardDraft,
  fetchDocument,
  publishDocument,
  renameDocument,
  restoreVersion,
  saveDraft,
  setPopupActive,
  type CanvasContext,
  type DocumentDetail,
  type ElementsMetadata,
  type VersionSummary,
} from './api'
import { Autosave, problemCount, problemsByNode } from './autosave'
import { CanvasFrame, type CanvasHandle } from './canvas-frame'
import type { ResizePhase, ResizeRow } from './column-handles'
import { resetColumnWidth, resizeColumns, setColumnWidth } from './column-resize'
import { EditorUiContext, nodeLabel, nodeName, useCommands, useEditorUi, type EditorUi } from './commands'
import { ElementIcon } from './element-icon'
import { globalKeys, useGlobalEntries, useGlobalsQuery } from './global-api'
import { DetachConfirm, MakeGlobalDialog } from './global-dialogs'
import { GlobalDocBar, GlobalDocPanel, GlobalRefPanel, GlobalSectionsPanel } from './global-panel'
import { expandGlobals, globalContextFor, globalRefOf, referencedGlobals } from './global-sections'
import { ConflictDialog, LeaveDialog, PublishDialog, VersionHistoryDialog } from './dialogs'
import { elementContext, isProductZone, kindInfo, parseZoneKey } from './document-kind'
import { computeDropTarget, layerDropTarget, type Dragged, type DropResult } from './drop-targets'
import { Inspector, withSeo } from './inspector'
import { BREAKPOINT, widthAt } from './inspector/style-model'
import { flattenLayers } from './layers'
import { LayersPanel, type LayerIndicator } from './layers-panel'
import { MiniToolbar } from './mini-toolbar'
import { toRenderTree } from './render-tree'
import { useEditor, useEditorStoreApi } from './store'
import { SiteStylesDrawer } from './site-styles'
import { useSiteStyles } from './use-site-styles'
import { Toolbar } from './toolbar'
import { findNode, setColumnPreset, setNode, type DropTarget } from './tree'
import { SaveTemplateDialog } from './templates/save-template-dialog'
import { TemplatesPanel } from './templates/templates-panel'
import { useTemplateInserter } from './templates/use-insert-template'
import type { Column, InnerRowElement, Section } from '@/storefront/builder/types'
import { usePreviewData } from './use-preview-data'
import { readPopupSettings } from './popup-model'

/*
 * The full-screen store builder editor (B2): toolbar, Add / Layers panel, canvas, inspector;
 * drag and drop (dnd-kit) across the canvas iframe and the layers tree; keyboard shortcuts;
 * autosave with its conflict dialog; the unsaved-change guard.
 */

/** The canvas language: base texts are the source language; Bangla is edited as a translation. */
export const EDITOR_LOCALE = 'en'

const AUTOSCROLL_EDGE = 48

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return true
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** Keyboard dragging in Layers: one row (32 px) per arrow press. */
const LAYER_ROW = 32
const layerKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  if (event.code === 'ArrowUp' || event.key === 'ArrowUp') return { ...currentCoordinates, y: currentCoordinates.y - LAYER_ROW }
  if (event.code === 'ArrowDown' || event.key === 'ArrowDown') return { ...currentCoordinates, y: currentCoordinates.y + LAYER_ROW }
  return undefined
}

const collision: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args))

type EditorProps = {
  registry: ElementsMetadata
  canvasContext: CanvasContext
  /** For tests: a different save / fetch. */
  autosaveOverrides?: { save?: typeof saveDraft; fetchDocument?: typeof fetchDocument; delay?: number }
}

export function Editor({ registry, canvasContext, autosaveOverrides }: EditorProps) {
  const store = useEditorStoreApi()
  const can = useCan()
  const canPublish = can('storefront.publish')
  const canCustomHtml = can('storefront.custom_html')
  const queryClient = useQueryClient()
  const canvas = useRef<CanvasHandle | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saveTemplateId, setSaveTemplateId] = useState<string | null>(null)

  const autosave = useMemo(
    () =>
      new Autosave(store, {
        save: autosaveOverrides?.save ?? ((id, revision, content) => saveDraft(id, revision, content)),
        fetchDocument: autosaveOverrides?.fetchDocument ?? fetchDocument,
        delay: autosaveOverrides?.delay,
      }),
    [store, autosaveOverrides],
  )
  useEffect(() => {
    autosave.start()
    return () => autosave.stop()
  }, [autosave])

  const documentKind = useEditor((s) => s.document.kind)
  const documentKey = useEditor((s) => s.document.key)
  const documentId = useEditor((s) => s.document.id)
  const documentTitle = useEditor((s) => s.document.title)
  const globalContext = useEditor((s) => s.document.context)
  // B9: the store (clipboard), the globals this draft shows (drawn from their drafts) and the global dialogs.
  const org = useCurrentUserQuery().data?.organization?.id ?? ''
  const refKey = useEditor((s) => referencedGlobals(s.content).join(','))
  const refIds = useMemo(() => (refKey ? refKey.split(',') : []), [refKey])
  const globals = useGlobalEntries(refIds)
  // Leaving a global's own editor: pages that show it draw its latest draft next time.
  useEffect(() => {
    if (documentKind !== 'global') return
    return () => {
      void queryClient.invalidateQueries({ queryKey: globalKeys.content(documentId) })
      void queryClient.invalidateQueries({ queryKey: globalKeys.list })
    }
  }, [documentKind, documentId, queryClient])
  const [makeGlobalId, setMakeGlobalId] = useState<string | null>(null)
  const [detachId, setDetachId] = useState<string | null>(null)
  const navigate = useNavigate()
  const openGlobal = useCallback(
    (id: string) => void navigate(`/storefront/builder/${id}`, { state: { back: { id: documentId, title: documentTitle } } }),
    [navigate, documentId, documentTitle],
  )
  const ui = useMemo<EditorUi>(() => {
    const single = documentKind === 'global'
    const context = elementContext({ kind: documentKind, key: documentKey, context: globalContext })
    return {
      registry,
      canvas,
      requestDelete: setDeleteId,
      canCustomHtml,
      context,
      requestSaveTemplate: setSaveTemplateId,
      org,
      single,
      noun: kindInfo({ kind: documentKind, key: documentKey }).noun,
      globals,
      requestMakeGlobal: single || !globalContextFor(context) ? undefined : setMakeGlobalId,
      requestDetach: setDetachId,
      openGlobal,
    }
  }, [registry, canCustomHtml, documentKind, documentKey, globalContext, org, globals, openGlobal])

  return (
    <EditorUiContext value={ui}>
      {/* Its own provider: the editor renders outside the admin shell. */}
      <TooltipProvider delayDuration={300}>
        <EditorLayout autosave={autosave} canPublish={canPublish} canCustomHtml={canCustomHtml} canvasContext={canvasContext} registry={registry} queryClient={queryClient} />
        <DeleteConfirm id={deleteId} onClose={() => setDeleteId(null)} />
        <SaveTemplate id={saveTemplateId} onClose={() => setSaveTemplateId(null)} />
        <MakeGlobalDialog sectionId={makeGlobalId} onClose={() => setMakeGlobalId(null)} />
        <DetachConfirm refId={detachId} onClose={() => setDetachId(null)} />
      </TooltipProvider>
    </EditorUiContext>
  )
}

function DeleteConfirm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const content = useEditor((s) => s.content)
  const commands = useCommands()
  const { registry } = useEditorUi()
  const info = findNode(content, id)
  const label = info ? nodeLabel(info.node, registry) : ''
  return (
    <ConfirmDialog
      open={id !== null && info !== null}
      onOpenChange={(open) => !open && onClose()}
      title={globalRefOf(info?.node) ? 'Remove this global section from the page?' : `Delete this ${label.toLowerCase()}?`}
      description={
        globalRefOf(info?.node)
          ? 'It is removed from this page only. The global section itself and the other pages that use it stay as they are. You can undo this.'
          : info?.kind === 'section'
            ? 'The section and everything in it is removed. You can undo this.'
            : 'It is removed from the page. You can undo this.'
      }
      confirmLabel={globalRefOf(info?.node) ? 'Remove' : 'Delete'}
      onConfirm={() => {
        if (id) commands.remove(id)
        onClose()
      }}
    />
  )
}

/** Save as template (B5) for the section `id` of the draft as it is now. */
function SaveTemplate({ id, onClose }: { id: string | null; onClose: () => void }) {
  const content = useEditor((s) => s.content)
  const { context = 'page' } = useEditorUi()
  const info = findNode(content, id)
  const section = info?.kind === 'section' ? (info.node as Section) : null
  return <SaveTemplateDialog section={section} context={context} onClose={onClose} />
}

type LayoutProps = {
  autosave: Autosave
  canPublish: boolean
  canCustomHtml: boolean
  canvasContext: CanvasContext
  registry: ElementsMetadata
  queryClient: ReturnType<typeof useQueryClient>
}

/** Where a published header, footer or zone can be seen on the store (version history's "View"). */
function livePath(doc: { kind: string; key: string; path: string | null; preview_product?: { slug: string } | null }): string | null {
  if (doc.path) return doc.path
  if (doc.kind === 'header' || doc.kind === 'footer') return '/'
  if (doc.key === 'zone:listing.top' || doc.key === 'zone:listing.bottom') return '/shop'
  // P1b: a product zone (or one of its versions) on the matching live product.
  if (doc.kind === 'zone' && doc.preview_product?.slug) return `/product/${encodeURIComponent(doc.preview_product.slug)}`
  return null
}

/** The canvas kind of a document; a product zone's version is drawn as its zone (P1b). */
function canvasSurroundings(doc: { kind: string; key: string; context?: string | null }): CanvasSurroundings {
  // B9: a header or footer global is drawn where the header or footer sits.
  if (doc.kind === 'global') return doc.context === 'header' || doc.context === 'footer' ? doc.context : 'page'
  if (doc.kind === 'zone') return parseZoneKey(doc.key)?.zone ?? 'page'
  return doc.kind === 'header' || doc.kind === 'footer' || doc.kind === 'popup' ? doc.kind : 'page'
}

function EditorLayout({ autosave, canPublish, canCustomHtml, canvasContext, registry, queryClient }: LayoutProps) {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const hover = useEditor((s) => s.hover)
  const device = useEditor((s) => s.device)
  const errors = useEditor((s) => s.errors)
  const localMedia = useEditor((s) => s.localMedia)
  const documentInfo = useEditor((s) => s.document)
  const saveStatus = useEditor((s) => s.saveState.status)
  const select = useEditor((s) => s.select)
  const setHover = useEditor((s) => s.setHover)
  const { canvas, globals, single = false } = useEditorUi()
  // B4: what this document is (page, header, footer, zone) and which elements it may hold.
  const info = useMemo(() => kindInfo(documentInfo), [documentInfo])
  const context = elementContext(documentInfo)
  const surroundings = canvasSurroundings(documentInfo)
  // P1b: a product page zone is previewed on a matching live product (a version: one of its category's, or that product).
  const productZone = documentInfo.kind === 'zone' && isProductZone(surroundings)
  const previewProduct = documentInfo.preview_product
  const canvasProduct = useMemo<CanvasProduct | null>(
    () => (productZone && previewProduct ? { name: previewProduct.name, price: previewProduct.price ?? null, image_url: previewProduct.image_url ?? null } : null),
    [productZone, previewProduct],
  )
  // B8b: a popup is drawn in its layout over a dimmed sample page.
  const isPopup = documentInfo.kind === 'popup'
  const popupSettings = useMemo(() => (isPopup ? readPopupSettings(content.popup) : undefined), [isPopup, content.popup])
  const [activePending, setActivePending] = useState(false)

  const [tab, setTab] = useState<'add' | 'layers' | 'templates' | 'global'>('add')
  // B9: the Global tab where global sections fit (not in popups or in a global itself); no templates inside a global.
  const showGlobalTab = !single && globalContextFor(context) !== null
  const showTemplatesTab = !single
  const templates = useTemplateInserter()
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishPending, setPublishPending] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [conflictPending, setConflictPending] = useState(false)
  const [stylesOpen, setStylesOpen] = useState(false)

  /* ---------------------------------------------------------------- site styles (B3) ------- */
  const siteStyles = useSiteStyles()
  const themeSettings = siteStyles.settings
  const inspectorTheme = useMemo(() => {
    const colors = (themeSettings?.colors ?? canvasContext.bootstrap.theme.colors) as Record<string, string | null | undefined>
    return {
      colors: Object.fromEntries(Object.entries(colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      palette: themeSettings?.palette ?? [],
    }
  }, [themeSettings, canvasContext.bootstrap.theme.colors])

  /* ---------------------------------------------------------------- column widths (B3) ----- */
  const breakpoint = BREAKPOINT[device]
  const resizeRow = useMemo<ResizeRow | null>(() => {
    const info = findNode(content, selection)
    if (!info) return null
    const row = info.kind === 'column' ? findNode(content, info.parentId)?.node : info.node
    if (!row || (row.type !== 'section' && row.type !== 'inner_row')) return null
    const columns = (row as Section | InnerRowElement).columns as Column[]
    if (columns.length < 2) return null
    return { rowId: row.id, columns: columns.map((column) => ({ id: column.id, width: widthAt(column.width, breakpoint).value ?? 100 })) }
  }, [content, selection, breakpoint])
  // One drag = one undo step, however long it takes.
  const resizeSession = useRef<string | null>(null)
  const onResize = useCallback(
    (rowId: string, index: number, left: number, phase: ResizePhase) => {
      resizeSession.current ??= `resize:${rowId}:${index}:${Date.now()}`
      store.getState().apply((c) => resizeColumns(c, rowId, index, left, breakpoint), { coalesceKey: resizeSession.current, coalesceWindow: Number.POSITIVE_INFINITY })
      if (phase === 'end') resizeSession.current = null
    },
    [breakpoint, store],
  )

  /* ---------------------------------------------------------------- canvas data ------------ */
  // B9: each global section reference is drawn as its global's draft (see global-sections.ts).
  const expanded = useMemo(() => expandGlobals(content, globals ?? new Map(), context), [content, globals, context])
  const preview = usePreviewData(expanded.content, { locale: EDITOR_LOCALE, localMedia, enabled: true })
  // Scheduled nodes change state with time: the clock the canvas tree is computed with ticks each minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const sections = useMemo<RenderSection[]>(() => toRenderTree(expanded.content, { locale: EDITOR_LOCALE, now, reveal: selection }), [expanded, selection, now])
  // The inspector looks things up in the drawn document; nodes it can't show (unavailable globals) are left out.
  const inspectorContent = useMemo(
    () => (expanded.content === content ? content : { ...expanded.content, sections: expanded.content.sections.filter((s) => Array.isArray(s.columns)) }),
    [expanded, content],
  )
  /** A canvas id inside a drawn global section is its reference's. */
  const ownerOf = useCallback((id: string | null) => (id ? (expanded.owners.get(id) ?? id) : null), [expanded])
  const errorIds = useMemo(() => [...Object.keys(errors), ...Object.keys(preview.errors)].filter((id) => id !== ''), [errors, preview.errors])
  const selectedInfo = findNode(content, selection)

  /* ---------------------------------------------------------------- shortcuts -------------- */
  const handleKey = useCallback(
    (key: { key: string; ctrl: boolean; shift: boolean; meta: boolean }): boolean => {
      const state = store.getState()
      const mod = key.ctrl || key.meta
      const k = key.key.toLowerCase()
      if (mod && k === 'z') {
        if (key.shift) state.redo()
        else state.undo()
        return true
      }
      if (mod && k === 'y') {
        state.redo()
        return true
      }
      if (mod && k === 'd' && state.selection) {
        commands.duplicate(state.selection)
        return true
      }
      // B9: from the canvas (the editor's own copy / paste events handle the rest of the window).
      if (mod && k === 'c') {
        if (state.selection) commands.copy(state.selection)
        return true
      }
      if (mod && k === 'v') {
        commands.paste(null)
        return true
      }
      if (mod) return false
      if ((k === 'delete' || k === 'backspace') && state.selection) {
        const info = findNode(state.content, state.selection)
        if (info && info.kind !== 'column') commands.requestDelete(state.selection)
        return true
      }
      if (k === 'escape') {
        const info = findNode(state.content, state.selection)
        state.select(info?.parentId ?? null)
        return true
      }
      if (k === 'arrowup' || k === 'arrowdown') {
        const rows = flattenLayers(state.content)
        const index = rows.findIndex((row) => row.node.id === state.selection)
        const next = rows[index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (k === 'arrowdown' ? 1 : -1)))]
        if (next) {
          state.select(next.node.id)
          commands.reveal(next.node.id)
        }
        return true
      }
      return false
    },
    [commands, store],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return
      // B9: Ctrl/Cmd + C, X and V go on to the browser's copy / paste events (below).
      if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'x'].includes(event.key.toLowerCase())) return
      const target = event.target as HTMLElement | null
      // Arrows move focus inside menus, tabs and the layers tree; only plain page focus moves the selection.
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && target && target !== document.body && !target.closest('[data-canvas-keys]')) return
      if ((event.key === 'Delete' || event.key === 'Backspace' || event.key === 'Escape') && target?.closest('[role="tree"]')) return
      if (handleKey({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey })) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleKey])

  /* ---------------------------------------------------------------- copy & paste (B9) ------ */
  useEffect(() => {
    const busy = (event: ClipboardEvent) => isTypingTarget(event.target) || (window.getSelection()?.toString() ?? '') !== ''
    const onCopy = (event: ClipboardEvent) => {
      if (busy(event)) return
      const selected = store.getState().selection
      if (!selected) return
      const text = commands.copy(selected, { system: false })
      if (!text) return
      event.clipboardData?.setData('text/plain', text)
      event.preventDefault()
    }
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      commands.paste(event.clipboardData?.getData('text/plain') ?? null)
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste)
    }
  }, [commands, store])

  /* ---------------------------------------------------------------- saving & leaving ------- */
  useEffect(() => {
    const onBlur = () => void autosave.flush()
    const onVisibility = () => document.visibilityState === 'hidden' && void autosave.flush()
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosave.pending) return
      void autosave.flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [autosave])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => autosave.pending && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void autosave.flush().then((ok) => {
      if (!active) return
      if (ok) blocker.proceed()
      else setLeaveOpen(true)
    })
    return () => {
      active = false
    }
  }, [blocker, autosave])

  const chooseConflict = (choice: 'theirs' | 'mine') => {
    setConflictPending(true)
    autosave
      .resolveConflict(choice)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Could not load the page.'))
      .finally(() => setConflictPending(false))
  }

  const refreshList = () => {
    void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    void queryClient.invalidateQueries({ queryKey: globalKeys.list })
  }
  const globalsList = useGlobalsQuery(referencedGlobals(content).length > 0)

  const rename = async (title: string) => {
    try {
      const updated = await renameDocument(documentInfo.id, title)
      store.getState().setDocument({ title: updated.title ?? title })
      refreshList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename the page.')
      throw error
    }
  }

  const showProblem = () => {
    const state = store.getState()
    const first = Object.keys(state.errors).find((id) => id !== '' && findNode(state.content, id))
    state.select(first ?? null)
    if (first) commands.reveal(first)
  }

  const openPreview = async () => {
    const url = store.getState().document.preview_url
    if (!url) return
    // Opened before the save so the browser does not block it as a pop-up.
    const win = window.open('', '_blank')
    const saved = await autosave.flush()
    if (!saved) toast.warning('Your latest changes are not saved yet — the preview shows the last saved draft.')
    if (win) {
      win.opener = null
      win.location.href = url
    } else {
      window.open(url, '_blank', 'noopener')
    }
  }

  const publish = async (note: string | null) => {
    setPublishPending(true)
    setPublishError(null)
    try {
      const saved = await autosave.flush()
      if (!saved) {
        const state = store.getState()
        const count = problemCount(state.errors)
        if (state.saveState.status === 'invalid') setPublishError(`Fix the ${count} ${count === 1 ? 'problem' : 'problems'} on this page first (marked in red), then publish.`)
        else if (state.saveState.status === 'conflict') setPublishError('This page changed somewhere else. Choose which version to keep first.')
        else setPublishError('Your latest changes could not be saved. Check your connection and try again.')
        return
      }
      const detail = await publishDocument(documentInfo.id, note)
      store.getState().setDocument({ published: detail.published, preview_url: detail.preview_url ?? store.getState().document.preview_url })
      setPublishOpen(false)
      const state = store.getState()
      const version = detail.published ? ` — version ${detail.published.number}` : ''
      // A popup is live only while it is switched on (B8b).
      if (state.document.kind === 'popup' && !state.document.active) toast.success(`Published${version}. Switch it on in Popup settings to show it on your shop.`)
      else if (state.document.kind === 'global') {
        const count = state.document.usage?.usage_count ?? 0
        toast.success(`Published${version}. ${count === 0 ? 'Add it to a page from the Global tab to show it.' : `Every page that uses it (${count}) now shows this version.`}`)
      } else toast.success(detail.published ? `Published${version} is live.` : 'Published.')
      // B9: a page shows a global section only once the global itself is published.
      const unpublished = (globalsList.data ?? []).filter((g) => !g.published && referencedGlobals(state.content).includes(g.id))
      if (unpublished.length > 0) toast.warning(`${unpublished.map((g) => `“${g.title}”`).join(', ')} ${unpublished.length === 1 ? 'isn’t' : 'aren’t'} published yet, so shoppers don’t see ${unpublished.length === 1 ? 'it' : 'them'} on this page.`)
      refreshList()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        if (error.code === 'DOCUMENT_INVALID') store.getState().setErrors(problemsByNode(error))
        setPublishError(error.code === 'DOCUMENT_EMPTY' ? `Add something to the ${info.noun} before publishing it.` : error.message)
      } else setPublishError(error instanceof Error ? error.message : 'Could not publish.')
    } finally {
      setPublishPending(false)
    }
  }

  const replaceDraft = async (load: () => Promise<DocumentDetail>, message: string) => {
    autosave.reset()
    try {
      const detail = await load()
      store.getState().load(detail)
      toast.success(message)
      refreshList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.')
    }
  }

  /** B8b: the popup's on / off switch (not versioned, takes effect at once). */
  const switchPopup = async (active: boolean) => {
    setActivePending(true)
    try {
      const updated = await setPopupActive(documentInfo.id, active)
      store.getState().setDocument({ active: updated?.active ?? active })
      toast.success(active ? 'Switched on. Shoppers see the published version.' : 'Switched off. Shoppers no longer see it.')
      refreshList()
    } catch (error) {
      toast.error(error instanceof ApiError && error.status === 422 ? error.message : 'It couldn’t be switched. Try again.')
    } finally {
      setActivePending(false)
    }
  }

  const restore = (version: VersionSummary) =>
    replaceDraft(() => restoreVersion(documentInfo.id, version.id), `Version ${version.number} is now your draft. Publish to make it live.`).then(() => setHistoryOpen(false))

  /* ---------------------------------------------------------------- drag & drop ------------ */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: layerKeyboardCoordinates }))
  const [dragged, setDragged] = useState<Dragged | null>(null)
  /** A pointer drag (the canvas overlay catches the pointer); keyboard drags work in Layers only. */
  const [pointerDrag, setPointerDrag] = useState(false)
  const [canvasDrop, setCanvasDrop] = useState<DropResult | null>(null)
  const [layerDrop, setLayerDrop] = useState<{ target: DropTarget; indicator: LayerIndicator } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const edge = useRef(0)

  useEffect(() => {
    if (!dragged) return
    const timer = setInterval(() => {
      if (edge.current !== 0) canvas.current?.scrollBy(edge.current * 18)
    }, 40)
    return () => clearInterval(timer)
  }, [dragged, canvas])

  const resetDrag = () => {
    setDragged(null)
    setPointerDrag(false)
    setCanvasDrop(null)
    setLayerDrop(null)
    start.current = null
    edge.current = 0
  }

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { dragged?: Dragged } | undefined
    if (!data?.dragged) return
    setDragged(data.dragged)
    const activator = event.activatorEvent
    start.current = activator && 'clientX' in activator ? { x: (activator as PointerEvent).clientX, y: (activator as PointerEvent).clientY } : null
    setPointerDrag(start.current !== null)
  }

  const onDragMove = (event: DragMoveEvent) => {
    const item = (event.active.data.current as { dragged?: Dragged } | undefined)?.dragged
    if (!item) return
    const state = store.getState()
    if (start.current) {
      const x = start.current.x + event.delta.x
      const y = start.current.y + event.delta.y
      const point = canvas.current?.toCanvasPoint(x, y)
      if (point && canvas.current) {
        const viewport = canvas.current.viewport()
        edge.current = point.y < AUTOSCROLL_EDGE ? -1 : viewport.h > 0 && point.y > viewport.h - AUTOSCROLL_EDGE ? 1 : 0
        setCanvasDrop(computeDropTarget(state.content, canvas.current.rects(), point, item, viewport.w))
        setLayerDrop(null)
        return
      }
      edge.current = 0
      setCanvasDrop(null)
    }
    const over = event.over
    const overData = over?.data.current as { nodeId?: string } | undefined
    if (!over || !overData?.nodeId) {
      setLayerDrop(null)
      return
    }
    const active = event.active.rect.current.translated
    const middle = active ? active.top + active.height / 2 : 0
    const half = middle < over.rect.top + over.rect.height / 2 ? 'top' : 'bottom'
    const result = layerDropTarget(state.content, overData.nodeId, half, item)
    setLayerDrop(result ? { target: result.target, indicator: { rowId: result.rowId, position: result.position } } : null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const item = (event.active.data.current as { dragged?: Dragged } | undefined)?.dragged
    const target = canvasDrop?.target ?? layerDrop?.target ?? null
    resetDrag()
    if (!item || !target) return
    if (item.kind === 'template') {
      if (single) return
      // Templates are whole sections: they only go between sections.
      if (target.kind === 'new-section') void templates.insert({ id: item.id, name: item.name }, target.index)
    } else if (item.kind === 'new') void commands.insert(item.type, target)
    else {
      commands.move(item.id, target)
      commands.reveal(item.id)
    }
  }

  const draggedLabel = dragged ? (dragged.kind === 'template' ? dragged.name : dragged.kind === 'new' ? (registry.types.find((t) => t.type === dragged.type)?.label ?? dragged.type) : (() => {
    const info = findNode(content, dragged.id)
    return info ? nodeLabel(info.node, registry) : ''
  })()) : ''

  const selectedNode = selectedInfo?.node ?? null
  const selectedRef = globalRefOf(selectedNode)
  const globalSettings = single && selectedNode === null
  const inspectorDocument = {
    id: documentInfo.id,
    // B9: inside a global the inspector treats it as the context it is made for.
    kind: documentInfo.kind === 'global' ? (documentInfo.context ?? 'page') : documentInfo.kind,
    key: documentInfo.key,
    title: documentInfo.title,
    path: documentInfo.path,
    published: documentInfo.published ? { number: documentInfo.published.number, published_at: documentInfo.published.published_at ?? '' } : null,
    active: documentInfo.active,
    target: documentInfo.target,
    canPublish,
    activePending,
    storeUrl: canvasContext.store_url,
  }
  const labelOf = useCallback((id: string) => {
    const info = findNode(store.getState().content, ownerOf(id))
    return info ? nodeName(info.node, registry, globals) : ''
  }, [registry, store, ownerOf, globals])

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={(e) => onDragMove(e as unknown as DragMoveEvent)} onDragEnd={onDragEnd} onDragCancel={resetDrag} autoScroll={{ layoutShiftCompensation: false }}>
      <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-testid="store-builder-editor">
        <Toolbar
          canPublish={canPublish}
          onRename={rename}
          onPreview={() => void openPreview()}
          onPublish={() => {
            setPublishError(null)
            setPublishOpen(true)
          }}
          onDiscard={() => setDiscardOpen(true)}
          onHistory={() => setHistoryOpen(true)}
          onShowProblem={showProblem}
        />
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Add elements, page layers and templates" className="flex w-72 shrink-0 flex-col border-r bg-background">
            <Tabs value={tab} onValueChange={(value) => setTab(value as 'add' | 'layers' | 'templates')} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className={cn('m-2 grid w-auto', showGlobalTab && showTemplatesTab ? 'grid-cols-4' : showGlobalTab || showTemplatesTab ? 'grid-cols-3' : 'grid-cols-2')}>
                <TabsTrigger value="add">Add</TabsTrigger>
                <TabsTrigger value="layers">Layers</TabsTrigger>
                {showTemplatesTab && <TabsTrigger value="templates">Templates</TabsTrigger>}
                {showGlobalTab && <TabsTrigger value="global">Global</TabsTrigger>}
              </TabsList>
              <TabsContent value="add" className="flex min-h-0 flex-1 flex-col">
                <AddPanel registry={registry} context={context} canCustomHtml={canCustomHtml} />
              </TabsContent>
              <TabsContent value="layers" className="flex min-h-0 flex-1 flex-col">
                <LayersPanel indicator={layerDrop?.indicator ?? null} />
              </TabsContent>
              {showGlobalTab && (
                <TabsContent value="global" className="flex min-h-0 flex-1 flex-col">
                  <GlobalSectionsPanel context={context} enabled={tab === 'global'} />
                </TabsContent>
              )}
              <TabsContent value="templates" className="flex min-h-0 flex-1 flex-col">
                <TemplatesPanel context={context} currentPreset={themeSettings?.preset ?? null} inserter={templates} enabled={tab === 'templates'} />
              </TabsContent>
            </Tabs>
          </nav>
          <main aria-label="Page canvas" className="flex min-w-0 flex-1 flex-col" data-canvas-keys>
            {documentInfo.kind === 'global' ? <GlobalDocBar /> : info.placement && (
              <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2">
                <p role="note" data-testid="document-placement" className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
                  <InfoIcon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    {info.placement}
                    {productZone && (
                      <span className="block text-xs" data-testid="preview-product-note">
                        {canvasProduct ? `The canvas shows it on “${canvasProduct.name}”.` : 'No live product matches yet, so the canvas shows grey placeholders.'}
                      </span>
                    )}
                  </span>
                </p>
                {isPopup && (
                  <Button type="button" variant="outline" size="sm" onClick={() => select(null)} aria-pressed={selection === null}>
                    <SlidersHorizontalIcon data-icon="inline-start" /> Popup settings
                  </Button>
                )}
              </div>
            )}
            <CanvasFrame
              surroundings={surroundings}
              popup={popupSettings}
              product={canvasProduct}
              emptyText={info.empty}
              bootstrap={canvasContext.bootstrap}
              locale={EDITOR_LOCALE}
              sections={sections}
              data={preview.data}
              media={preview.media}
              pending={preview.pending}
              selection={selection}
              hover={hover}
              errorIds={errorIds}
              device={device}
              dragging={dragged !== null && pointerDrag}
              indicator={canvasDrop?.indicator ?? null}
              onSelect={(id) => select(ownerOf(id))}
              onHover={(id) => setHover(ownerOf(id))}
              onKey={handleKey}
              toolbar={() => <MiniToolbar />}
              hoverLabel={labelOf}
              handleRef={canvas}
              theme={themeSettings as CanvasThemeSettings | null}
              resizeRow={resizeRow}
              onResize={onResize}
            />
          </main>
          <div className="flex w-80 shrink-0 flex-col border-l bg-background" data-testid="inspector-panel">
            {/* B9: a global section reference has its own panel; so does a global's document with nothing selected. */}
            {selectedRef ? <GlobalRefPanel node={selectedRef} /> : globalSettings && <GlobalDocPanel onOpenSiteStyles={() => setStylesOpen(true)} />}
            {/* The inspector stays mounted (it hosts the new-element setup dialog). */}
            <div hidden={selectedRef !== null || globalSettings} className="flex min-h-0 flex-1 flex-col">
              <Inspector
                content={inspectorContent}
                node={selectedRef ? null : selectedNode}
                document={inspectorDocument}
                registry={registry}
                locales={canvasContext.locales}
                errors={errors[selection ?? ''] ?? []}
                onChange={(next, options) => store.getState().apply((c) => setNode(c, next), { coalesceKey: options?.coalesceKey, media: options?.media })}
                device={device}
                theme={inspectorTheme}
                canCustomHtml={canCustomHtml}
                onCommand={(command) => {
                  const state = store.getState()
                  switch (command.type) {
                    case 'select':
                      return state.select(command.nodeId)
                    case 'set-column-preset':
                      return void state.apply((c) => setColumnPreset(c, command.nodeId, command.preset))
                    case 'set-device':
                      return state.setDevice(command.device)
                    case 'set-column-width': {
                      const bp = BREAKPOINT[command.device]
                      if (command.width === null) {
                        if (bp !== 'base') state.apply((c) => resetColumnWidth(c, command.columnId, bp))
                        return
                      }
                      const width = command.width
                      return void state.apply((c) => setColumnWidth(c, command.columnId, bp, width))
                    }
                    case 'open-site-styles':
                      return setStylesOpen(true)
                    case 'preview-motion':
                      canvas.current?.scrollTo(command.nodeId)
                      return canvas.current?.playMotion(command.nodeId)
                    case 'set-popup': {
                      const settings = command.settings
                      return void state.apply((c) => ({ ...c, popup: settings }), { coalesceKey: command.coalesceKey })
                    }
                    case 'set-popup-active':
                      return void switchPopup(command.active)
                    case 'set-seo': {
                      // B9 (editor B): the page's Search & sharing settings.
                      const seo = command.seo
                      return void state.apply((c) => withSeo(c, seo), { coalesceKey: command.coalesceKey })
                    }
                    case 'banner-edited': {
                      // A copy: this draft shows it instead of the original (one undo step, autosaved as usual).
                      if (command.replaced) {
                        const { old_id, new_id } = command.replaced
                        state.apply((c) => replaceBanner(c, old_id, new_id))
                      }
                      const ids = command.replaced ? [command.replaced.old_id, command.replaced.new_id] : [command.bannerId]
                      return preview.refresh(elementsShowingBanners(store.getState().content, ids))
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="pointer-events-none flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-lg">
            <ElementIcon type={dragged.type} className="size-4" /> {draggedLabel}
          </div>
        ) : null}
      </DragOverlay>

      <SiteStylesDrawer open={stylesOpen} onOpenChange={setStylesOpen} styles={siteStyles} canPublish={canPublish} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} pending={publishPending} error={publishError} onPublish={(note) => void publish(note)} popup={isPopup} usedOn={documentInfo.kind === 'global' ? (documentInfo.usage?.usage_count ?? 0) : null} />
      <ConflictDialog open={saveStatus === 'conflict'} pending={conflictPending} onChoose={chooseConflict} />
      <VersionHistoryDialog
        documentId={documentInfo.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        liveVersionId={documentInfo.published?.version_id ?? null}
        liveUrl={canvasContext.store_url && livePath(documentInfo) ? `${canvasContext.store_url}${livePath(documentInfo)}` : null}
        canRestore
        onRestore={restore}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard your changes?"
        description="The draft goes back to the live version. Every change since the last publish is lost."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setDiscardOpen(false)
          void replaceDraft(() => discardDraft(documentInfo.id), 'Changes discarded. The draft matches the live page again.')
        }}
      />
      <LeaveDialog
        open={leaveOpen}
        onStay={() => {
          setLeaveOpen(false)
          if (blocker.state === 'blocked') blocker.reset()
        }}
        onLeave={() => {
          setLeaveOpen(false)
          if (blocker.state === 'blocked') blocker.proceed()
        }}
      />
    </DndContext>
  )
}
