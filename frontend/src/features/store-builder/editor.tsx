import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
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
import { InfoIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCan } from '@/features/auth/use-auth'
import { ApiError } from '@/lib/api/client'
import type { CanvasThemeSettings } from '@/storefront/builder/canvas/theme-override'
import type { RenderSection } from '@/storefront/builder/types'
import { AddPanel } from './add-panel'
import {
  builderAdminKeys,
  discardDraft,
  fetchDocument,
  publishDocument,
  renameDocument,
  restoreVersion,
  saveDraft,
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
import { ConflictDialog, LeaveDialog, PublishDialog, VersionHistoryDialog } from './dialogs'
import { elementContext, kindInfo } from './document-kind'
import { computeDropTarget, layerDropTarget, type Dragged, type DropResult } from './drop-targets'
import { Inspector } from './inspector'
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
  const ui = useMemo<EditorUi>(
    () => ({ registry, canvas, requestDelete: setDeleteId, canCustomHtml, context: elementContext({ kind: documentKind, key: documentKey }), requestSaveTemplate: setSaveTemplateId }),
    [registry, canCustomHtml, documentKind, documentKey],
  )

  return (
    <EditorUiContext value={ui}>
      {/* Its own provider: the editor renders outside the admin shell. */}
      <TooltipProvider delayDuration={300}>
        <EditorLayout autosave={autosave} canPublish={canPublish} canCustomHtml={canCustomHtml} canvasContext={canvasContext} registry={registry} queryClient={queryClient} />
        <DeleteConfirm id={deleteId} onClose={() => setDeleteId(null)} />
        <SaveTemplate id={saveTemplateId} onClose={() => setSaveTemplateId(null)} />
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
      title={`Delete this ${label.toLowerCase()}?`}
      description={info?.kind === 'section' ? 'The section and everything in it is removed. You can undo this.' : 'It is removed from the page. You can undo this.'}
      confirmLabel="Delete"
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
function livePath(doc: { kind: string; key: string; path: string | null }): string | null {
  if (doc.path) return doc.path
  if (doc.kind === 'header' || doc.kind === 'footer') return '/'
  if (doc.key === 'zone:listing.top' || doc.key === 'zone:listing.bottom') return '/shop'
  return null
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
  const { canvas } = useEditorUi()
  // B4: what this document is (page, header, footer, zone) and which elements it may hold.
  const info = useMemo(() => kindInfo(documentInfo), [documentInfo])
  const context = elementContext(documentInfo)
  const surroundings = documentInfo.kind === 'zone' ? (documentInfo.key as 'zone:listing.top') : documentInfo.kind === 'header' || documentInfo.kind === 'footer' ? documentInfo.kind : 'page'

  const [tab, setTab] = useState<'add' | 'layers' | 'templates'>('add')
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
  const preview = usePreviewData(content, { locale: EDITOR_LOCALE, localMedia, enabled: true })
  // Scheduled nodes change state with time: the clock the canvas tree is computed with ticks each minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const sections = useMemo<RenderSection[]>(() => toRenderTree(content, { locale: EDITOR_LOCALE, now, reveal: selection }), [content, selection, now])
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
      const target = event.target as HTMLElement | null
      // Arrows move focus inside menus, tabs and the layers tree; only plain page focus moves the selection.
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && target && target !== document.body && !target.closest('[data-canvas-keys]')) return
      if ((event.key === 'Delete' || event.key === 'Backspace' || event.key === 'Escape') && target?.closest('[role="tree"]')) return
      if (handleKey({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey })) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleKey])

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

  const refreshList = () => void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })

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
      toast.success(detail.published ? `Published — version ${detail.published.number} is live.` : 'Published.')
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
  const inspectorDocument = {
    id: documentInfo.id,
    kind: documentInfo.kind,
    key: documentInfo.key,
    title: documentInfo.title,
    path: documentInfo.path,
    published: documentInfo.published ? { number: documentInfo.published.number, published_at: documentInfo.published.published_at ?? '' } : null,
  }
  const labelOf = useCallback((id: string) => {
    const info = findNode(store.getState().content, id)
    return info ? nodeName(info.node, registry) : ''
  }, [registry, store])

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
              <TabsList className="m-2 grid w-auto grid-cols-3">
                <TabsTrigger value="add">Add</TabsTrigger>
                <TabsTrigger value="layers">Layers</TabsTrigger>
                <TabsTrigger value="templates">Templates</TabsTrigger>
              </TabsList>
              <TabsContent value="add" className="flex min-h-0 flex-1 flex-col">
                <AddPanel registry={registry} context={context} canCustomHtml={canCustomHtml} />
              </TabsContent>
              <TabsContent value="layers" className="flex min-h-0 flex-1 flex-col">
                <LayersPanel indicator={layerDrop?.indicator ?? null} />
              </TabsContent>
              <TabsContent value="templates" className="flex min-h-0 flex-1 flex-col">
                <TemplatesPanel context={context} currentPreset={themeSettings?.preset ?? null} inserter={templates} enabled={tab === 'templates'} />
              </TabsContent>
            </Tabs>
          </nav>
          <main aria-label="Page canvas" className="flex min-w-0 flex-1 flex-col" data-canvas-keys>
            {info.placement && (
              <p role="note" data-testid="document-placement" className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                <InfoIcon className="size-4 shrink-0" aria-hidden /> {info.placement}
              </p>
            )}
            <CanvasFrame
              surroundings={surroundings}
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
              onSelect={select}
              onHover={setHover}
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
            <Inspector
              content={content}
              node={selectedNode}
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
                }
              }}
            />
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
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} pending={publishPending} error={publishError} onPublish={(note) => void publish(note)} />
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
