import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppWindowIcon, EyeIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useCreateDocumentMutation, useSetPopupActiveMutation, type DocumentSummary, type PopupStatus } from '../api'
import { POPUP_LAYOUT_ICONS, POPUP_TEMPLATE_LAYOUTS, popupStatus } from '../popup-model'
import { PopupSketch } from '../popup-visuals'
import { usePopupTemplatesQuery, type BuilderTemplate } from '../templates/api'
import type { RemoveRequest } from './builder-parts'
import type { MessageKey } from './messages'
import { lastEdited } from './page-helpers'
import { EditLink, ListRow } from './page-rows'
import { useScreenText } from './screen-language'

/*
 * B8b: the "Popups & bars" group of the start screen. Each popup shows its layout, when it shows,
 * its state on the store (live, switched off, scheduled, ended, not published), an on / off switch
 * (`storefront.publish`; only once published), Edit, Preview and Delete. "New popup or bar" starts
 * from a ready-made popup template or an empty popup.
 */

const STATUS_VARIANT: Record<PopupStatus, 'success' | 'info' | 'soft' | 'warning'> = {
  live: 'success',
  scheduled: 'info',
  off: 'soft',
  expired: 'soft',
  draft: 'soft',
}

/** A template's name and line in the screen's language (built-ins by id), else the server's words. */
function useTemplateWords() {
  const { t } = useScreenText()
  return (template: Pick<BuilderTemplate, 'id' | 'name' | 'description'>) => {
    if (template.id in POPUP_TEMPLATE_LAYOUTS) {
      return { name: t(`popups.tpl.${template.id}` as MessageKey), text: t(`popups.tpl.${template.id}.text` as MessageKey) }
    }
    return { name: template.name, text: template.description ?? '' }
  }
}

function PopupRow({ summary, canManage, canPublish, onDelete }: { summary: DocumentSummary; canManage: boolean; canPublish: boolean; onDelete: () => void }) {
  const { t, lang, date } = useScreenText()
  const setActive = useSetPopupActiveMutation()
  const switchId = useId()
  const hintId = useId()
  const status = popupStatus(summary)
  const layout = summary.popup?.layout ?? 'modal'
  const Icon = POPUP_LAYOUT_ICONS[layout]
  const active = summary.active === true
  const neverPublished = !summary.published
  const hint = !canPublish ? t('popups.activeHint.permission') : neverPublished && !active ? t('popups.activeHint.publish') : null
  const schedule = [
    summary.popup?.starts_at ? t('popups.from', { date: date(summary.popup.starts_at, true) }) : null,
    summary.popup?.ends_at ? t('popups.until', { date: date(summary.popup.ends_at, true) }) : null,
  ].filter(Boolean)

  const toggle = (next: boolean) =>
    setActive.mutate(
      { id: summary.id, active: next },
      {
        onSuccess: () => toast.success(t(next ? 'popups.switchedOn' : 'popups.switchedOff', { name: summary.title })),
        // POPUP_NOT_PUBLISHED and the other refusals carry a message meant for people.
        onError: (error) => toast.error(error instanceof ApiError && error.status === 422 ? error.message : t('popups.switchFailed')),
      },
    )

  return (
    <ListRow
      testId={`popup-row-${summary.id}`}
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {summary.title}
        </span>
      }
      detail={
        <>
          {t(`popups.layout.${layout}` as MessageKey)}
          {summary.popup?.trigger && ` · ${t(`popups.trigger.${summary.popup.trigger}` as MessageKey)}`}
          {schedule.length > 0 && ` · ${schedule.join(' – ')}`}
          {` · ${lastEdited(summary, lang)}`}
        </>
      }
      status={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[status]} data-testid="popup-status">{t(`popups.status.${status}` as MessageKey)}</Badge>
          {summary.published && summary.has_unpublished_changes && <Badge variant="warning">{t('row.unpublished')}</Badge>}
        </span>
      }
    >
      <span className="flex items-center gap-2 pr-2">
        <Switch
          id={switchId}
          checked={active}
          disabled={!canPublish || setActive.isPending || (neverPublished && !active)}
          aria-label={t('popups.activeAria', { name: summary.title })}
          aria-describedby={hint ? hintId : undefined}
          onCheckedChange={toggle}
        />
        <Label htmlFor={switchId} className="text-sm font-normal">
          {t('popups.active')}
        </Label>
        {hint && (
          <span id={hintId} className="sr-only">
            {hint}
          </span>
        )}
      </span>
      {canManage && <EditLink summary={summary} name={summary.title} />}
      {summary.preview_url && (
        <Button variant="ghost" size="sm" asChild>
          <a href={summary.preview_url} target="_blank" rel="noopener noreferrer" aria-label={`${t('common.preview')}: ${summary.title} ${t('common.newTab')}`}>
            <EyeIcon aria-hidden /> {t('common.preview')}
          </a>
        </Button>
      )}
      {canManage && (
        <Button variant="ghost" size="icon-sm" aria-label={t('popups.deleteAria', { name: summary.title })} title={t('popups.deleteHint')} onClick={onDelete}>
          <Trash2Icon />
        </Button>
      )}
      {hint && (
        <p aria-hidden className="basis-full text-right text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </ListRow>
  )
}

