import { useId, useRef, useState } from 'react'
import { Loader2Icon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FONT_LIMITS, useDeleteFontMutation, useUploadFontMutation, type StoreFont, type StoreFontList } from '@/features/storefront/api'
import { BANGLA_SAMPLE } from '@/storefront/fonts'
import { checkFontUpload, FONT_NAME_MAX, FONT_WEIGHTS, fileSize, fontDeleteError, fontUploadError, previewStack, usageText, WEIGHT_NAMES, weightRange, type FontUploadErrors } from './typography-model'

/*
 * B10 "Your own fonts": upload a WOFF2 font (name, file, lightest and boldest weight; 500 KB, four
 * per store), see it in English and Bangla, delete it — refused while the theme (draft or live)
 * uses it, with the reason. Uploaded fonts are offered in every font picker above.
 */

const EMPTY = { name: '', file: null as File | null, weight_min: 400, weight_max: 400 }

export function CustomFonts({ data, loading, disabled }: { data: StoreFontList | undefined; loading: boolean; disabled: boolean }) {
  const fonts = data?.fonts ?? []
  const limit = data?.limit ?? FONT_LIMITS.files
  const maxBytes = data?.max_bytes ?? FONT_LIMITS.maxBytes
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState<FontUploadErrors>({})
  const [deleting, setDeleting] = useState<StoreFont | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const upload = useUploadFontMutation()
  const remove = useDeleteFontMutation()
  const id = useId()
  const full = fonts.length >= limit

  const submit = async () => {
    const problems = checkFontUpload(form, { count: fonts.length, limit, maxBytes }, fonts)
    setErrors(problems)
    if (Object.keys(problems).length > 0 || !form.file) return
    try {
      const font = await upload.mutateAsync({ file: form.file, name: form.name.trim(), weight_min: form.weight_min, weight_max: form.weight_max })
      toast.success(`“${font.name}” is uploaded. Choose it in a font list above.`)
      setForm(EMPTY)
      if (fileInput.current) fileInput.current.value = ''
    } catch (error) {
      setErrors(fontUploadError(error))
    }
  }

  const confirmDelete = async () => {
    const font = deleting
    if (!font) return
    setDeleteError(null)
    try {
      await remove.mutateAsync(font.id)
      toast.success(`“${font.name}” is deleted.`)
    } catch (error) {
      setDeleteError(`“${font.name}” wasn’t deleted. ${fontDeleteError(error)}`)
    } finally {
      setDeleting(null)
    }
  }

  const weightSelect = (key: 'weight_min' | 'weight_max', label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Select value={String(form[key])} onValueChange={(v) => setForm((f) => ({ ...f, [key]: Number(v) }))} disabled={disabled || full}>
        <SelectTrigger id={`${id}-${key}`} className="w-full" aria-label={label} aria-invalid={key === 'weight_max' && errors.weight_max ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_WEIGHTS.map((w) => (
            <SelectItem key={w} value={String(w)}>
              {w} · {WEIGHT_NAMES[w]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {key === 'weight_max' && errors.weight_max && <p className="text-sm text-destructive">{errors.weight_max}</p>}
    </div>
  )

  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby={`${id}-title`} data-testid="custom-fonts">
      <div className="flex flex-col gap-1">
        <h4 id={`${id}-title`} className="text-sm font-medium">
          Your own fonts <span className="font-normal text-muted-foreground tabular-nums">({fonts.length} of {limit})</span>
        </h4>
        <p className="text-xs text-muted-foreground">Upload a font you have the right to use, as a WOFF2 file of at most {fileSize(maxBytes)}. It then shows in every font list above.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your fonts…</p>
      ) : fonts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fonts uploaded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Uploaded fonts">
          {fonts.map((font) => {
            const usage = usageText(font)
            return (
              <li key={font.id} className="flex items-start gap-2 rounded-md border p-2" data-testid="custom-font">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{font.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Weights {weightRange(font.weight_min, font.weight_max)} · {fileSize(font.size)}
                  </p>
                  <p className="truncate text-base" style={{ fontFamily: previewStack(font.key, fonts) }} aria-hidden>
                    Welcome to our shop · <span lang="bn">{BANGLA_SAMPLE}</span>
                  </p>
                  {usage && <p className="text-xs text-muted-foreground" id={`${id}-${font.id}-usage`}>{usage}. Choose another font there to delete it.</p>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${font.name}`}
                  aria-describedby={usage ? `${id}-${font.id}-usage` : undefined}
                  title={usage ? `${usage}: it can’t be deleted` : `Delete ${font.name}`}
                  disabled={disabled || usage !== null}
                  onClick={() => setDeleting(font)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {deleteError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      )}

      {!disabled && (
        // Not a <form>: the Theme page's own form is around it.
        <div className="flex flex-col gap-3 border-t pt-3" role="group" aria-label="Upload a font">
          {full && <p className="text-sm text-muted-foreground">You have {limit} fonts, the most a store can have. Delete one to upload another.</p>}
          {errors.form && !full && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Font name</Label>
            <Input
              id={`${id}-name`}
              value={form.name}
              maxLength={FONT_NAME_MAX}
              placeholder="e.g. Shonar Bangla"
              disabled={full}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => {
                // Enter uploads (and doesn't submit the page's form around it).
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            {errors.name && <p id={`${id}-name-error`} className="text-sm text-destructive">{errors.name}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-file`}>Font file (.woff2)</Label>
            <Input
              ref={fileInput}
              id={`${id}-file`}
              type="file"
              accept=".woff2,font/woff2"
              disabled={full}
              aria-invalid={errors.file ? true : undefined}
              aria-describedby={errors.file ? `${id}-file-error` : undefined}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setForm((f) => ({ ...f, file, name: f.name || (file ? file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, FONT_NAME_MAX) : '') }))
              }}
            />
            {errors.file && <p id={`${id}-file-error`} className="text-sm text-destructive">{errors.file}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {weightSelect('weight_min', 'Lightest weight')}
            {weightSelect('weight_max', 'Boldest weight')}
          </div>
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={full || upload.isPending} onClick={() => void submit()}>
            {upload.isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
            Upload font
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this font'}?`}
        description="The font file is removed from your store. This can’t be undone."
        confirmLabel="Delete font"
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
