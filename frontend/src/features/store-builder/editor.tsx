import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useBlocker, useNavigate, useSearchParams } from 'react-router'
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
import { MediaPicker } from '@/features/media/components/media-picker'
import { useStoreFonts } from '@/features/storefront/api'
import { useCan } from '@/features/auth/use-auth'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import type { CanvasProduct } from '@/storefront/builder/canvas/protocol'
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
} from './api'
import { cancelSchedule, schedulePublish, submitForReview, withdrawReview, type VersionEntry } from './publishing-api'
import { formatStoreTime } from './publishing/schedule-time'
import { ReviewChip, ScheduleChip } from './publishing/status-chips'
import { ReviewScreen, SubmitReviewDialog } from './publishing/review-dialogs'
import { canvasSurroundings } from './publishing/surroundings'
import { entryTitle } from './publishing/version-names'
import { VersionHistoryDialog, type CompareSupport } from './publishing/versions-panel'
import { Autosave, problemCount, problemsByNode } from './autosave'
import { CanvasFrame, type CanvasEditMessage, type CanvasHandle, type NodeUpload, type SpacingTarget } from './canvas-frame'
import { CheckPanel } from './check-panel'
import { InsightsPanel } from './insights/insights-panel'
import { useInsights } from './insights/use-insights'
import { useExperimentsUi } from './experiments/experiments-context'
import { ExperimentsProvider } from './experiments/experiments-provider'
import { ExperimentsPanel } from './experiments/experiments-panel'
import { canHaveExperiments, experimentsOf } from './experiments/experiments-model'
import { useCanvasArms } from './experiments/use-canvas-arms'
import { usePageCheck } from './use-page-check'
import { applyTextEdit, firstInlineField } from './inline-edit'
import { dropTargetOf, pictureFileProblem, setNodePicture, uploadErrorMessage, uploadPicture } from './media-upload'
import type { PageCheckIssue, PageCheckTab } from './page-check'
import { applyPageCheckFix } from './page-check-fix'
import { hasSpacingHandles, setSpacing, spacingAt } from './spacing-drag'
import type { ResizePhase, ResizeRow } from './column-handles'
import { resetColumnWidth, resizeColumns, setColumnWidth } from './column-resize'
import { EditorUiContext, nodeLabel, nodeName, useCommands, useEditorUi, type EditorUi } from './commands'
import { ElementIcon } from './element-icon'
import { globalKeys, useGlobalEntries, useGlobalsQuery } from './global-api'
import { DetachConfirm, MakeGlobalDialog } from './global-dialogs'
import { GlobalDocBar, GlobalDocPanel, GlobalRefPanel, GlobalSectionsPanel } from './global-panel'
import { expandGlobals, globalContextFor, globalRefOf, isGlobalRef, mergedDeviceOrder, referencedGlobals } from './global-sections'
import { ConflictDialog, LeaveDialog, LinkPrompt, PublishDialog } from './dialogs'
import { documentTemplate, elementContext, isProductZone, kindInfo } from './document-kind'
import { TemplateSampleContext, useTemplateSampleState } from './template-sample-state'
import { hasSamplePicker, templateLivePath } from './store-pages-api'
import { computeDropTarget, layerDropTarget, type Dragged, type DropResult } from './drop-targets'
import { Inspector, withSeo } from './inspector'
import { BREAKPOINT, DEVICE_LABEL, widthAt } from './inspector/style-model'
import { flattenLayers } from './layers'
import { LayersPanel, type LayerIndicator } from './layers-panel'
import { MiniToolbar } from './mini-toolbar'
import { toRenderTree } from './render-tree'
import { useAudienceBadges } from './audience/badges'
import { usePreviewContext } from './audience/use-preview'
import { useEditor, useEditorStoreApi, useSelectedIds } from './store'
import { selectedNodes } from './selection'
import { CommandBox } from './command-box'
import { useCommandItems, type CommandActions } from './use-command-items'
import { ShortcutSheet } from './shortcut-sheet'
import { CopyToPagesDialog } from './copy-to-pages'
import { canCopySectionsFrom } from './copy-to-pages-api'
import { useUndoMemory } from './undo-memory'
import { deviceView, resolveDeviceDrop } from './device-drop'
import { spacingGuides } from './snapping'
import { SiteStylesDrawer } from './site-styles'
import { useSiteStyles } from './use-site-styles'
import { Toolbar } from './toolbar'
import { findNode, setColumnPreset, setNode, type DropTarget } from './tree'
import { SaveTemplateDialog } from './templates/save-template-dialog'
import { TemplatesPanel } from './templates/templates-panel'
import { useTemplateInserter } from './templates/use-insert-template'
import type { BuilderNode, Column, DocumentSection, InnerRowElement, Section } from '@/storefront/builder/types'
import { usePreviewData } from './use-preview-data'
import { readPopupSettings } from './popup-model'
import { downloadExport } from './collab/collab-api'
import { anchorIn, hitNode, isOpen, KEYBOARD_ANCHOR, otherViewers } from './collab/collab-model'
import { AddressDialog } from './collab/address-dialog'
import type { CommentPinLayer } from './collab/comment-pins'
import { CommentsPanel } from './collab/comments-panel'
import { PresenceBanner } from './collab/presence-ui'
import { useComments } from './collab/use-comments'
import { noteBlocked, usePresence } from './collab/use-presence'
import { MotionThemesDialog } from './timeline/motion-themes-dialog'
import { MotionTimelinePanel } from './timeline/motion-timeline'
import { MotionUiContext, useMotionStudio } from './timeline/motion-ui'

/*
 * The full-screen store builder editor (B2): toolbar, Add / Layers panel, canvas, inspector;
 * drag and drop (dnd-kit) across the canvas iframe and the layers tree; keyboard shortcuts;
 * autosave with its conflict dialog; the unsaved-change guard.
 */

/** The canvas language by default: base texts are the source language; Bangla is a translation (B10: "Edit in"). */
export const EDITOR_LOCALE = 'en'

const AUTOSCROLL_EDGE = 48

/** Calls the canvas handle when it is mounted. */
function onCanvas(canvas: RefObject<CanvasHandle | null>, run: (handle: CanvasHandle) => void) {
  if (canvas.current) run(canvas.current)
}

/** B12: a dialog opened from a key pressed in the canvas gets the focus (the canvas iframe keeps it otherwise). */
function takeFocusFromCanvas() {
  const active = document.activeElement
  if (active instanceof HTMLIFrameElement) {
    window.focus()
    active.blur()
  }
}

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

