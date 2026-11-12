import { useState } from 'react'
import {
  BadgeIcon,
  CircleHelpIcon,
  FileTextIcon,
  GalleryHorizontalIcon,
  LayoutGridIcon,
  LayoutListIcon,
  LayoutTemplateIcon,
  MailPlusIcon,
  MessageSquareQuoteIcon,
  MousePointerClickIcon,
  PlayCircleIcon,
  SparklesIcon,
  TimerIcon,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BuilderTemplate } from './api'

/*
 * A template's picture: its screenshot when there is one (and it loads), else a generated
 * wireframe of the kind of section (hero, product row, text, band, whole page) with an icon and
 * the template's name — neutral colours, so it reads as a sketch, not as a broken image.
 */

type Shape = 'hero' | 'grid' | 'text' | 'media' | 'band' | 'page'

const KINDS: { match: RegExp; icon: LucideIcon; shape: Shape }[] = [
  { match: /hero|slider|banner/, icon: GalleryHorizontalIcon, shape: 'hero' },
  { match: /countdown|flash|deal|sale/, icon: TimerIcon, shape: 'band' },
  { match: /newsletter|subscribe/, icon: MailPlusIcon, shape: 'band' },
  { match: /cta|call/, icon: MousePointerClickIcon, shape: 'band' },
  { match: /testimonial|review|quote/, icon: MessageSquareQuoteIcon, shape: 'text' },
  { match: /faq|question/, icon: CircleHelpIcon, shape: 'text' },
  { match: /video/, icon: PlayCircleIcon, shape: 'media' },
  { match: /about|story/, icon: FileTextIcon, shape: 'media' },
  { match: /brand/, icon: BadgeIcon, shape: 'grid' },
  { match: /categor/, icon: LayoutListIcon, shape: 'grid' },
  { match: /product|grid|carousel|tab|collection/, icon: LayoutGridIcon, shape: 'grid' },
  { match: /feature|benefit|usp/, icon: SparklesIcon, shape: 'grid' },
]

function kindOf(template: Pick<BuilderTemplate, 'scope' | 'category' | 'name'>): { icon: LucideIcon; shape: Shape } {
  if (template.scope !== 'section') return { icon: LayoutTemplateIcon, shape: 'page' }
  const text = `${template.category ?? ''} ${template.name}`.toLowerCase()
  return KINDS.find((kind) => kind.match.test(text)) ?? { icon: LayoutTemplateIcon, shape: 'band' }
}

const bar = 'rounded-sm bg-foreground/10'

function Wireframe({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'hero':
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 rounded bg-foreground/[0.06] p-3">
          <span className={cn(bar, 'h-2.5 w-1/2')} />
          <span className={cn(bar, 'h-1.5 w-2/3')} />
          <span className="mt-1 h-3 w-12 rounded-full bg-foreground/20" />
        </div>
      )
    case 'grid':
      return (
        <div className="flex h-full flex-col gap-1.5">
          <span className={cn(bar, 'mx-auto h-2 w-1/3')} />
          <div className="grid flex-1 grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="flex flex-col gap-1">
                <span className="flex-1 rounded-sm bg-foreground/[0.08]" />
                <span className={cn(bar, 'h-1 w-3/4')} />
              </span>
            ))}
          </div>
        </div>
      )
    case 'media':
      return (
        <div className="grid h-full grid-cols-2 gap-2">
          <span className="rounded-sm bg-foreground/[0.08]" />
          <span className="flex flex-col justify-center gap-1.5">
            <span className={cn(bar, 'h-2 w-3/4')} />
            <span className={cn(bar, 'h-1 w-full')} />
            <span className={cn(bar, 'h-1 w-5/6')} />
          </span>
        </div>
      )
    case 'text':
      return (
        <div className="flex h-full flex-col justify-center gap-1.5">
          <span className={cn(bar, 'mx-auto h-2 w-1/3')} />
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="flex flex-col gap-1 rounded-sm bg-foreground/[0.06] p-1.5">
                <span className={cn(bar, 'h-1 w-full')} />
                <span className={cn(bar, 'h-1 w-2/3')} />
              </span>
            ))}
          </div>
        </div>
      )
    case 'page':
      return (
        <div className="flex h-full flex-col gap-1">
          <span className="h-2/5 rounded-sm bg-foreground/[0.08]" />
          <span className="grid flex-1 grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="rounded-sm bg-foreground/[0.06]" />
            ))}
          </span>
          <span className="h-1/5 rounded-sm bg-foreground/[0.08]" />
        </div>
      )
    default:
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded bg-foreground/[0.06]">
          <span className={cn(bar, 'h-2 w-1/2')} />
          <span className={cn(bar, 'h-1 w-1/3')} />
          <span className="mt-1 h-3 w-12 rounded-full bg-foreground/20" />
        </div>
      )
  }
}

export function TemplateThumbnail({ template, className }: { template: Pick<BuilderTemplate, 'id' | 'scope' | 'category' | 'name' | 'thumbnail_url'>; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const url = template.thumbnail_url
  if (url && failed !== url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(url)}
        className={cn('aspect-video w-full rounded-md border bg-muted object-cover object-top', className)}
      />
    )
  }
  const { icon: Icon, shape } = kindOf(template)
  return (
    <div data-testid="template-placeholder" aria-hidden className={cn('relative aspect-video w-full overflow-hidden rounded-md border bg-muted/60 p-2.5', className)}>
      <div className="h-[62%] opacity-90">
        <Wireframe shape={shape} />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t bg-background/85 px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{template.name}</span>
      </div>
    </div>
  )
}
