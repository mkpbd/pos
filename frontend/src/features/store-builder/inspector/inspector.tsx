import { useState } from 'react'
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
import type { ButtonElement, DividerElement, Element, HeadingElement, ImageElement, InnerRowElement, Section, SpacerElement, TextElement, WrappedElement } from '@/storefront/builder/types'
import { elementContext, kindInfo } from '../document-kind'
import { AdvancedTab } from './advanced-tab'
import { B4Form, type B4FormProps } from './b4-forms'
import { ButtonForm, ColumnInfo, DividerForm, HeadingForm, ImageForm, InnerRowForm, SectionForm, SpacerForm, TextForm } from './content-forms'
import { errorMap, isInlineProblem } from './errors'
import { ElementSetupHost } from './setup-dialog'
import { StyleTab } from './style-tab'
import { findParent, otherAnchors } from './tree-lookup'
import type { BuilderNode, InspectorChangeOptions, InspectorProps } from './types'
import { B4_TYPES, validateNode } from './validate'
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

function nodeLabel(node: BuilderNode, registry: InspectorProps['registry']): string {
  if (node.type === 'section') return 'Section'
  if (node.type === 'column') return 'Column'
  return registry.types?.find((t) => t.type === node.type)?.label ?? elementMeta(node.type)?.label ?? node.type
}

function NodeIcon({ type }: { type: string }) {
  const Icon = ICONS[type] ?? GROUP_ICONS[elementMeta(type)?.group ?? ''] ?? LayoutTemplateIcon
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function ContentForm({ node, onChange, onCommand, errors, bangla, content, b4 }: {
  node: BuilderNode
  onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void
  onCommand: InspectorProps['onCommand']
  errors: Record<string, string>
  bangla: boolean
  content: InspectorProps['content']
  b4: Pick<B4FormProps<Element>, 'context' | 'theme' | 'icons' | 'canCustomHtml'>
}) {
  const common = { onChange, errors, bangla } as const
  if (B4_TYPES.has(node.type)) return <B4Form key={node.id} node={node as Element} {...common} {...b4} />
  switch (node.type) {
    case 'section':
      return <SectionForm node={node} {...common} onCommand={onCommand} />
    case 'column':
      return <ColumnInfo node={node} parent={findParent(content, node.id)} onCommand={onCommand} />
    case 'heading':
      return <HeadingForm node={node as HeadingElement} {...common} />
    case 'text':
      return <TextForm node={node as TextElement} {...common} />
    case 'image':
      return <ImageForm node={node as ImageElement} {...common} />
    case 'button':
      return <ButtonForm node={node as ButtonElement} {...common} />
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
        <WrappedSectionForm key={node.id} node={node as WrappedElement} {...common} />
      </div>
    )
  }
  return <p className="text-sm text-muted-foreground">This element has no settings.</p>
}

function PageSettings({ document, content, locales, onCommand }: Pick<InspectorProps, 'document' | 'content' | 'locales' | 'onCommand'>) {
  const published = document.published
  const sections = content.sections.length
  const kind = document.kind ?? 'page'
  const info = kindInfo({ kind, key: document.key ?? '' })
  const heading = kind === 'header' ? 'Header' : kind === 'footer' ? 'Footer' : kind === 'zone' ? 'Area' : 'Page'
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
            <dd className="min-w-0 font-mono break-all">{document.path}</dd>
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
          The page’s title, address, search texts and whether it is published are set on the{' '}
          <Link to="/content/pages" className="underline underline-offset-2">Content pages</Link> screen. Deleting this design brings the classic page back.
        </p>
      )}
      {(kind === 'header' || kind === 'footer') && (
        <p className="text-sm text-muted-foreground">
          The logo, menus, contact details, social links and payment logos come from the{' '}
          <Link to="/storefront/theme" className="underline underline-offset-2">Theme page</Link> and{' '}
          <Link to="/storefront/menus" className="underline underline-offset-2">Menus</Link>.
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Site styles</h3>
        <p className="text-sm text-muted-foreground">Colours, fonts, text sizes and buttons for the whole store. Changes show here at once and go live when you publish them.</p>
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
      <ElementSetupHost canCustomHtml={props.canCustomHtml} />
      <InspectorPanel {...props} />
    </>
  )
}

/** The icon names the server accepts (GET /elements `enums.icons`), else the storefront's. */
function registryIcons(registry: InspectorProps['registry']): readonly string[] | undefined {
  const icons = registry.enums?.icons
  return Array.isArray(icons) && icons.every((name) => typeof name === 'string') ? (icons as string[]) : undefined
}

function InspectorPanel({ content, node, document, registry, locales, errors: serverProblems, onChange, onCommand, device = 'desktop', theme, canCustomHtml = false }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('content')

  if (!node) {
    return (
      <aside aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto">
        <PageSettings document={document} content={content} locales={locales} onCommand={onCommand} />
      </aside>
    )
  }

  const bangla = locales.includes('bn')
  const icons = registryIcons(registry)
  const problems = validateNode(node, { icons })
  const errors = errorMap(node, problems, serverProblems)
  const hasAdvanced = node.type !== 'column'
  const activeTab: Tab = hasAdvanced || tab !== 'advanced' ? tab : 'content'
  const advancedErrors = Object.keys(errors).some((k) => ADVANCED_KEYS.has(k))
  const contentErrors = Object.keys(errors).some((k) => !ADVANCED_KEYS.has(k))
  const label = nodeLabel(node, registry)
  // Columns show their own "Select the section" button in the Content tab.
  const parent = node.type === 'section' || node.type === 'column' ? null : findParent(content, node.id)
  const otherProblems = serverProblems.filter((p) => !isInlineProblem(node, p, bangla))

  return (
    <aside aria-label="Inspector" className="flex min-h-0 flex-col overflow-y-auto">
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
          <ContentForm
            node={node}
            onChange={onChange}
            onCommand={onCommand}
            errors={errors}
            bangla={bangla}
            content={content}
            b4={{ context: elementContext({ kind: document.kind ?? 'page', key: document.key ?? '' }), theme, icons, canCustomHtml }}
          />
        </TabsContent>
        <TabsContent value="style" className="pt-4">
          <StyleTab node={node} device={device} onChange={onChange} onCommand={onCommand} theme={theme} />
        </TabsContent>
        {hasAdvanced && (
          <TabsContent value="advanced" className="pt-4">
            <AdvancedTab
              key={node.id}
              node={node as Section | Element}
              onChange={onChange as (next: Section | Element, opts?: InspectorChangeOptions) => void}
              errors={errors}
              takenAnchors={node.type === 'section' ? otherAnchors(content, node.id) : undefined}
            />
          </TabsContent>
        )}
      </Tabs>
    </aside>
  )
}
