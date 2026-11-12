import type { ReactNode } from 'react'
import { InfoIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A control's label row: the label (a `<label>` when `htmlFor` is given), an optional plain-language
 * tooltip and the `status` slot (the Style tab's per-device indicator and reset button).
 */
export function ControlLabel({ label, htmlFor, id, tooltip, status, className }: {
  label: string
  htmlFor?: string
  id?: string
  tooltip?: string
  status?: ReactNode
  className?: string
}) {
  const Tag = htmlFor ? 'label' : 'span'
  return (
    <div className={cn('flex min-h-6 items-center gap-1.5', className)}>
      <Tag id={id} htmlFor={htmlFor} className="text-sm leading-none font-medium select-none">
        {label}
      </Tag>
      {tooltip && <HelpTip text={tooltip} label={label} />}
      {status && <span className="ml-auto flex items-center gap-1">{status}</span>}
    </div>
  )
}

/** A small (i) with a plain-language tooltip (its own provider, so it works on any page). */
export function HelpTip({ text, label }: { text: string; label: string }) {
  return (
    <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`About ${label}`} className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
    </TooltipProvider>
  )
}
