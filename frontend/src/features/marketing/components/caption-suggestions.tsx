import { useId, useState } from 'react'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { captionSourceNote } from '@/features/marketing/social'
import { useCaptionSuggestionsMutation, type CaptionLanguage, type CaptionTone } from '@/features/marketing/social-api'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'

const LANGUAGES: { value: CaptionLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'bn', label: 'বাংলা (Bangla)' },
]

const TONES: { value: CaptionTone; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'festive', label: 'Festive (Eid, Puja, sales)' },
  { value: 'short', label: 'Short' },
]

function suggestError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return 'Too many suggestions — try again in a minute.'
  const map = fieldErrorMap(error)
  return map.product_id ?? map.form ?? Object.values(map)[0] ?? 'Suggestions are not available right now.'
}

/**
 * "Suggest captions": three captions for the chosen product in English or Bangla and a tone —
 * from AI when it is on, else ready-made ones (the note says which). Render with `key={productId}`.
 */
export function CaptionSuggestions({ productId, onUse }: { productId: string | null; onUse: (caption: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<CaptionLanguage>('en')
  const [tone, setTone] = useState<CaptionTone>('friendly')
  const suggest = useCaptionSuggestionsMutation()
  const result = suggest.data

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!productId} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((v) => !v)}>
          <SparklesIcon data-icon="inline-start" /> Suggest captions
        </Button>
        {!productId && <span className="text-xs text-muted-foreground">Choose a product to get caption ideas.</span>}
      </div>

      {open && productId && (
        <div id={`${id}-panel`} className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-language`}>Language</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as CaptionLanguage)}>
                <SelectTrigger id={`${id}-language`} className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-tone`}>Tone</Label>
              <Select value={tone} onValueChange={(v) => setTone(v as CaptionTone)}>
                <SelectTrigger id={`${id}-tone`} className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" size="sm" disabled={suggest.isPending} onClick={() => suggest.mutate({ product_id: productId, language, tone })}>
              {suggest.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {result ? 'Suggest again' : 'Suggest'}
            </Button>
          </div>

          <div aria-live="polite" className="flex flex-col gap-2">
            {suggest.isPending && <p className="text-sm text-muted-foreground">Writing captions…</p>}
            {suggest.error && !suggest.isPending && <p role="alert" className="text-sm text-destructive">{suggestError(suggest.error)}</p>}
            {result && !suggest.isPending && (
              <>
                <p className="text-xs text-muted-foreground" data-testid="caption-source">{captionSourceNote(result.source, result.reason)}</p>
                <ol aria-label="Suggested captions" className="flex flex-col gap-2">
                  {result.captions.map((caption, i) => (
                    <li key={`${i}-${caption}`} className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-start sm:justify-between">
                      <p className="text-sm whitespace-pre-line" lang={suggest.variables?.language === 'bn' ? 'bn' : undefined}>{caption}</p>
                      <Button type="button" variant="outline" size="sm" className="shrink-0" aria-label={`Use this caption ${i + 1}`} onClick={() => onUse(caption)}>
                        Use this
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
