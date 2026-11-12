import { cn } from '@/lib/utils'
import type { PopupLayout } from '@/storefront/builder/types'

/*
 * B8b: a small sketch of a page with the popup on it, for the template and layout choices
 * (the list icons are POPUP_LAYOUT_ICONS in ./popup-model). Decorative: the words next to it say
 * the same.
 */

const line = 'h-1 rounded-full bg-foreground/10'

/** A small page with the popup drawn where the layout puts it. */
export function PopupSketch({ layout, position = 'bottom_right', className }: { layout: PopupLayout; position?: 'bottom_left' | 'bottom_right'; className?: string }) {
  const dimmed = layout === 'modal' || layout === 'fullscreen'
  return (
    <div aria-hidden className={cn('relative aspect-[4/3] overflow-hidden rounded-md border bg-background', className)} data-testid={`popup-sketch-${layout}`}>
      <div className="flex flex-col gap-1.5 p-2.5 pt-4">
        <span className={cn(line, 'w-2/3')} />
        <span className={cn(line, 'w-full')} />
        <span className={cn(line, 'w-5/6')} />
        <span className={cn(line, 'w-3/4')} />
        <span className={cn(line, 'w-1/2')} />
      </div>
      {dimmed && <span className="absolute inset-0 bg-foreground/25" />}
      {layout === 'modal' && <span className="absolute inset-x-[22%] inset-y-[24%] rounded bg-primary/80 shadow" />}
      {layout === 'fullscreen' && <span className="absolute inset-[6%] rounded bg-primary/80" />}
      {layout === 'slide_in' && <span className={cn('absolute bottom-[8%] h-[34%] w-[38%] rounded bg-primary/80 shadow', position === 'bottom_left' ? 'left-[6%]' : 'right-[6%]')} />}
      {layout === 'bar_top' && <span className="absolute inset-x-0 top-0 h-[16%] bg-primary/80" />}
      {layout === 'bar_bottom' && <span className="absolute inset-x-0 bottom-0 h-[16%] bg-primary/80" />}
    </div>
  )
}