/** B16: no drag sensors while someone else edits the page. */
const NO_SENSORS: ReturnType<typeof useSensors> = []

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
  // B11: people who may edit but not publish send the draft for approval.
  const canSubmit = can('storefront.manage') && !canPublish
  const canCustomHtml = can('storefront.custom_html')
  const queryClient = useQueryClient()
  const canvas = useRef<CanvasHandle | null>(null)
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [copySectionId, setCopySectionId] = useState<string | null>(null)
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
  // B12: the undo history survives a reload (per store, document and draft revision).
  useUndoMemory(store, org)
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
      requestDelete: (id: string) => setDeleteIds([id]),
      requestDeleteMany: setDeleteIds,
      requestCopyToPages: single || !canCopySectionsFrom(documentKind) ? undefined : setCopySectionId,
      canCustomHtml,
      context,
      template: documentTemplate({ kind: documentKind, key: documentKey }),
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
        <ExperimentsProvider autosave={autosave}>
          <EditorLayout autosave={autosave} canPublish={canPublish} canSubmit={canSubmit} canCustomHtml={canCustomHtml} canvasContext={canvasContext} registry={registry} queryClient={queryClient} />
        </ExperimentsProvider>
        <DeleteConfirm ids={deleteIds} onClose={() => setDeleteIds([])} />
        <CopyToPages id={copySectionId} onClose={() => setCopySectionId(null)} />
        <SaveTemplate id={saveTemplateId} onClose={() => setSaveTemplateId(null)} />
        <MakeGlobalDialog sectionId={makeGlobalId} onClose={() => setMakeGlobalId(null)} />
        <DetachConfirm refId={detachId} onClose={() => setDetachId(null)} />
      </TooltipProvider>
    </EditorUiContext>
  )
}

