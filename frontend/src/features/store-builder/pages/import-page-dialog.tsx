import { useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, FileJsonIcon, Loader2Icon, PackageXIcon, ScissorsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { elementMeta } from '@/storefront/builder/registry'
import { builderAdminKeys, documentPath, type DocumentSummary } from '../api'
import {
  canImportAsNewPage,
  normalizeReport,
  readExportFile,
  replaceableDocuments,
  useImportPageMutation,
  type ExportPreview,
  type ImportProblem,
  type ImportReport,
  type MappedCounts,
} from './import-api'
import { importCount, importWord, type ImportCountKey, type ImportWordKey, type WordValues } from './import-words'
import { slugify, slugProblemKey } from './page-helpers'
import { useScreenText } from './screen-language'

/*
 * B16 §4: "Import a page…" on the Pages list. Choose a page copy (.json from "Download a copy"),
 * see what it is (kind, title, shop, date), and bring it in as a new campaign page (name and
 * address) or over the draft of one of your pages of the same kind. The answer is a report in
 * plain words: what was brought over, what isn't in this shop and which parts were left out.
 * Nothing is published.
 */

type FileState = { status: 'none' } | { status: 'reading'; file: File } | { status: 'ready'; file: File; preview: ExportPreview } | { status: 'problem'; problem: ImportProblem }

const MAPPED_ORDER = ['media', 'products', 'categories', 'brands', 'banners', 'menus', 'blog_categories', 'promotions'] as const satisfies readonly (keyof MappedCounts)[]
const MISSING_TYPES = new Set(['product', 'category', 'brand', 'menu', 'blog_category', 'promotion', 'media'])

function useImportText() {
  const screen = useScreenText()
  return {
    ...screen,
    w: (key: ImportWordKey, values?: WordValues) => importWord(screen.lang, key, values),
    wc: (key: ImportCountKey, count: number, values?: WordValues) => importCount(screen.lang, key, count, values),
  }
}

/** An element type in words: the registry's label, else the type spelled out ("product_grid" → "Product grid"). */
function elementLabel(type: string): string {
  const label = elementMeta(type)?.label
  if (label) return label
  const words = type.replace(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : type
}

function ImportReportView({ report, mode, onOpen, onClose }: { report: ImportReport; mode: 'new' | 'replace'; onOpen: () => void; onClose: () => void }) {
  const { w, wc } = useImportText()
  const { created_document: doc, mapped, missing, dropped_elements: dropped } = normalizeReport(report)
  const mappedLines = MAPPED_ORDER.filter((key) => (mapped[key] ?? 0) > 0).map((key) => wc(`mapped.${key}`, mapped[key] ?? 0))
  return (
    <div className="flex flex-col gap-4" data-testid="import-report">
      <div role="status" className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 p-3">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success-soft-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{w(mode === 'new' ? 'done.new' : 'done.replace', { name: doc.title })}</p>
          <p className="text-sm">{w('done.notPublished')}</p>
        </div>
      </div>

      <section aria-labelledby="import-mapped" className="flex flex-col gap-1.5">
        <h3 id="import-mapped" className="text-sm font-semibold">
          {w('done.mapped')}
        </h3>
        {mappedLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{w('done.mappedNone')}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm" data-testid="import-mapped">
            {mappedLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      {missing.length > 0 && (
        <section aria-labelledby="import-missing" className="flex flex-col gap-1.5">
          <h3 id="import-missing" className="flex items-center gap-2 text-sm font-semibold">
            <PackageXIcon className="size-4" aria-hidden /> {w('done.missing')}
          </h3>
          <p className="text-sm text-muted-foreground">{w('done.missingHelp')}</p>
          <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm" data-testid="import-missing">
            {missing.map((item, index) => (
              <li key={`${item.type}-${item.name ?? ''}-${index}`}>
                {w(MISSING_TYPES.has(item.type) ? (`missing.${item.type}` as ImportWordKey) : 'missing.other')}: {item.name?.trim() || w('missing.noName')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dropped.length > 0 && (
        <section aria-labelledby="import-dropped" className="flex flex-col gap-1.5">
          <h3 id="import-dropped" className="flex items-center gap-2 text-sm font-semibold">
            <ScissorsIcon className="size-4" aria-hidden /> {w('done.dropped')}
          </h3>
          <p className="text-sm text-muted-foreground">{w('done.droppedHelp')}</p>
          <ul className="list-disc pl-5 text-sm" data-testid="import-dropped">
            {dropped.map((item) => (
              <li key={item.type}>{w('droppedCount', { name: elementLabel(item.type), count: item.count })}</li>
            ))}
          </ul>
        </section>
      )}

      {missing.length === 0 && dropped.length === 0 && <p className="text-sm">{w('done.allGood')}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {w('done.close')}
        </Button>
        <Button type="button" onClick={onOpen} autoFocus>
          {w('done.open')}
        </Button>
      </DialogFooter>
    </div>
  )
}

function errorWords(error: unknown, w: ReturnType<typeof useImportText>['w'], t: ReturnType<typeof useImportText>['t']): { message: string; reason?: string } {
  if (!(error instanceof ApiError)) return { message: error instanceof Error ? error.message : t('common.tryAgain') }
  const reason = typeof error.details?.reason === 'string' ? error.details.reason : undefined
  switch (error.code) {
    case 'IMPORT_INVALID':
      return { message: w('error.invalid'), reason }
    case 'IMPORT_TOO_LARGE':
      return { message: w('error.tooLarge') }
    case 'IMPORT_KIND_MISMATCH':
      return { message: w('error.kindMismatch') }
    case 'DRAFT_CONFLICT':
      return { message: w('error.conflict') }
    case 'DOCUMENT_EXISTS':
      return { message: t('landing.exists') }
    case 'DOCUMENT_LOCKED': {
      const user = error.details?.user as { name?: unknown } | undefined
      return { message: typeof user?.name === 'string' && user.name ? w('error.locked', { name: user.name }) : w('error.lockedSomeone') }
    }
    default:
      return { message: error.message || t('common.tryAgain') }
  }
}

export function ImportPageDialog({ open, onOpenChange, documents }: { open: boolean; onOpenChange: (open: boolean) => void; documents: DocumentSummary[] }) {
  const { w, wc, t, lang, date } = useImportText()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const importing = useImportPageMutation()
  const [file, setFile] = useState<FileState>({ status: 'none' })
  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [targetId, setTargetId] = useState<string>('')
  const [submitted, setSubmitted] = useState(false)
  const [report, setReport] = useState<{ report: ImportReport; mode: 'new' | 'replace' } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const readToken = useRef(0)
  const ids = { file: useId(), fileHelp: useId(), fileProblem: useId(), title: useId(), slug: useId(), slugHelp: useId(), page: useId(), mode: useId() }

  const preview = file.status === 'ready' ? file.preview : null
  const newAllowed = preview ? canImportAsNewPage(preview) : true
  const replaceable = preview ? replaceableDocuments(documents, preview) : []
  const effectiveMode: 'new' | 'replace' = newAllowed ? mode : 'replace'
  const pageTitle = titleTouched ? title : (preview?.title ?? '')
  const effectiveSlug = slugTouched ? slug : slugify(pageTitle)
  const titleProblem = pageTitle.trim() ? null : t('landing.titleProblem')
  const slugKey = slugProblemKey(effectiveSlug)
  const slugError = slugKey ? t(slugKey) : null
  const target = replaceable.find((d) => d.id === targetId) ?? null
  const targetProblem = effectiveMode === 'replace' && !target ? w('pageProblem') : null
  const serverError = importing.error ? errorWords(importing.error, w, t) : null

  const reset = () => {
    readToken.current += 1
    setFile({ status: 'none' })
    setMode('new')
    setTitle('')
    setTitleTouched(false)
    setSlug('')
    setSlugTouched(false)
    setTargetId('')
    setSubmitted(false)
    setReport(null)
    importing.reset()
  }

  const close = (next: boolean) => {
    if (!next && importing.isPending) return
    if (!next) reset()
    onOpenChange(next)
  }

  const choose = async (chosen: File | undefined) => {
    importing.reset()
    setTargetId('')
    const token = ++readToken.current
    if (!chosen) {
      setFile({ status: 'none' })
      return
    }
    setFile({ status: 'reading', file: chosen })
    const result = await readExportFile(chosen)
    if (token !== readToken.current) return
    setFile('problem' in result ? { status: 'problem', problem: result.problem } : { status: 'ready', file: chosen, preview: result.preview })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (file.status !== 'ready' || importing.isPending) {
      if (file.status === 'none') fileInput.current?.focus()
      return
    }
    if (effectiveMode === 'new' ? titleProblem || slugError : targetProblem) return
    const chosenMode = effectiveMode
    importing.mutate(
      {
        file: file.file,
        target: chosenMode === 'new' ? { target: 'new', title: pageTitle.trim(), key: `landing:${effectiveSlug}` } : { target: 'replace', document_id: target!.id, revision: target!.draft_revision },
      },
      {
        onSuccess: (result) => setReport({ report: result, mode: chosenMode }),
        onError: (error) => {
          // A stale revision: the list is refreshed so the next try sends the current one.
          if (error instanceof ApiError && error.code === 'DRAFT_CONFLICT') void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
        },
      },
    )
  }

  const fileProblem = file.status === 'problem' ? w(`problem.${file.problem}`) : submitted && file.status === 'none' ? w('problem.noFile') : null
  const kindName = preview ? w(`kind.${preview.keyKind}`) : ''

  const radio = (value: 'new' | 'replace', label: string, help: string, disabled: boolean) => (
    <label
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5',
      )}
    >
      <input
        type="radio"
        name={ids.mode}
        value={value}
        checked={effectiveMode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
        aria-labelledby={`${ids.mode}-${value}`}
        aria-describedby={`${ids.mode}-${value}-help`}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span id={`${ids.mode}-${value}`} className="font-medium">
          {label}
        </span>
        <span id={`${ids.mode}-${value}-help`} className="text-muted-foreground">
          {help}
        </span>
      </span>
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent lang={lang} className={cn('max-h-[92svh] overflow-y-auto sm:max-w-xl', lang === 'bn' && 'leading-relaxed')}>
        <DialogHeader>
          <DialogTitle>{w('title')}</DialogTitle>
          <DialogDescription>{w('intro')}</DialogDescription>
        </DialogHeader>
        {report ? (
          <ImportReportView
            report={report.report}
            mode={report.mode}
            onClose={() => close(false)}
            onOpen={() => {
              const id = report.report.created_document.id
              close(false)
              void navigate(`/storefront/builder/${id}`)
            }}
          />
        ) : (
          <>
            <form id="import-page" noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.file}>{w('fileLabel')}</Label>
                <Input
                  ref={fileInput}
                  id={ids.file}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void choose(e.target.files?.[0])}
                  aria-invalid={!!fileProblem || undefined}
                  aria-describedby={fileProblem ? `${ids.fileHelp} ${ids.fileProblem}` : ids.fileHelp}
                />
                <p id={ids.fileHelp} className="text-sm text-muted-foreground">
                  {w('fileHelp')}
                </p>
                {file.status === 'reading' && (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" aria-hidden /> {w('reading')}
                  </p>
                )}
                {fileProblem && (
                  <p id={ids.fileProblem} role="alert" className="text-sm text-destructive">
                    {fileProblem}
                  </p>
                )}
              </div>

              {preview && (
                <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3" data-testid="import-file-summary">
                  <FileJsonIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                    <p className="font-medium break-words">
                      {kindName}
                      {preview.title ? `: “${preview.title}”` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      {[
                        preview.store ? w('fileFrom', { store: preview.store }) : null,
                        preview.exportedAt ? w('fileDate', { date: date(preview.exportedAt) }) : null,
                        preview.media > 0 ? wc('filePictures', preview.media) : null,
                        preview.products > 0 ? wc('fileProducts', preview.products) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              )}

              {preview && (
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">{w('targetLegend')}</legend>
                  {radio('new', w('target.new'), newAllowed ? w('target.newHelp') : w('target.newNotPossible'), !newAllowed)}
                  {radio('replace', w('target.replace'), replaceable.length > 0 ? w('target.replaceHelp') : w('target.replaceNone', { kind: kindName.toLowerCase() }), replaceable.length === 0)}
                </fieldset>
              )}

              {preview && effectiveMode === 'new' && newAllowed && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={ids.title}>{t('landing.titleLabel')}</Label>
                    <Input
                      id={ids.title}
                      value={pageTitle}
                      maxLength={160}
                      onChange={(e) => {
                        setTitle(e.target.value)
                        setTitleTouched(true)
                      }}
                      aria-invalid={(submitted && !!titleProblem) || undefined}
                    />
                    {submitted && titleProblem && <p className="text-sm text-destructive">{titleProblem}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={ids.slug}>{t('landing.addressLabel')}</Label>
                    <Input
                      id={ids.slug}
                      value={effectiveSlug}
                      maxLength={60}
                      onChange={(e) => {
                        setSlugTouched(true)
                        setSlug(e.target.value.toLowerCase())
                      }}
                      aria-invalid={((submitted || slugTouched) && !!slugError) || undefined}
                      aria-describedby={ids.slugHelp}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    <p id={ids.slugHelp} className="text-sm text-muted-foreground">
                      {t('landing.addressHelp')} <span className="font-mono text-foreground">/p/{effectiveSlug || '…'}</span>
                    </p>
                    {(submitted || slugTouched) && slugError && <p className="text-sm text-destructive">{slugError}</p>}
                  </div>
                </>
              )}

              {preview && effectiveMode === 'replace' && replaceable.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={ids.page}>{w('pageLabel')}</Label>
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id={ids.page} className="w-full" aria-invalid={(submitted && !!targetProblem) || undefined}>
                      <SelectValue placeholder={w('pagePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {replaceable.map((doc) => {
                        const path = documentPath(doc)
                        return (
                          <SelectItem key={doc.id} value={doc.id}>
                            {doc.title}
                            {path ? ` (${path})` : ''}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  {submitted && targetProblem && <p className="text-sm text-destructive">{targetProblem}</p>}
                  {target && (
                    <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" data-testid="import-replace-warning">
                      {w('replaceWarning', { name: target.title })}
                    </p>
                  )}
                </div>
              )}

              {serverError && (
                <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                  <p>{serverError.message}</p>
                  {serverError.reason && <p className="text-muted-foreground">{w('error.reason', { reason: serverError.reason })}</p>}
                </div>
              )}
            </form>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={importing.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="import-page" disabled={importing.isPending || file.status === 'reading'} aria-busy={importing.isPending || undefined}>
                {importing.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
                {importing.isPending ? w('importing') : w('submit')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
