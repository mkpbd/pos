import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpLeftIcon,
  CircleAlertIcon,
  Columns2Icon,
  FileTextIcon,
  HeadingIcon,
  ImageIcon,
  LayoutTemplateIcon,
  MegaphoneIcon,
  MinusIcon,
  MoveVerticalIcon,
  PaletteIcon,
  PanelTopIcon,
  PilcrowIcon,
  RectangleHorizontalIcon,
  ShoppingBagIcon,
  SquareIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { elementMeta, isWrappedSectionType } from '@/storefront/builder/registry'
import type { StoreTemplateKey } from '@/storefront/builder/templates/types'
import type { ButtonElement, DividerElement, Element, HeadingElement, ImageElement, InnerRowElement, Section, SpacerElement, TextElement, WrappedElement } from '@/storefront/builder/types'
import { documentTemplate, elementContext, kindInfo } from '../document-kind'
import { AdvancedTab } from './advanced-tab'
import { focusFieldSoon } from './check-focus'
import { AiWriterBar } from './ai-writer'
import { B4Form, type B4FormProps } from './b4-forms'
import { B6Form } from './b6-forms'
import { B8aForm } from './b8a-forms'
import { B8bForm } from './b8b-forms'
import { B17Form } from './b17-forms'
import { B17_TYPES } from './b17-model'
import { B14Form } from './b14-forms'
import { B14_TYPES } from './b14-model'
import { P2aForm } from './order-form'
import { ButtonForm, ColumnInfo, DividerForm, HeadingForm, ImageForm, InnerRowForm, SectionForm, SpacerForm, TextForm } from './content-forms'
import { errorMap, isInlineProblem } from './errors'
import { PopupSettingsPanel } from './popup-settings'
import { readPopupSettings } from '../popup-model'
import { ElementSetupHost } from './setup-dialog'
import { SeoPanel } from './seo-panel'
import { hasSeo } from './seo-panel-model'
import { StyleTab } from './style-tab'
import { MultiInspector } from './common-style-form'
import { findParent, otherAnchors } from './tree-lookup'
import type { BuilderNode, InspectorChangeOptions, InspectorProps } from './types'
import { B4_TYPES, B6_TYPES, B8A_TYPES, B8B_TYPES, P2A_TYPES, validateNode } from './validate'
import { WrappedSectionForm } from './wrapped-form'

const ICONS: Record<string, typeof HeadingIcon> = {
  section: PanelTopIcon,
  column: SquareIcon,
  heading: HeadingIcon,
  text: PilcrowIcon,
  image: ImageIcon,
  button: RectangleHorizontalIcon,
  spacer: MoveVerticalIcon,
  divider: MinusIcon,
  inner_row: Columns2Icon,
}
const GROUP_ICONS: Record<string, typeof HeadingIcon> = { commerce: ShoppingBagIcon, marketing: MegaphoneIcon, content: FileTextIcon }

/** Advanced tab error keys; everything else belongs to the Content tab. */
const ADVANCED_KEYS = new Set(['starts_at', 'ends_at', 'anchor', 'visibility', 'hidden'])
/** B13: the audience's problems (`audience.rules.1.in`) belong to the Advanced tab too. */
const isAdvancedKey = (key: string) => ADVANCED_KEYS.has(key) || key === 'audience' || key.startsWith('audience.')

function nodeLabel(node: BuilderNode, registry: InspectorProps['registry']): string {
  if (node.type === 'section') return 'Section'
  if (node.type === 'column') return 'Column'
  return registry.types?.find((t) => t.type === node.type)?.label ?? elementMeta(node.type)?.label ?? node.type
}