function DeleteConfirm({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const content = useEditor((s) => s.content)
  const commands = useCommands()
  const { registry } = useEditorUi()
  const id = ids.length === 1 ? ids[0]! : null
  const info = findNode(content, id)
  const label = info ? nodeLabel(info.node, registry) : ''
  // B12: several items, one confirmation, one undo step.
  const many = ids.length > 1 ? selectedNodes(content, ids).filter((n) => n.kind !== 'column') : []
  if (ids.length > 1) {
    const sections = many.filter((n) => n.kind === 'section').length
    return (
      <ConfirmDialog
        open={many.length > 0}
        onOpenChange={(open) => !open && onClose()}
        title={`Delete these ${many.length} items?`}
        description={`${sections > 0 ? `${sections === 1 ? 'A section is' : `${sections} sections are`} removed with everything in ${sections === 1 ? 'it' : 'them'}. ` : ''}You can undo this in one step.`}
        confirmLabel={`Delete ${many.length} items`}
        onConfirm={() => {
          commands.removeMany(ids)
          onClose()
        }}
      />
    )
  }
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

/** B12: "Copy to other pages…" for the section `id` of the draft as it is now. */
function CopyToPages({ id, onClose }: { id: string | null; onClose: () => void }) {
  const content = useEditor((s) => s.content)
  const documentId = useEditor((s) => s.document.id)
  const info = findNode(content, id)
  const section = info?.kind === 'section' ? (info.node as DocumentSection) : null
  return <CopyToPagesDialog section={section} openId={documentId} onClose={onClose} />
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
  canSubmit: boolean
  canCustomHtml: boolean
  canvasContext: CanvasContext
  registry: ElementsMetadata
  queryClient: ReturnType<typeof useQueryClient>
}

/** Where a published header, footer or zone can be seen on the store (version history's "View"). */
function livePath(doc: { kind: string; key: string; path: string | null; preview_product?: { slug: string } | null }): string | null {
  if (doc.path) return doc.path
  if (doc.kind === 'header' || doc.kind === 'footer') return '/'
  // B14: a store page design on a page that needs no record (shop, search).
  const template = documentTemplate(doc)
  if (template) return templateLivePath(template)
  if (doc.key === 'zone:listing.top' || doc.key === 'zone:listing.bottom') return '/shop'
  // P1b: a product zone (or one of its versions) on the matching live product.
  if (doc.kind === 'zone' && doc.preview_product?.slug) return `/product/${encodeURIComponent(doc.preview_product.slug)}`
  return null
}

function EditorLayout({ autosave, canPublish, canSubmit, canCustomHtml, canvasContext, registry, queryClient }: LayoutProps) {
  const store = useEditorStoreApi()
  const commands = useCommands()
  const content = useEditor((s) => s.content)
  const selection = useEditor((s) => s.selection)
  const selectedIds = useSelectedIds()
  const several = selectedIds.length > 1
  const hover = useEditor((s) => s.hover)
  const device = useEditor((s) => s.device)
  const errors = useEditor((s) => s.errors)
  const localMedia = useEditor((s) => s.localMedia)
  const documentInfo = useEditor((s) => s.document)
  const saveStatus = useEditor((s) => s.saveState.status)
  const select = useEditor((s) => s.select)
  const setHover = useEditor((s) => s.setHover)
  const editLocale = useEditor((s) => s.editLocale)
  const { canvas, globals, single = false } = useEditorUi()
  const bangla = canvasContext.locales.includes('bn')
  // B10: Bangla on the canvas only while the store has it.
  const canvasLocale = bangla ? editLocale : EDITOR_LOCALE
  // B4: what this document is (page, header, footer, zone) and which elements it may hold.
  const info = useMemo(() => kindInfo(documentInfo), [documentInfo])
  const context = elementContext(documentInfo)
  // B14: a store page design previews with a sample (category, brand, post, order …); normal pages give live text the store's fields.
  // Only the two fields it needs (passing documentInfo itself makes the React Compiler treat it as mutable).
  const template = documentTemplate({ kind: documentInfo.kind, key: documentInfo.key })
  const templateSample = useTemplateSampleState({ template, lang: canvasLocale, bootstrap: canvasContext.bootstrap })
  const showSample = hasSamplePicker(template)
  const livesText = context === 'page' || context === 'cms' || context === 'template'
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
  // B12: the command box (Ctrl/Cmd+K) and the keyboard shortcut sheet (?).
  const [commandOpen, setCommandOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // B18: the Motion themes dialog and the section's Motion timeline panel.
  const { ui: motionUi, themesOpen: motionThemesOpen, setThemesOpen: setMotionThemesOpen, openThemes: openMotionThemes, timelineId, closeTimeline } = useMotionStudio()
  const openTimeline = motionUi.openTimeline
  // Escape that reaches the editor from the canvas (focus not yet moved into the dialog) closes them too.
  const overlaysOpen = useRef(false)
  useEffect(() => {
    overlaysOpen.current = commandOpen || shortcutsOpen
  }, [commandOpen, shortcutsOpen])
  // B11: approval and the store's timezone (planned publishes are chosen in it).
  const timeZone = useCurrentUserQuery().data?.organization?.timezone
  // B15: Insights for builder pages (home, campaign and content pages).
  const canViewInsights = useCan()('storefront.view')
  const insights = useInsights({ documentId: documentInfo.id, available: documentInfo.kind === 'page' && template === null && canViewInsights, timeZone })
  const setInsightsOpen = insights.setOpen
  // B13: the A/B tests panel (pages and shop areas).
  const ab = useExperimentsUi()
  const abAvailable = ab !== null && canHaveExperiments(documentInfo.kind)
  const abCount = useEditor((s) => experimentsOf(s.content).length)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitPending, setSubmitPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)

  /* ---------------------------------------------------------------- B16 presence & comments - */
  const currentUser = useCurrentUserQuery().data
  const meId = currentUser?.user.id ?? null
  const canManage = useCan()('storefront.manage')
  const presenceUi = usePresence({ store, autosave, org: currentUser?.organization?.id ?? '', canManage, canPublish })
  const readOnly = useEditor((s) => s.readOnly)
  const presence = presenceUi.presence
  const people = useMemo(() => otherViewers(presence?.viewers ?? [], meId), [presence, meId])
  const comments = useComments({ documentId: documentInfo.id, stamp: presence?.comments?.updated_at, presenceOpen: presence?.comments?.open })
  const setCommentsOpen = comments.setOpen
  const [addressOpen, setAddressOpen] = useState(false)

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
    if (several) return null
    const info = findNode(content, selection)
    if (!info) return null
    const row = info.kind === 'column' ? findNode(content, info.parentId)?.node : info.node
    if (!row || (row.type !== 'section' && row.type !== 'inner_row')) return null
    const columns = (row as Section | InnerRowElement).columns as Column[]
    if (columns.length < 2) return null
    return { rowId: row.id, columns: columns.map((column) => ({ id: column.id, width: widthAt(column.width, breakpoint).value ?? 100 })) }
  }, [content, selection, breakpoint, several])
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
  const preview = usePreviewData(expanded.content, { locale: canvasLocale, localMedia, enabled: true })
  // Scheduled nodes change state with time: the clock the canvas tree is computed with ticks each minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const revealKey = selectedIds.join(',')
  const sections = useMemo<RenderSection[]>(
    () => toRenderTree(expanded.content, { locale: canvasLocale, now, reveal: revealKey ? revealKey.split(',') : null }),
    [expanded, revealKey, now, canvasLocale],
  )
  // B13: "Preview as" (null = show everything) and the "Who sees this" badges on the canvas.
  const previewContext = usePreviewContext()
  const audience = useAudienceBadges(expanded.content, previewContext)
  // B18 (editor A): "Preview motion" runs loops and text effects on the canvas; "▶ Play page" plays every entrance in order.
  const previewMotion = useEditor((s) => s.previewMotion)
  const playPage = () => onCanvas(canvas, (handle) => handle.playMotion(store.getState().content.sections[0]?.id ?? '', 'page'))
  // B13: one version of each A/B test on the canvas, with its "Showing version A | B" switch.
  const canvasArms = useCanvasArms(sections)
  // B12: the phone / tablet order the canvas draws with (globals' column orders merged in).
  const canvasDeviceOrder = useMemo(() => mergedDeviceOrder(content, globals ?? new Map()), [content, globals])
  // The inspector looks things up in the drawn document; nodes it can't show (unavailable globals) are left out.
  const inspectorContent = useMemo(
    () => (expanded.content === content ? content : { ...expanded.content, sections: expanded.content.sections.filter((s) => Array.isArray(s.columns)) }),
    [expanded, content],
  )
  /** A canvas id inside a drawn global section is its reference's. */
  const ownerOf = useCallback((id: string | null) => (id ? (expanded.owners.get(id) ?? id) : null), [expanded])
  const errorIds = useMemo(() => [...Object.keys(errors), ...Object.keys(preview.errors)].filter((id) => id !== ''), [errors, preview.errors])
  const selectedInfo = findNode(content, selection)

  /* ---------------------------------------------------------------- B10 edit on the page -- */
  const [uploads, setUploads] = useState<Record<string, NodeUpload>>({})
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const [linkRequest, setLinkRequest] = useState<{ url: string | null } | null>(null)
  const fontsQuery = useStoreFonts()
  const fonts = fontsQuery.data?.fonts

  /** A node of a drawn global section is edited in the global's own document. */
  const insideGlobal = useCallback((id: string) => ownerOf(id) !== id, [ownerOf])
  const GLOBAL_NOTE = 'This is part of a global section. Open the global section to change it — every page that uses it changes too.'

  const applyPicture = useCallback(
    (id: string, mediaId: string, media?: { url: string; srcset: string; width: number; height: number; alt: string | null; focal?: { x: number; y: number } | null }) => {
      const state = store.getState()
      const bp = BREAKPOINT[state.device]
      return state.apply((c) => setNodePicture(c, id, mediaId, bp), { select: id, ...(media ? { media: { [mediaId]: media } } : {}) })
    },
    [store],
  )

  const dropPicture = useCallback(
    async (id: string, file: File) => {
      if (store.getState().readOnly) return void noteBlocked(store)
      if (insideGlobal(id)) return void toast.info(GLOBAL_NOTE)
      const problem = pictureFileProblem(file)
      if (problem) return void toast.error(problem)
      if (!dropTargetOf(findNode(store.getState().content, id)?.node, BREAKPOINT[store.getState().device])) {
        return void toast.error('Drop the picture on a picture, or on a section that has a background picture.')
      }
      setUploads((u) => ({ ...u, [id]: { progress: null, name: file.name } }))
      try {
        const item = await uploadPicture(file, { onProgress: (progress) => setUploads((u) => (u[id] ? { ...u, [id]: { ...u[id]!, progress } } : u)) })
        if (applyPicture(id, item.id, item)) toast.success(`“${file.name}” is in your media library and on the page. Undo puts the old picture back.`)
      } catch (error) {
        toast.error(uploadErrorMessage(error, file.name))
      } finally {
        setUploads((u) => {
          const next = { ...u }
          delete next[id]
          return next
        })
      }
    },
    [applyPicture, insideGlobal, store],
  )

  const onCanvasEdit = useCallback(
    (message: CanvasEditMessage) => {
      const state = store.getState()
      // B16: someone else is editing — nothing changes on the page; say why.
      if (state.readOnly && message.type !== 'text-edit-cancel' && message.type !== 'text-edit-link') {
        if (message.type === 'text-edit-start') onCanvas(canvas, (c) => c.endTextEdit(false))
        if (message.type === 'text-edit-commit') onCanvas(canvas, (c) => c.rerender())
        return void noteBlocked(store)
      }
      switch (message.type) {
        case 'text-edit-start':
          if (insideGlobal(message.id)) {
            onCanvas(canvas, (c) => c.endTextEdit(false))
            return void toast.info(GLOBAL_NOTE)
          }
          if (state.selection !== message.id) state.select(message.id)
          return
        case 'text-edit-commit': {
          // A refused or unchanged commit still gets a render, so the canvas shows the text as it is at once.
          const redraw = () => onCanvas(canvas, (c) => c.rerender())
          if (insideGlobal(message.id)) {
            redraw()
            return void toast.info(GLOBAL_NOTE)
          }
          const result = applyTextEdit(state.content, message, { context, bangla })
          if (!result.ok) {
            redraw()
            return void toast.error(result.message)
          }
          if (!result.changed || !state.apply(() => result.content, { select: message.id })) redraw()
          if (result.note) toast.info(result.note)
          return
        }
        case 'text-edit-cancel':
          return
        case 'text-edit-link':
          setLinkRequest({ url: message.url })
          return
        case 'image-drop':
          return void dropPicture(message.id, message.file)
        case 'image-replace':
          if (insideGlobal(message.id)) return void toast.info(GLOBAL_NOTE)
          if (state.selection !== message.id) state.select(message.id)
          setReplaceId(message.id)
          return
      }
    },
    [store, insideGlobal, canvas, context, bangla, dropPicture, setLinkRequest, setReplaceId],
  )

  // An edit in progress ends when another node is chosen (committed), on a device switch (committed) or an undo / redo (cancelled).
  useEffect(() => {
    onCanvas(canvas, (c) => {
      const editing = c.editing()
      if (editing && editing !== selection) c.endTextEdit(true)
    })
  }, [selection, canvas])
  useEffect(() => {
    onCanvas(canvas, (c) => c.endTextEdit(true))
  }, [device, canvas])
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.history.future.length !== previous.history.future.length && state.history.future.length > 0 && state.content !== previous.content && state.lastEdit === null) {
          onCanvas(canvas, (c) => c.endTextEdit(false))
        }
      }),
    [store, canvas],
  )

  /** Starts editing the selected element's text on the canvas (Enter, the mini toolbar). */
  const editText = useCallback(
    (id: string) => {
      if (store.getState().readOnly) return void noteBlocked(store)
      if (insideGlobal(id)) return void toast.info(GLOBAL_NOTE)
      const field = firstInlineField(store.getState().content, id)
      if (field === null) return
      onCanvas(canvas, (c) => c.editText(id))
    },
    [store, canvas, insideGlobal],
  )

  /* ---------------------------------------------------------------- B10 spacing handles ---- */
  const spacingSession = useRef<string | null>(null)
  const onSpacing = useCallback<SpacingTarget['onChange']>(
    (box, side, px, phase) => {
      const state = store.getState()
      const id = state.selection
      if (!id) return
      spacingSession.current ??= `spacing:${id}:${box}:${side}:${Date.now()}`
      state.apply((c) => setSpacing(c, id, BREAKPOINT[state.device], box, side, px), { coalesceKey: spacingSession.current, coalesceWindow: Number.POSITIVE_INFINITY })
      if (phase === 'end') spacingSession.current = null
    },
    [store],
  )
  const spacing = useMemo<SpacingTarget | null>(() => {
    if (several) return null
    const info = findNode(content, selection)
    if (!info || globalRefOf(info.node) || !hasSpacingHandles(info.node)) return null
    const style = (info.node as { style?: Parameters<typeof spacingAt>[0] }).style
    const at = (box: 'padding' | 'margin', side: 'top' | 'bottom') => spacingAt(style, breakpoint, box, side)
    return {
      nodeId: info.node.id,
      label: nodeLabel(info.node, registry).toLowerCase(),
      deviceLabel: DEVICE_LABEL[device].toLowerCase(),
      values: { padding: { top: at('padding', 'top'), bottom: at('padding', 'bottom') }, margin: { top: at('margin', 'top'), bottom: at('margin', 'bottom') } },
      onChange: onSpacing,
      guides: spacingGuides(content, info.node.id, breakpoint),
    }
  }, [content, selection, breakpoint, device, registry, onSpacing, several])

  /* ---------------------------------------------------------------- B10 page check --------- */
  const [checkOpen, setCheckOpen] = useState(false)
  // B13: opening the A/B tests panel puts away Check page and Insights.
  const setAbBeforeOpen = ab?.setBeforeOpen
  useLayoutEffect(() => {
    setAbBeforeOpen?.(() => {
      setCheckOpen(false)
      setInsightsOpen(false)
      setCommentsOpen(false)
    })
    return () => setAbBeforeOpen?.(null)
  }, [setAbBeforeOpen, setInsightsOpen, setCommentsOpen])
  const checkTheme = useMemo(() => {
    // B15: the fonts in use feed the speed check ("Use fewer fonts").
    const typo = (themeSettings?.typography ?? canvasContext.bootstrap.theme.typography) as
      | { heading_font?: string; body_font?: string; bangla_heading_font?: string | null; bangla_body_font?: string | null }
      | undefined
    return {
      colors: inspectorTheme.colors,
      container_width: (themeSettings?.layout as { container_width?: number } | undefined)?.container_width ?? canvasContext.bootstrap.theme.layout?.container_width,
      fonts: {
        heading: typo?.heading_font,
        body: typo?.body_font,
        bangla_heading: typo?.bangla_heading_font ?? null,
        bangla_body: typo?.bangla_body_font ?? null,
        // Unknown (undefined) while the list loads: an empty list would count fonts in use as deleted.
        custom: fonts?.map((f) => ({ key: f.key, name: f.name, size: f.size })),
      },
    }
  }, [inspectorTheme.colors, themeSettings, canvasContext.bootstrap.theme.layout, canvasContext.bootstrap.theme.typography, fonts])
  const check = usePageCheck({ content: expanded.content, draft: content, documentId: documentInfo.id, document: { kind: documentInfo.kind, key: documentInfo.key }, theme: checkTheme, media: preview.media })
  const runServerCheck = check.runServer
  const [focus, setFocus] = useState<{ nodeId: string | null; tab: PageCheckTab; field: string | null; token: number } | null>(null)
  const openCheck = useCallback(() => {
    setCheckOpen(true)
    setInsightsOpen(false)
    setCommentsOpen(false)
    void runServerCheck(store.getState().content)
  }, [runServerCheck, store, setCheckOpen, setInsightsOpen, setCommentsOpen])
  const showIssue = useCallback(
    (issue: PageCheckIssue) => {
      const id = issue.node_id ? ownerOf(issue.node_id) : null
      const state = store.getState()
      state.select(id && findNode(state.content, id) ? id : null)
      if (id) commands.reveal(id)
    },
    [ownerOf, store, commands],
  )
  const runFix = useCallback(
    (issue: PageCheckIssue) => {
      const fix = issue.fix
      if (!fix) return
      const state = store.getState()
      if (fix.kind === 'site-styles') return setStylesOpen(true)
      // B14: a store page's missing main part, added as from the Add panel.
      if (fix.kind === 'insert') return void commands.insert(fix.type)
      if (fix.kind === 'apply') {
        if (insideGlobal(fix.node_id)) return void toast.info(GLOBAL_NOTE)
        if (state.apply((c) => applyPageCheckFix(c, fix), { select: fix.node_id })) {
          commands.reveal(fix.node_id)
          toast.success('Fixed. Undo puts it back.')
        }
        return
      }
      const owner = fix.node_id ? ownerOf(fix.node_id) : null
      if (fix.node_id && owner !== fix.node_id) {
        state.select(owner)
        return void toast.info(GLOBAL_NOTE)
      }
      state.select(owner)
      if (owner) commands.reveal(owner)
      setFocus((f) => ({ nodeId: owner, tab: fix.tab, field: fix.field, token: (f?.token ?? 0) + 1 }))
    },
    [store, commands, ownerOf, insideGlobal],
  )

  /* ---------------------------------------------------------------- shortcuts -------------- */
  // B16: "C" adds a comment on the selection (or the page); Esc leaves comment mode.
  const commentKeys = useRef<{ mode: boolean; add: () => void; stop: () => void }>({ mode: false, add: () => undefined, stop: () => undefined })
  const startComment = comments.startDraft
  const setCommentMode = comments.setMode
  useLayoutEffect(() => {
    commentKeys.current = {
      mode: comments.mode,
      add: () => {
        const selected = store.getState().selection
        const owner = ownerOf(selected)
        startComment(owner ? { nodeId: owner, anchor: KEYBOARD_ANCHOR } : { nodeId: null, anchor: null })
      },
      stop: () => setCommentMode(false),
    }
  })
  const handleKey = useCallback(
    (key: { key: string; ctrl: boolean; shift: boolean; meta: boolean }): boolean => {
      const state = store.getState()
      const mod = key.ctrl || key.meta
      const k = key.key.toLowerCase()
      if (key.key === 'Escape' && overlaysOpen.current) {
        setCommandOpen(false)
        setShortcutsOpen(false)
        return true
      }
      if (key.key === 'Escape' && commentKeys.current.mode) {
        commentKeys.current.stop()
        return true
      }
      if (!mod && k === 'c') {
        takeFocusFromCanvas()
        commentKeys.current.add()
        return true
      }
      // B16: someone else is editing — undo, redo, duplicate, paste, delete and text editing are off.
      if (state.readOnly && ((mod && ['z', 'y', 'd', 'v'].includes(k)) || (!mod && ['delete', 'backspace', 'enter'].includes(k)))) {
        noteBlocked(store)
        return true
      }
      if (mod && k === 'z') {
        if (key.shift) state.redo()
        else state.undo()
        return true
      }
      if (mod && k === 'y') {
        state.redo()
        return true
      }
      // B12: the command box and the shortcut sheet.
      if (mod && k === 'k') {
        takeFocusFromCanvas()
        setCommandOpen(true)
        return true
      }
      if (!mod && key.key === '?') {
        takeFocusFromCanvas()
        setShortcutsOpen(true)
        return true
      }
      const several = state.selectedIds.length > 1
      if (mod && k === 'd' && state.selection) {
        if (several) commands.duplicateMany(state.selectedIds)
        else commands.duplicate(state.selection)
        return true
      }
      // B9: from the canvas (the editor's own copy / paste events handle the rest of the window).
      if (mod && k === 'c') {
        if (several) commands.copyMany(state.selectedIds)
        else if (state.selection) commands.copy(state.selection)
        return true
      }
      if (mod && k === 'v') {
        commands.paste(null)
        return true
      }
      if (mod) return false
      if ((k === 'delete' || k === 'backspace') && several) {
        commands.requestDeleteMany(state.selectedIds)
        return true
      }
      if ((k === 'delete' || k === 'backspace') && state.selection) {
        const info = findNode(state.content, state.selection)
        if (info && info.kind !== 'column') commands.requestDelete(state.selection)
        return true
      }
      // B10: Enter edits the selected element's text on the canvas.
      if (k === 'enter' && state.selection && !key.shift && !several) {
        if (firstInlineField(state.content, state.selection) === null) return false
        editText(state.selection)
        return true
      }
      if (k === 'escape') {
        // B12: Esc clears a selection of several items.
        if (several) {
          state.clearSelection()
          return true
        }
        const info = findNode(state.content, state.selection)
        state.select(info?.parentId ?? null)
        return true
      }
      if (k === 'arrowup' || k === 'arrowdown') {
        // B12: on a tablet or phone the canvas shows things in that device's order.
        const rows = flattenLayers(state.content, state.device)
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
    [commands, store, editText],
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
      // Enter on a button, link or tree row is theirs; on the page it edits the selected text.
      if (event.key === 'Enter' && target && target !== document.body && (target.closest('button, a, [role="tree"], [role="slider"], [role="separator"]') || !target.closest('[data-canvas-keys]'))) return
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
      const { selection: selected, selectedIds: ids } = store.getState()
      if (!selected) return
      const text = ids.length > 1 ? commands.copyMany(ids, { system: false }) : commands.copy(selected, { system: false })
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

  const openPreviewRef = useRef<() => Promise<void>>(async () => undefined)
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

  useLayoutEffect(() => {
    openPreviewRef.current = openPreview
  })

  /** Saves the latest changes first; null when saved, else why not (for the dialog). */
  const saveFirst = async (verb: string): Promise<string | null> => {
    if (await autosave.flush()) return null
    const state = store.getState()
    const count = problemCount(state.errors)
    if (state.saveState.status === 'invalid') return `Fix the ${count} ${count === 1 ? 'problem' : 'problems'} on this page first (marked in red), then ${verb}.`
    if (state.saveState.status === 'conflict') return 'This page changed somewhere else. Choose which version to keep first.'
    if (state.saveState.status === 'locked' || state.readOnly) return 'Someone else is editing this page. Ask to edit or take over first.'
    return 'Your latest changes could not be saved. Check your connection and try again.'
  }

  /** A 422 from publish, schedule or submit: problems go on the page, the message in the dialog. */
  const refusal = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError && error.status === 422) {
      if (error.code === 'DOCUMENT_INVALID') store.getState().setErrors(problemsByNode(error))
      return error.code === 'DOCUMENT_EMPTY' ? `Add something to the ${info.noun} first.` : error.message
    }
    return error instanceof Error ? error.message : fallback
  }

  const publish = async (note: string | null, options: { cancelSchedule?: boolean } = {}) => {
    setPublishPending(true)
    setPublishError(null)
    try {
      const unsaved = await saveFirst('publish')
      if (unsaved) {
        setPublishError(unsaved)
        return
      }
      const detail = await publishDocument(documentInfo.id, note, options)
      store.getState().setDocument({
        published: detail.published,
        preview_url: detail.preview_url ?? store.getState().document.preview_url,
        ...('schedule' in detail ? { schedule: detail.schedule ?? null } : {}),
        ...('review' in detail ? { review: detail.review ?? null } : {}),
      })
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
      setPublishError(error instanceof ApiError && error.status === 422 && error.code === 'DOCUMENT_EMPTY' ? `Add something to the ${info.noun} before publishing it.` : refusal(error, 'Could not publish.'))
    } finally {
      setPublishPending(false)
    }
  }

  /** B11 "Publish later": the saved draft goes live at `publishAt` (it replaces a pending plan). */
  const scheduleLater = async (publishAt: string, note: string | null) => {
    setPublishPending(true)
    setPublishError(null)
    try {
      const unsaved = await saveFirst('schedule it')
      if (unsaved) {
        setPublishError(unsaved)
        return
      }
      const detail = await schedulePublish(documentInfo.id, { publish_at: publishAt, note })
      const schedule = detail?.schedule ?? null
      store.getState().setDocument({ schedule, ...('review' in (detail ?? {}) ? { review: detail.review ?? null } : {}) })
      setPublishOpen(false)
      toast.success(`Scheduled. The ${info.noun} goes live on ${formatStoreTime(schedule?.publish_at ?? publishAt, timeZone)}, as it is now.`)
      refreshList()
    } catch (error) {
      setPublishError(refusal(error, 'Could not schedule it.'))
    } finally {
      setPublishPending(false)
    }
  }

  const cancelPlanned = async () => {
    const planned = store.getState().document.schedule
    try {
      const detail = await cancelSchedule(documentInfo.id)
      store.getState().setDocument({ schedule: detail?.schedule ?? null })
      toast.success(`Cancelled. The ${info.noun} won’t go live on ${formatStoreTime(planned?.publish_at, timeZone)}.`)
      refreshList()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOTHING_SCHEDULED') {
        store.getState().setDocument({ schedule: null })
        toast.info('Nothing is planned any more — it may have gone live or been cancelled already.')
        refreshList()
        return
      }
      toast.error(error instanceof Error ? error.message : 'It couldn’t be cancelled. Try again.')
    }
  }

  /** B11: the saved draft is sent for approval. */
  const submitReview = async (note: string | null) => {
    setSubmitPending(true)
    setSubmitError(null)
    try {
      const unsaved = await saveFirst('submit it')
      if (unsaved) {
        setSubmitError(unsaved)
        return
      }
      const review = await submitForReview(documentInfo.id, note)
      store.getState().setDocument({ review })
      setSubmitOpen(false)
      toast.success('Submitted for review. You’ll get a notification when it is approved or sent back.')
      refreshList()
    } catch (error) {
      setSubmitError(refusal(error, 'Could not submit it.'))
    } finally {
      setSubmitPending(false)
    }
  }

  /** B11: the submitter takes a pending request back (the draft stays). */
  const withdraw = async () => {
    const review = store.getState().document.review
    if (!review) return
    try {
      await withdrawReview(review.id)
      store.getState().setDocument({ review: null })
      toast.success('Request withdrawn. Your draft stays as it is.')
      refreshList()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REVIEW_NOT_PENDING') {
        toast.info('Someone already decided on this request.')
        void reviewDecided()
        return
      }
      toast.error(error instanceof Error ? error.message : 'It couldn’t be withdrawn. Try again.')
    }
  }

  /** After a decision on this document's review: where it stands now (the draft stays as it is). */
  const reviewDecided = async () => {
    try {
      const detail = await fetchDocument(documentInfo.id)
      store.getState().setDocument({ published: detail.published, schedule: detail.schedule ?? null, review: detail.review ?? null })
    } catch {
      // The chips catch up on the next open.
    }
    refreshList()
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

  const restore = (entry: VersionEntry) =>
    replaceDraft(
      () => restoreVersion(documentInfo.id, entry.id),
      `${entry.kind === 'version' && entry.number !== null && !entry.name ? `Version ${entry.number}` : `“${entryTitle(entry)}”`} is now your draft. Publish to make it live.`,
    ).then(() => setHistoryOpen(false))

  /** B11: what compare needs (the draft as drawn now, the theme, element names). */
  const compareSupport: CompareSupport = {
    bootstrap: canvasContext.bootstrap,
    surroundings,
    emptyText: `Nothing on this ${info.noun} yet.`,
    theme: themeSettings as CanvasThemeSettings | null,
    draft: () => ({ sections: toRenderTree(expanded.content, { locale: EDITOR_LOCALE, now: Date.now() }), data: preview.data, media: preview.media, popup: popupSettings ?? null }),
    typeLabel: (type) => registry.types.find((t) => (t.type as string) === type)?.label ?? (type === 'section' ? 'Section' : type === 'column' ? 'Column' : type),
  }

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
        // B12: on a tablet or phone the canvas draws the device's order; positions are worked out on it.
        setCanvasDrop(computeDropTarget(deviceView(state.content, state.device), canvas.current.rects(), point, item, viewport.w))
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
    const result = layerDropTarget(deviceView(state.content, state.device), overData.nodeId, half, item)
    setLayerDrop(result ? { target: result.target, indicator: { rowId: result.rowId, position: result.position } } : null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const item = (event.active.data.current as { dragged?: Dragged } | undefined)?.dragged
    const dropped = canvasDrop?.target ?? layerDrop?.target ?? null
    resetDrag()
    if (!item || !dropped) return
    // B12: in Tablet / Mobile view a move within its own place changes only that device's order.
    const state = store.getState()
    const resolved = resolveDeviceDrop(state.content, state.device, item, dropped)
    if (resolved.kind === 'device') {
      if (item.kind === 'node' && state.apply(resolved.edit, { select: item.id })) commands.reveal(item.id)
      return
    }
    const target = resolved.target
    if (resolved.movesEverywhere && item.kind === 'node') toast.info(`Moved on all devices (computer, tablet and phone). To change only the ${DEVICE_LABEL[state.device].toLowerCase()} order, move it within its own column or among the sections.`)
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
  // B12: several selected — the inspector shows the Common style form for them (global section references left out).
  const inspectorNodes = useMemo<BuilderNode[] | undefined>(
    () => (several ? selectedNodes(content, selectedIds).map((n) => n.node).filter((node) => !isGlobalRef(node)) : undefined),
    [several, content, selectedIds],
  )
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
  /* ---------------------------------------------------------------- B12 command box --------- */
  const commandActions = useMemo<CommandActions>(
    () => ({
      publish: canPublish && !readOnly
        ? () => {
            setPublishError(null)
            setPublishOpen(true)
            void runServerCheck(store.getState().content)
          }
        : null,
      submit:
        !canPublish && canSubmit && !readOnly
          ? () => {
              setSubmitError(null)
              setSubmitOpen(true)
              void runServerCheck(store.getState().content)
            }
          : null,
      preview: documentInfo.preview_url ? () => void openPreviewRef.current() : null,
      check: openCheck,
      history: () => setHistoryOpen(true),
      styles: () => setStylesOpen(true),
      shortcuts: () => setShortcutsOpen(true),
      motion: openMotionThemes,
    }),
    [canPublish, canSubmit, runServerCheck, store, documentInfo.preview_url, openCheck, readOnly, openMotionThemes],
  )
  const insightsShown = insights.open && !checkOpen
  const abShown = abAvailable && ab.open && !checkOpen && !insightsShown
  const commentsShown = comments.open && !checkOpen && !insightsShown && !abShown
  const commandItems = useCommandItems(commandOpen, commandActions, single ? null : templates)

  const labelOf = useCallback((id: string) => {
    const info = findNode(store.getState().content, ownerOf(id))
    return info ? nodeName(info.node, registry, globals) : ''
  }, [registry, store, ownerOf, globals])

  /* ---------------------------------------------------------------- B16 comments ----------- */
  /** A global section reference is drawn as its global's section: the first drawn id it owns. */
  const drawIds = useMemo(() => {
    const result = new Map<string, string>()
    for (const [inner, owner] of expanded.owners) if (!result.has(owner)) result.set(owner, inner)
    return result
  }, [expanded])
  const showNode = useCallback(
    (id: string) => {
      const state = store.getState()
      if (!findNode(state.content, id)) return
      state.select(id)
      commands.reveal(id)
    },
    [store, commands],
  )
  const commentLabel = useCallback((id: string) => {
    const found = findNode(content, id)
    return found ? nodeName(found.node, registry, globals) : null
  }, [content, registry, globals])
  const { threads: commentThreads, numbers: commentNumbers, activeId: activeThread, setActiveId: setActiveThread, setFilter: setCommentFilter } = comments
  const pickThread = useCallback(
    (id: string) => {
      const thread = commentThreads.find((t) => t.id === id)
      setActiveThread(id)
      setCommentFilter(thread && !isOpen(thread) ? 'resolved' : 'open')
      if (thread?.node_id) showNode(thread.node_id)
    },
    [commentThreads, setActiveThread, setCommentFilter, showNode],
  )
  const pinLayer = useMemo<CommentPinLayer | null>(() => {
    if (!commentsShown) return null
    const pins = commentThreads
      .filter((t) => (isOpen(t) || t.id === activeThread) && t.node_id !== null && !t.node_removed && findNode(content, t.node_id) !== null)
      .map((t) => {
        const number = commentNumbers.get(t.id) ?? 0
        const nodeId = t.node_id!
        return {
          id: t.id,
          number,
          drawId: drawIds.get(nodeId) ?? nodeId,
          anchor: t.anchor,
          active: t.id === activeThread,
          label: `Comment ${number}${t.author ? ` by ${t.author.name}` : ''}: ${t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body}`,
        }
      })
    return { pins, onPick: pickThread }
  }, [commentsShown, commentThreads, activeThread, commentNumbers, content, drawIds, pickThread])
  /** Comment mode: the part of the page clicked on gets a pin where it was clicked. */
  const dropComment = useCallback(
    (point: { x: number; y: number }) => {
      const rects = canvas.current?.rects() ?? {}
      const hit = hitNode(rects, point, (id) => {
        const found = findNode(expanded.content, id)
        return found !== null && found.kind !== 'column'
      })
      if (!hit) return void toast.info('Click on a section or an element of the page.')
      const owner = ownerOf(hit) ?? hit
      const rect = rects[owner === hit ? hit : (drawIds.get(owner) ?? hit)] ?? rects[hit]!
      store.getState().select(owner)
      startComment({ nodeId: owner, anchor: anchorIn(rect, point) })
    },
    [canvas, expanded, ownerOf, drawIds, store, startComment],
  )
  // B16: a bell notification opens the editor at a comment (`?comment=<thread id>`).
  const [searchParams, setSearchParams] = useSearchParams()
  const deepComment = searchParams.get('comment')
  const deepTried = useRef<string | null>(null)
  const refreshComments = comments.refresh
  const commentsLoading = comments.loading
  useEffect(() => {
    if (!deepComment || commentsLoading) return
    const thread = commentThreads.find((t) => t.id === deepComment || t.replies.some((r) => r.id === deepComment))
    if (!thread && deepTried.current !== deepComment) {
      // Maybe newer than what we have: fetch again once.
      deepTried.current = deepComment
      void refreshComments()
      return
    }
    setSearchParams((params) => {
      params.delete('comment')
      return params
    }, { replace: true })
    setCheckOpen(false)
    setInsightsOpen(false)
    ab?.setOpen(false)
    setCommentsOpen(true)
    if (!thread) return void toast.info('That comment was deleted.')
    pickThread(thread.id)
  }, [deepComment, commentsLoading, commentThreads, refreshComments, setSearchParams, setInsightsOpen, ab, setCommentsOpen, pickThread])
  const toggleComments = () => {
    if (commentsShown) return comments.setOpen(false)
    setCheckOpen(false)
    setInsightsOpen(false)
    ab?.setOpen(false)
    comments.setOpen(true)
  }
  const selectionForComment = useMemo(() => {
    const owner = ownerOf(selection)
    const found = owner ? findNode(content, owner) : null
    return found && found.kind !== 'column' ? { id: found.node.id, label: nodeName(found.node, registry, globals) } : null
  }, [selection, ownerOf, content, registry, globals])

  /* ---------------------------------------------------------------- B16 download a copy ---- */
  const downloadCopy = async () => {
    if (!(await autosave.flush())) toast.warning('Your latest changes are not saved yet — the copy has the last saved draft.')
    try {
      const name = await downloadExport(documentInfo.id, documentInfo.title)
      toast.success(`“${name}” is downloaded. Import it from the Page builder screen of this store or another one.`)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EXPORT_TOO_LARGE') {
        toast.error('This page is too big to download as one file (over 25 MB, mostly pictures). Use smaller pictures and try again.')
      } else toast.error(error instanceof Error ? error.message : 'The copy could not be downloaded.')
    }
  }

  return (
    <TemplateSampleContext value={templateSample}>
    <MotionUiContext value={motionUi}>
    <DndContext sensors={readOnly ? NO_SENSORS : sensors} collisionDetection={collision} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={(e) => onDragMove(e as unknown as DragMoveEvent)} onDragEnd={onDragEnd} onDragCancel={resetDrag} autoScroll={{ layoutShiftCompensation: false }}>
      <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" data-testid="store-builder-editor">
        <Toolbar
          canPublish={canPublish}
          canSubmit={canSubmit}
          onSubmitReview={() => {
            setSubmitError(null)
            setSubmitOpen(true)
            void runServerCheck(store.getState().content)
          }}
          status={
            <>
              <ScheduleChip
                schedule={documentInfo.schedule}
                timeZone={timeZone}
                canChange={canPublish}
                onCancel={cancelPlanned}
                onReschedule={() => {
                  setPublishError(null)
                  setPublishOpen(true)
                }}
              />
              <ReviewChip
                review={documentInfo.review}
                canPublish={canPublish}
                onOpenReview={() => setReviewId(documentInfo.review?.id ?? null)}
                onResubmit={() => {
                  setSubmitError(null)
                  setSubmitOpen(true)
                }}
                onWithdraw={withdraw}
              />
            </>
          }
          onRename={rename}
          onPreview={() => void openPreview()}
          onPublish={() => {
            setPublishError(null)
            setPublishOpen(true)
            // B10: the server checks the content about to be published (errors never block it).
            void runServerCheck(store.getState().content)
          }}
          onDiscard={() => setDiscardOpen(true)}
          onHistory={() => setHistoryOpen(true)}
          onShowProblem={showProblem}
          bangla={bangla}
          check={{ errors: check.counts.errors, warnings: check.counts.warnings, open: checkOpen, onToggle: () => (checkOpen ? setCheckOpen(false) : openCheck()) }}
          onCommandBox={() => setCommandOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
          insights={
            insights.available
              ? {
                  open: insights.open && !checkOpen,
                  onToggle: () => {
                    const next = !(insights.open && !checkOpen)
                    if (next) setCheckOpen(false)
                    if (next) ab?.setOpen(false)
                    if (next) comments.setOpen(false)
                    insights.setOpen(next)
                  },
                }
              : undefined
          }
          abTests={abAvailable ? { open: abShown, count: abCount, onToggle: () => ab.setOpen(!abShown) } : undefined}
          sample={showSample}
          readOnly={readOnly}
          people={people}
          comments={{ open: commentsShown, count: comments.openCount, onToggle: toggleComments }}
          onDownload={canManage && documentInfo.kind !== 'theme' ? () => void downloadCopy() : undefined}
          onMotionThemes={openMotionThemes}
          onPlayPage={playPage}
        />
        <PresenceBanner ui={presenceUi} />
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Add elements, page layers and templates" className={cn('flex shrink-0 flex-col border-r bg-background', insightsShown || abShown || commentsShown ? 'w-96' : 'w-72')}>
            {checkOpen && (
              <CheckPanel
                check={check}
                labelOf={(id) => {
                  const info = findNode(expanded.content, id)
                  return info ? nodeName(info.node, registry, globals) : null
                }}
                onShow={showIssue}
                onFix={runFix}
                onClose={() => setCheckOpen(false)}
              />
            )}
            {insightsShown && (
              <InsightsPanel
                insights={insights}
                noun={info.noun}
                published={documentInfo.published !== null}
                timeZone={timeZone}
                device={device}
                onDevice={(next) => store.getState().setDevice(next)}
                nameOf={(id) => {
                  const found = findNode(content, id)
                  return found ? nodeName(found.node, registry, globals) : null
                }}
                onShowSection={(id) => {
                  store.getState().select(id)
                  commands.reveal(id)
                }}
                onClose={() => insights.setOpen(false)}
              />
            )}
            {abShown && <ExperimentsPanel canPublish={canPublish} canView={canViewInsights} timeZone={timeZone} onClose={() => ab.setOpen(false)} />}
            {commentsShown && (
              <CommentsPanel
                ui={comments}
                documentId={documentInfo.id}
                labelOf={commentLabel}
                onShowNode={showNode}
                selection={selectionForComment}
                timeZone={timeZone}
                flush={() => autosave.flush()}
                onClose={() => comments.setOpen(false)}
              />
            )}
            <Tabs hidden={checkOpen || insightsShown || abShown || commentsShown} value={tab} onValueChange={(value) => setTab(value as 'add' | 'layers' | 'templates')} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className={cn('m-2 grid w-auto', showGlobalTab && showTemplatesTab ? 'grid-cols-4' : showGlobalTab || showTemplatesTab ? 'grid-cols-3' : 'grid-cols-2')}>
                <TabsTrigger value="add">Add</TabsTrigger>
                <TabsTrigger value="layers">Layers</TabsTrigger>
                {showTemplatesTab && <TabsTrigger value="templates">Templates</TabsTrigger>}
                {showGlobalTab && <TabsTrigger value="global">Global</TabsTrigger>}
              </TabsList>
              <TabsContent value="add" className="flex min-h-0 flex-1 flex-col">
                {/* B16: nothing can be added while someone else edits. */}
                <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                  <AddPanel registry={registry} context={context} template={template} canCustomHtml={canCustomHtml} />
                </fieldset>
              </TabsContent>
              <TabsContent value="layers" className="flex min-h-0 flex-1 flex-col">
                <LayersPanel indicator={layerDrop?.indicator ?? null} />
              </TabsContent>
              {showGlobalTab && (
                <TabsContent value="global" className="flex min-h-0 flex-1 flex-col">
                  <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                    <GlobalSectionsPanel context={context} enabled={tab === 'global'} />
                  </fieldset>
                </TabsContent>
              )}
              <TabsContent value="templates" className="flex min-h-0 flex-1 flex-col">
                <fieldset disabled={readOnly} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                  <TemplatesPanel context={context} currentPreset={themeSettings?.preset ?? null} inserter={templates} enabled={tab === 'templates'} />
                </fieldset>
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
              locale={canvasLocale}
              sections={canvasArms.sections}
              data={preview.data}
              media={preview.media}
              pending={preview.pending}
              selection={selection}
              selectedIds={selectedIds}
              deviceOrder={canvasDeviceOrder}
              hover={hover}
              errorIds={errorIds}
              device={device}
              dragging={dragged !== null && pointerDrag}
              indicator={canvasDrop?.indicator ?? null}
              onSelect={(id, gesture) => {
                const owner = ownerOf(id)
                const state = store.getState()
                // B12: Ctrl/Cmd+click adds or takes out, Shift+click adds the items between.
                if (owner && gesture?.toggle) state.toggleSelect(owner)
                else if (owner && gesture?.range) state.selectRange(owner)
                else if (owner || !(gesture?.toggle || gesture?.range)) select(owner)
              }}
              onHover={(id) => setHover(ownerOf(id))}
              onKey={handleKey}
              toolbar={() => (readOnly ? null : <MiniToolbar theme={inspectorTheme} onEditText={editText} onReplacePicture={setReplaceId} />)}
              hoverLabel={labelOf}
              handleRef={canvas}
              theme={themeSettings as CanvasThemeSettings | null}
              resizeRow={readOnly ? null : resizeRow}
              onResize={onResize}
              fonts={fonts}
              onEdit={onCanvasEdit}
              spacing={readOnly ? null : spacing}
              uploads={uploads}
              heat={checkOpen ? null : insights.heat}
              previewAs={previewContext}
              previewMotion={previewMotion}
              audienceBadges={audience.badges}
              arms={canvasArms.layer}
              pageContext={livesText ? templateSample.context : undefined}
              pageSample={templateSample.sample}
              pins={pinLayer}
              onCommentAt={comments.mode && commentsShown ? dropComment : null}
            />
            <MotionTimelinePanel nodeId={timelineId} onClose={closeTimeline} />
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
                nodes={inspectorNodes && inspectorNodes.length > 1 ? inspectorNodes : undefined}
                onChangeMany={(next, options) => store.getState().apply((c) => next.reduce((acc, node) => setNode(acc, node), c), { coalesceKey: options?.coalesceKey, media: options?.media })}
                device={device}
                theme={inspectorTheme}
                canCustomHtml={canCustomHtml}
                focus={focus}
                readOnly={readOnly}
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
                    case 'open-motion-timeline':
                      return openTimeline(command.sectionId)
                    case 'preview-motion':
                      canvas.current?.scrollTo(command.nodeId)
                      return canvas.current?.playMotion(command.nodeId, command.scope)
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
                    case 'change-address':
                      return setAddressOpen(true)
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
      <CommandBox open={commandOpen} onOpenChange={setCommandOpen} items={commandItems} />
      <MotionThemesDialog open={motionThemesOpen} onOpenChange={setMotionThemesOpen} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        pending={publishPending}
        error={publishError}
        onPublish={(note, options) => void publish(note, options)}
        popup={isPopup}
        usedOn={documentInfo.kind === 'global' ? (documentInfo.usage?.usage_count ?? 0) : null}
        check={check}
        onShowCheck={() => {
          setPublishOpen(false)
          setCheckOpen(true)
        }}
        later={canPublish ? { timeZone, current: documentInfo.schedule, onSchedule: (at, note) => void scheduleLater(at, note) } : undefined}
      />
      <SubmitReviewDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        pending={submitPending}
        error={submitError}
        onSubmit={(note) => void submitReview(note)}
        noun={info.noun}
        current={documentInfo.review}
        check={check}
      />
      <ReviewScreen reviewId={reviewId} onClose={() => setReviewId(null)} onDecided={() => void reviewDecided()} />
      <LinkPrompt
        request={linkRequest}
        onAnswer={(url) => {
          setLinkRequest(null)
          onCanvas(canvas, (c) => c.linkResult(url))
        }}
      />
      <MediaPicker
        open={replaceId !== null}
        onOpenChange={(open) => !open && setReplaceId(null)}
        title={findNode(content, replaceId)?.node.type === 'image' ? 'Replace picture' : 'Replace background picture'}
        selected={[]}
        onConfirm={(ids) => {
          const id = replaceId
          setReplaceId(null)
          if (id && ids[0] && applyPicture(id, ids[0])) toast.success('Picture replaced. Undo puts the old one back.')
        }}
      />
      <AddressDialog
        open={addressOpen}
        onOpenChange={setAddressOpen}
        documentId={documentInfo.id}
        slug={documentInfo.key.startsWith('landing:') ? documentInfo.key.slice('landing:'.length) : ''}
        storeUrl={canvasContext.store_url}
        onChanged={(result) => {
          const previous = store.getState().document
          const oldSlug = previous.key.slice('landing:'.length)
          const newSlug = result.key.slice('landing:'.length)
          store.getState().setDocument({ key: result.key, path: result.path, preview_url: result.preview_url ?? previous.preview_url?.replace(`/p/${oldSlug}`, `/p/${newSlug}`) ?? null })
          refreshList()
          toast.success(`The page is now at ${result.path ?? `/p/${newSlug}`}. Old links forward to it.`)
        }}
      />
      <ConflictDialog open={saveStatus === 'conflict'} pending={conflictPending} onChoose={chooseConflict} />
      <VersionHistoryDialog
        documentId={documentInfo.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        liveVersionId={documentInfo.published?.version_id ?? null}
        liveUrl={canvasContext.store_url && livePath(documentInfo) ? `${canvasContext.store_url}${livePath(documentInfo)}` : null}
        canRestore={!readOnly}
        canManage={!readOnly}
        activity
        onRestore={restore}
        flush={() => autosave.flush()}
        compare={compareSupport}
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
    </MotionUiContext>
    </TemplateSampleContext>
  )
}
