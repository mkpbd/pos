import { useRef, useState, type DragEvent } from 'react'
import { Loader2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MEDIA_ACCEPT, rejectReason, useUploadMediaMutation, type MediaItem } from '@/features/media/api'
import { cn } from '@/lib/utils'

/**
 * Drop zone plus file button. Files are checked locally, then uploaded one by one;
 * the API answers an identical file with the existing item, which is fine here.
 */
export function UploadZone({ onUploaded, compact = false }: { onUploaded?: (items: MediaItem[]) => void; compact?: boolean }) {
  const upload = useUploadMediaMutation()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = async (files: FileList | File[]) => {
    const uploaded: MediaItem[] = []
    for (const file of Array.from(files)) {
      const reason = rejectReason(file)
      if (reason) {
        toast.error(reason)
        continue
      }
      try {
        uploaded.push(await upload.mutateAsync({ file }))
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'upload failed.'}`)
      }
    }
    if (uploaded.length > 0) {
      toast.success(uploaded.length === 1 && uploaded[0] ? `${uploaded[0].original_name} uploaded.` : `${uploaded.length} images uploaded.`)
      onUploaded?.(uploaded)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-wrap items-center justify-center gap-3 rounded-md border border-dashed text-sm text-muted-foreground transition-colors',
        compact ? 'p-3' : 'p-6',
        dragging && 'border-primary bg-primary/5',
      )}
    >
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        className="sr-only"
        aria-label="Upload images"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <span>Drop images here (JPEG, PNG, WebP, GIF · max. 5 MB) or</span>
      <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
        {upload.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <UploadIcon data-icon="inline-start" />}
        Choose files
      </Button>
    </div>
  )
}