function NodeIcon({ type }: { type: string }) {
  const Icon = ICONS[type] ?? GROUP_ICONS[elementMeta(type)?.group ?? ''] ?? LayoutTemplateIcon
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function ContentForm({ node, onChange, onCommand, errors, bangla, content, b4, documentId }: {
  node: BuilderNode
  documentId: string
  onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void
  onCommand: InspectorProps['onCommand']
  errors: Record<string, string>
  bangla: boolean
  content: InspectorProps['content']
  b4: Pick<B4FormProps<Element>, 'context' | 'theme' | 'icons' | 'canCustomHtml'> & { enums?: Record<string, unknown>; template: StoreTemplateKey | null }
}) {
  const common = { onChange, errors, bangla } as const
  if (B4_TYPES.has(node.type)) return <B4Form key={node.id} node={node as Element} {...common} {...b4} />
  if (B6_TYPES.has(node.type)) return <B6Form key={node.id} node={node as Element} {...common} context={b4.context} icons={b4.icons} />
  if (B8A_TYPES.has(node.type)) return <B8aForm key={node.id} node={node as Element} {...common} context={b4.context} icons={b4.icons} />
  if (B8B_TYPES.has(node.type)) return <B8bForm key={node.id} node={node as Element} {...common} context={b4.context} />
  if (P2A_TYPES.has(node.type)) return <P2aForm key={node.id} node={node as Element} {...common} context={b4.context} />
  if (B14_TYPES.has(node.type)) return <B14Form key={node.id} node={node as Element} {...common} context={b4.context} template={b4.template} />
  if (B17_TYPES.has(node.type)) return <B17Form key={node.id} node={node as Element} {...common} context={b4.context} enums={b4.enums} />
  switch (node.type) {
    case 'section':
      return (
        <SectionForm
          node={node}
          {...common}
          onCommand={onCommand}
          theme={b4.theme}
          context={b4.context}
          otherSticky={content.sections.some((s) => s.id !== node.id && s.props.sticky === true)}
        />
      )
    case 'column':
      return <ColumnInfo node={node} parent={findParent(content, node.id)} onCommand={onCommand} />
    case 'heading':
      return <HeadingForm node={node as HeadingElement} {...common} />
    case 'text':
      return <TextForm node={node as TextElement} {...common} />
    case 'image':
      return <ImageForm node={node as ImageElement} {...common} />
    case 'button':
      return <ButtonForm node={node as ButtonElement} {...common} context={b4.context} />
    case 'divider':
      return <DividerForm node={node as DividerElement} {...common} />
    case 'spacer':
      return <SpacerForm node={node as SpacerElement} {...common} />
    case 'inner_row':
      return <InnerRowForm node={node as InnerRowElement} {...common} onCommand={onCommand} />
  }
  if (isWrappedSectionType(node.type)) {
    return (
      // The homepage forms lay fields out for a wide dialog; the panel is narrow, so one column.
      <div className="[&_.grid]:grid-cols-1 [&_button[role=combobox]]:w-full">
        <WrappedSectionForm key={node.id} node={node as WrappedElement} {...common} documentId={documentId} onCommand={onCommand} />
      </div>
    )
  }
  return <p className="text-sm text-muted-foreground">This element has no settings.</p>
}

function PageSettings({ document, content, locales, onCommand, errors }: Pick<InspectorProps, 'document' | 'content' | 'locales' | 'onCommand' | 'errors'>) {
  const published = document.published
  const sections = content.sections.length
  const kind = document.kind ?? 'page'
  const info = kindInfo({ kind, key: document.key ?? '', target: document.target })
  const template = documentTemplate({ kind, key: document.key })
  const heading = kind === 'header' ? 'Header' : kind === 'footer' ? 'Footer' : kind === 'zone' ? 'Area' : template ? 'Store page' : 'Page'
  const cms = (document.key ?? '').startsWith('cms:')
  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className="text-sm text-muted-foreground">Select a section or element on the {info.noun} or in Layers to edit it. Add new ones from the Add panel.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Title</dt>
        <dd className="min-w-0 break-words">{document.title}</dd>
        {document.path ? (
          <>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="flex min-w-0 flex-col items-start gap-1">
              <span className="font-mono break-all">{document.path}</span>
              {/* B16: a campaign page's address can change; old links forward to the new one. */}
              {(document.key ?? '').startsWith('landing:') && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onCommand({ type: 'change-address' })}>
                  Change address…
                </Button>
              )}
            </dd>
          </>
        ) : (
          info.placement && (
            <>
              <dt className="text-muted-foreground">Shown</dt>
              <dd className="min-w-0">{info.placement}</dd>
            </>
          )
        )}
        <dt className="text-muted-foreground">Last published</dt>
        <dd>
          {published
            ? `Version ${published.number} · ${new Date(published.published_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
            : 'Not published yet'}
        </dd>
        <dt className="text-muted-foreground">Sections</dt>
        <dd>{sections === 0 ? 'None yet' : sections}</dd>
        {locales.includes('bn') && (
          <>
            <dt className="text-muted-foreground">Languages</dt>
            <dd>
              English and <span lang="bn">বাংলা</span>: elements with text have a Bangla section.
            </dd>
          </>
        )}
      </dl>
      <p className="text-sm text-muted-foreground">Changes are saved as a draft automatically. Visitors see them only after you publish.</p>
      {cms && (
        <p className="text-sm text-muted-foreground">
          The page’s title, address and whether it is published are set on the{' '}
          <Link to="/content/pages" className="underline underline-offset-2">Content pages</Link> screen; search texts set there are used when Search & sharing below is empty. Deleting this design brings the classic page back.
        </p>
      )}
      {template && (
        <p className="text-sm text-muted-foreground" data-testid="store-page-seo-note">
          Search titles, descriptions and sharing pictures of this page come from {template === 'blog_post' ? 'each post' : template === 'category' ? 'each category' : template === 'brand' ? 'each brand' : 'your store settings'}, as before.
          {template === 'order' || template === 'search' ? ' Search engines don’t list this page.' : ''} Choose “Use the standard page” on the Page builder screen to go back to the standard page.
        </p>
      )}
      {(kind === 'header' || kind === 'footer') && (
        <p className="text-sm text-muted-foreground">
          The logo, menus, contact details, social links and payment logos come from the{' '}
          <Link to="/storefront/theme" className="underline underline-offset-2">Theme page</Link> and{' '}
          <Link to="/storefront/menus" className="underline underline-offset-2">Menus</Link>.
        </p>
      )}
      {hasSeo({ kind, key: document.key }) && <SeoPanel content={content} document={document} bangla={locales.includes('bn')} problems={errors} onCommand={onCommand} />}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Site styles</h3>
        <p className="text-sm text-muted-foreground">
          {kind === 'zone' && (document.key ?? '').startsWith('zone:product.')
            ? 'Colours, fonts and buttons for the whole store, and the product page layout: photos left or right, small photos, a buy box that stays in view, tabs or sections for the details.'
            : 'Colours, fonts, text sizes, buttons and the product page layout for the whole store.'}{' '}
          Changes show here at once and go live when you publish them.
        </p>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onCommand({ type: 'open-site-styles' })}>
          <PaletteIcon data-icon="inline-start" /> Site styles
        </Button>
      </div>
    </div>
  )
}

type Tab = 'content' | 'style' | 'advanced'

/**
 * The right panel of the store builder: page settings, or the selected node's Content and
 * Advanced tabs. Also hosts createElement()'s setup dialog.
 */
export function Inspector(props: InspectorProps) {
  return (
    <>
      <ElementSetupHost canCustomHtml={props.canCustomHtml} documentId={props.document.id} />
      <InspectorPanel {...props} />
    </>
  )
}

/**
 * B16: while someone else edits, every field and button inside is disabled (a disabled fieldset)
 * but still readable; the tabs above stay usable so everything can be looked at.
 */
function ReadOnlyFields({ readOnly, children }: { readOnly?: boolean; children: ReactNode }) {
  if (!readOnly) return <>{children}</>
  return (
    <fieldset disabled className="m-0 min-w-0 border-0 p-0" data-testid="inspector-read-only">
      <legend className="sr-only">Read only: someone else is editing this page</legend>
      {children}
    </fieldset>
  )
}

/** The icon names the server accepts (GET /elements `enums.icons`), else the storefront's. */
function registryIcons(registry: InspectorProps['registry']): readonly string[] | undefined {
  const icons = registry.enums?.icons
  return Array.isArray(icons) && icons.every((name) => typeof name === 'string') ? (icons as string[]) : undefined
}

function InspectorPanel(props: InspectorProps) {
  const { nodes, onChangeMany, content, node, registry, device = 'desktop', theme, onCommand, readOnly } = props
  if (nodes && nodes.length > 1 && onChangeMany) {
    return (
      <ReadOnlyFields readOnly={readOnly}>
      <MultiInspector
        key={nodes.map((n) => n.id).join(',')}
        content={content}
        nodes={nodes}
        primaryId={node?.id ?? null}
        device={device}
        theme={theme}
        labelOf={(n) => nodeLabel(n, registry)}
        onChangeMany={onChangeMany}
        onCommand={onCommand}
      />
      </ReadOnlyFields>
    )
  }
  return <SingleInspector {...props} />
}

function SingleInspector({ content, node, document, registry, locales, errors: serverProblems, onChange, onCommand, device = 'desktop', theme, canCustomHtml = false, focus, readOnly }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('content')
  const panel = useRef<HTMLElement | null>(null)
  const nodeId = node?.id ?? null

  // B10: page check "Fix it": the tab (switched while rendering, once per request), then the field once it has rendered.
  const focusToken = focus?.token ?? null
  const focusNode = focus?.nodeId ?? null
  const focusTarget = focus?.field ?? null
  const [seenToken, setSeenToken] = useState<number | null>(null)
  if (focusToken !== null && focusToken !== seenToken && focusNode === nodeId) {
    setSeenToken(focusToken)
    if (nodeId && focus) setTab(focus.tab)
  }
  const handled = useRef<number | null>(null)
  useEffect(() => {
    if (focusToken === null || handled.current === focusToken || focusNode !== nodeId) return
    return focusFieldSoon(() => panel.current, focusTarget, () => {
      handled.current = focusToken
    })
  }, [focusToken, focusNode, focusTarget, nodeId])

  if (!node) {
    return (
      <aside ref={panel} aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto">
        <ReadOnlyFields readOnly={readOnly}>
          {document.kind === 'popup' ? (
            <PopupSettingsPanel settings={readPopupSettings(content.popup)} document={document} problems={serverProblems} bangla={locales.includes('bn')} onCommand={onCommand} />
          ) : (
            <PageSettings document={document} content={content} locales={locales} onCommand={onCommand} errors={serverProblems} />
          )}
        </ReadOnlyFields>
      </aside>
    )
  }

  const bangla = locales.includes('bn')
  const icons = registryIcons(registry)
  const context = elementContext({ kind: document.kind ?? 'page', key: document.key ?? '' })
  const template = documentTemplate({ kind: document.kind ?? 'page', key: document.key })
  const problems = validateNode(node, { icons, context, template })
  const errors = errorMap(node, problems, serverProblems)
  const hasAdvanced = node.type !== 'column'
  const activeTab: Tab = hasAdvanced || tab !== 'advanced' ? tab : 'content'
  const advancedErrors = Object.keys(errors).some(isAdvancedKey)
  const contentErrors = Object.keys(errors).some((k) => !isAdvancedKey(k))
  const label = nodeLabel(node, registry)
  // Columns show their own "Select the section" button in the Content tab.
  const parent = node.type === 'section' || node.type === 'column' ? null : findParent(content, node.id)
  const otherProblems = serverProblems.filter((p) => !isInlineProblem(node, p, bangla))

  return (
    <aside ref={panel} aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <NodeIcon type={node.type} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{label}</h2>
        {parent && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Select the ${parent.type === 'section' ? 'section' : parent.type === 'column' ? 'column' : 'inner row'}`}
            title={`Select the ${parent.type === 'section' ? 'section' : parent.type === 'column' ? 'column' : 'inner row'} around it`}
            onClick={() => onCommand({ type: 'select', nodeId: parent.id })}
          >
            <ArrowUpLeftIcon />
          </Button>
        )}
      </header>

      {serverProblems.length > 0 && (
        <div role="alert" className="mx-4 mt-3 flex gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">
              The page can’t be saved until {serverProblems.length === 1 ? 'this problem is' : `these ${serverProblems.length} problems are`} fixed
              {otherProblems.length < serverProblems.length ? ' (see the highlighted fields)' : ''}.
            </p>
            {otherProblems.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {otherProblems.map((p, i) => <li key={`${p.path}-${i}`}>{p.message}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as Tab)} className="gap-0 px-4 pt-3 pb-6">
        <TabsList className="w-full">
          <TabsTrigger value="content">
            Content{contentErrors && <span className="size-1.5 rounded-full bg-destructive" aria-label="has problems" />}
          </TabsTrigger>
          <TabsTrigger value="style">Style</TabsTrigger>
          {hasAdvanced && (
            <TabsTrigger value="advanced">
              Advanced{advancedErrors && <span className="size-1.5 rounded-full bg-destructive" aria-label="has problems" />}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="content" className="pt-4">
          <ReadOnlyFields readOnly={readOnly}>
          <AiWriterBar key={node.id} node={node} documentId={document.id} bangla={bangla} onChange={onChange} labelOf={(type) => nodeLabel({ type } as BuilderNode, registry)} />
          <ContentForm
            node={node}
            onChange={onChange}
            onCommand={onCommand}
            errors={errors}
            bangla={bangla}
            content={content}
            documentId={document.id}
            b4={{ context, theme, icons, canCustomHtml, enums: registry.enums, template }}
          />
          </ReadOnlyFields>
        </TabsContent>
        <TabsContent value="style" className="pt-4">
          <ReadOnlyFields readOnly={readOnly}>
            <StyleTab node={node} device={device} onChange={onChange} onCommand={onCommand} theme={theme} />
          </ReadOnlyFields>
        </TabsContent>
        {hasAdvanced && (
          <TabsContent value="advanced" className="pt-4">
            <ReadOnlyFields readOnly={readOnly}>
            <AdvancedTab
              key={node.id}
              node={node as Section | Element}
              onChange={onChange as (next: Section | Element, opts?: InspectorChangeOptions) => void}
              errors={errors}
              takenAnchors={node.type === 'section' ? otherAnchors(content, node.id) : undefined}
            />
            </ReadOnlyFields>
          </TabsContent>
        )}
      </Tabs>
    </aside>
  )
}