const BLANK = '__blank'

function NewPopupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = useScreenText()
  const words = useTemplateWords()
  const templates = usePopupTemplatesQuery(open)
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const [choice, setChoice] = useState<string>(BLANK)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const nameId = useId()
  const list = (templates.data ?? []).filter((tpl) => tpl.scope === 'popup')

  const close = (next: boolean) => {
    if (!next) {
      setChoice(BLANK)
      setTitle('')
      setTitleTouched(false)
      setSubmitted(false)
      create.reset()
    }
    onOpenChange(next)
  }
  const pick = (id: string) => {
    setChoice(id)
    // The name follows the choice until the person types their own.
    if (!titleTouched) {
      const template = list.find((tpl) => tpl.id === id)
      setTitle(template ? words(template).name : '')
    }
  }
  const titleProblem = title.trim() ? null : t('popups.nameProblem')
  const serverError = create.error instanceof ApiError ? create.error : null

  const option = (id: string, name: string, text: string, sketch: React.ReactNode) => (
    <label
      key={id}
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
        choice === id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
      data-testid={`popup-template-${id}`}
    >
      <input type="radio" name="popup-start" value={id} checked={choice === id} onChange={() => pick(id)} className="sr-only" />
      {sketch}
      <span className="font-medium">{name}</span>
      {text && <span className="text-xs text-muted-foreground">{text}</span>}
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent lang={lang} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('popups.new')}</DialogTitle>
          <DialogDescription>{t('popups.dialogText')}</DialogDescription>
        </DialogHeader>
        <form
          id="new-popup"
          className="flex min-h-0 flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (titleProblem) return
            create.mutate(
              { kind: 'popup', title: title.trim(), template: choice === BLANK ? null : choice },
              {
                onSuccess: (created) => {
                  toast.success(t('popups.created'))
                  close(false)
                  void navigate(`/storefront/builder/${created.id}`)
                },
              },
            )
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('popups.startLegend')}</legend>
            <div role="radiogroup" aria-label={t('popups.startLegend')} className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((template) => {
                const w = words(template)
                const layout = POPUP_TEMPLATE_LAYOUTS[template.id] ?? 'modal'
                return option(
                  template.id,
                  w.name,
                  w.text,
                  template.thumbnail_url ? <img src={template.thumbnail_url} alt="" className="aspect-[4/3] w-full rounded-md border object-cover" /> : <PopupSketch layout={layout} />,
                )
              })}
              {option(BLANK, t('popups.blank'), t('popups.blankDetail'), <PopupSketch layout="modal" className="opacity-60" />)}
            </div>
            {templates.isPending && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" aria-hidden /> {t('popups.templatesLoading')}
              </p>
            )}
            {templates.error && <p className="text-sm text-muted-foreground">{t('popups.templatesError')}</p>}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>{t('popups.nameLabel')}</Label>
            <Input
              id={nameId}
              value={title}
              maxLength={160}
              placeholder={t('popups.namePlaceholder')}
              aria-invalid={submitted && !!titleProblem}
              aria-describedby={`${nameId}-help`}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
            />
            <p id={`${nameId}-help`} className="text-sm text-muted-foreground">
              {t('popups.nameHelp')}
            </p>
            {submitted && titleProblem && <p className="text-sm text-destructive">{titleProblem}</p>}
          </div>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError.message}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="new-popup" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            {t('popups.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PopupsCard({ documents, canManage, canPublish, onRemove }: { documents: DocumentSummary[]; canManage: boolean; canPublish: boolean; onRemove: (request: RemoveRequest) => void }) {
  const { t } = useScreenText()
  const [creating, setCreating] = useState(false)
  const popups = [...documents].sort((a, b) => a.title.localeCompare(b.title))
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <CardDescription className="flex max-w-2xl items-start gap-2">
          <AppWindowIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('popups.note')}
        </CardDescription>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden /> {t('popups.new')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {popups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('popups.empty')}</p>
        ) : (
          <ul className="divide-y" aria-label={t('popups.listLabel')}>
            {popups.map((summary) => (
              <PopupRow
                key={summary.id}
                summary={summary}
                canManage={canManage}
                canPublish={canPublish}
                onDelete={() =>
                  onRemove({
                    summary,
                    title: t('popups.deleteTitle', { name: summary.title }),
                    description: t('popups.deleteText'),
                    confirmLabel: t('popups.deleteConfirm'),
                    done: t('popups.deleted'),
                  })
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
      <NewPopupDialog open={creating} onOpenChange={setCreating} />
    </Card>
  )
}
