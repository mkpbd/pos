import type { ReactNode } from 'react'
import { AlertTriangleIcon, CircleCheckIcon, CircleHelpIcon, CircleAlertIcon, ImageIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CONFIDENCE_WORDS, describeAiHelpError, type Confidence } from './model'

/** Confidence as an icon and a word (never colour alone); the hint is in the accessible name too. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const words = CONFIDENCE_WORDS[confidence]
  const Icon = confidence === 'high' ? CircleCheckIcon : confidence === 'medium' ? CircleHelpIcon : CircleAlertIcon
  return (
    <Badge variant={confidence === 'high' ? 'success' : confidence === 'medium' ? 'warning' : 'outline'} title={words.hint} data-testid="confidence" data-confidence={confidence}>
      <Icon aria-hidden data-icon="inline-start" />
      {words.label}
      <span className="sr-only"> confidence: {words.hint}</span>
    </Badge>
  )
}

/** A failed AI help request in plain words. */
export function AiHelpErrorAlert({ error, action }: { error: unknown; action?: ReactNode }) {
  const info = describeAiHelpError(error)
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{info.title}</p>
        <p className="text-muted-foreground">{info.message}</p>
        {action}
      </div>
    </div>
  )
}

export type ChosenItem = { id: string; name: string; image_url?: string | null }

/** The chosen items as removable chips. */
export function ChosenList({ label, items, onRemove }: { label: string; items: ChosenItem[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-3 text-sm">
          <span className="truncate">{item.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  )
}

export function Thumb({ url }: { url: string | null | undefined }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
    </span>
  )
}
