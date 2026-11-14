import { useId, useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, PlayIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VIDEO_URL_MESSAGE } from '@/features/online-catalog/listing-form'
import { parseVideoUrl, VIDEO_URL_MAX, videoEmbedUrl } from '@/storefront/builder/validate'

const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const

type Props = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** A save error (client check or server); replaces the live check while shown. */
  error?: string
  disabled?: boolean
}

/**
 * P1b: the product video link. The link is checked while typing with the builder video element's
 * patterns (YouTube watch / youtu.be / Shorts, Vimeo), and "Preview video" plays it right here in
 * the privacy-enhanced player — nothing loads from YouTube or Vimeo before that click.
 */
export function ProductVideoField({ value, onChange, onBlur, error, disabled }: Props) {
  const id = useId()
  const messageId = `${id}-message`
  const url = value.trim()
  const detected = url ? parseVideoUrl(url) : null
  const embed = detected ? videoEmbedUrl(detected.provider, detected.video_id) : null
  // The previewed player URL: a changed link closes the preview by itself.
  const [previewing, setPreviewing] = useState<string | null>(null)
  const showPreview = embed !== null && previewing === embed

  return (
    <div className="flex flex-col gap-1.5" data-testid="product-video">
      <Label htmlFor={id}>Video link (optional)</Label>
      <Input
        id={id}
        inputMode="url"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={VIDEO_URL_MAX}
        placeholder="https://www.youtube.com/watch?v=…"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div id={messageId} aria-live="polite" className="text-sm">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : !url ? (
          <p className="text-muted-foreground">A YouTube or Vimeo link. It plays as the last photo on the product page, only when a shopper presses play.</p>
        ) : detected ? (
          <p className="flex items-center gap-1.5 text-success-soft-foreground" data-testid="video-detected">
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden /> {PROVIDER_NAMES[detected.provider]} video found ({detected.video_id}).
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-warning-soft-foreground" data-testid="video-not-detected">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>This isn’t a video link yet. {VIDEO_URL_MESSAGE}</span>
          </p>
        )}
      </div>
      {embed && !error && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" className="self-start" aria-expanded={showPreview} onClick={() => setPreviewing(showPreview ? null : embed)}>
            {showPreview ? <XIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            {showPreview ? 'Close preview' : 'Preview video'}
          </Button>
          {showPreview && (
            <iframe
              src={embed}
              title="Product video preview"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="aspect-video w-full max-w-md rounded-md border bg-black"
              data-testid="video-preview"
            />
          )}
        </div>
      )}
    </div>
  )
}
