import { useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { CircleCheckIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon, PaletteIcon, PencilIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useThemeDraftQuery } from '@/features/storefront/api'
import { cn } from '@/lib/utils'
import { useCreateDocumentMutation, type DocumentSummary } from '../api'
import { usePublishAllMutation } from '../templates/api'
import { guideState, LOOKS_ANCHOR } from './page-helpers'
import { rememberGuideHidden, storedGuideHidden, useScreenText } from './screen-language'
import { ScreenConfirm } from './screen-ui'

/*
 * The 3-step guide at the top of the Page builder (B7): choose a look → edit your pages → publish.
 * Each step knows from the store whether it is done and offers the next action. It explains
 * "draft" and "publish" once, so the rest of the screen can use the words. It can be hidden.
 */

type StepProps = {
  number: number
  icon: ComponentType<{ className?: string }>
  title: string
  text: string
  done: boolean
  current: boolean
  children?: ReactNode
}

function Step({ number, icon: Icon, title, text, done, current, children }: StepProps) {
  const { t } = useScreenText()
  return (
    <li
      className={cn('flex flex-col gap-3 rounded-lg border bg-background p-4', current && 'border-primary ring-2 ring-primary/20', done && !current && 'bg-muted/40')}
      data-testid={`guide-step-${number}`}
      data-state={done ? 'done' : current ? 'current' : 'todo'}
      aria-current={current ? 'step' : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', done ? 'bg-success/15 text-success-soft-foreground' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}
          aria-hidden
        >
          {done ? <CircleCheckIcon className="size-5" /> : <Icon className="size-5" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            {t('guide.step', { n: number })}
            {done ? <Badge variant="success">{t('guide.done')}</Badge> : current ? <Badge variant="soft">{t('guide.now')}</Badge> : null}
          </p>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      {children && <div className="mt-auto flex flex-col gap-2">{children}</div>}
    </li>
  )
}

export function StartGuide({ documents, canPublish }: { documents: DocumentSummary[]; canPublish: boolean }) {
  const { t, tc } = useScreenText()
  const navigate = useNavigate()
  const theme = useThemeDraftQuery()
  const create = useCreateDocumentMutation()
  const publishAll = usePublishAllMutation()
  const [hidden, setHidden] = useState(storedGuideHidden)
  const [confirming, setConfirming] = useState(false)
  const state = guideState(documents, theme.data)
  const [lookDone, pagesDone, publishDone] = state.done
  const current = !lookDone ? 1 : !pagesDone ? 2 : !publishDone || state.pending > 0 ? 3 : 0

  const toggle = (next: boolean) => {
    setHidden(next)
    rememberGuideHidden(next)
  }

  if (hidden) {
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => toggle(false)}>
          <ChevronDownIcon aria-hidden /> {t('guide.show')}
        </Button>
      </div>
    )
  }

  const openHome = () => {
    if (state.home) {
      void navigate(`/storefront/builder/${state.home.id}`)
      return
    }
    create.mutate(
      { kind: 'page', key: 'home', title: 'Home', from: 'homepage' },
      { onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`), onError: (error) => toast.error(error.message) },
    )
  }

  const publish = () =>
    publishAll.mutate(
      { documents: state.pendingDocuments.map((d) => d.id), theme: state.themePending },
      {
        onSuccess: () => {
          setConfirming(false)
          toast.success(t('guide.3.published'))
        },
        onError: (error) => {
          setConfirming(false)
          toast.error(error.message)
        },
      },
    )

  return (
    <section aria-labelledby="start-guide-title" className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5" data-testid="start-guide">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-3xl flex-col gap-1">
          <h2 id="start-guide-title" className="text-lg font-semibold">
            {t('guide.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('guide.explain')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => toggle(true)}>
          <ChevronUpIcon aria-hidden /> {t('guide.hide')}
        </Button>
      </div>
      <ol className="grid gap-3 md:grid-cols-3" aria-label={t('guide.listLabel')}>
        <Step number={1} icon={PaletteIcon} title={t('guide.1.title')} text={t('guide.1.text')} done={lookDone} current={current === 1}>
          <Button
            variant={current === 1 ? 'default' : 'outline'}
            size="sm"
            className="self-start"
            onClick={() => document.getElementById(LOOKS_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {t('guide.1.action')}
          </Button>
        </Step>
        <Step number={2} icon={PencilIcon} title={t('guide.2.title')} text={t('guide.2.text')} done={pagesDone} current={current === 2}>
          <Button variant={current === 2 ? 'default' : 'outline'} size="sm" className="self-start" disabled={create.isPending} onClick={openHome}>
            {create.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            {state.home ? t('guide.2.action') : t('guide.2.actionCreate')}
          </Button>
        </Step>
        <Step number={3} icon={SendIcon} title={t('guide.3.title')} text={t('guide.3.text')} done={publishDone} current={current === 3}>
          <p className={cn('text-sm font-medium', state.pending > 0 ? 'text-warning-soft-foreground' : 'text-muted-foreground')} data-testid="guide-pending">
            {state.pending > 0 ? tc('guide.3.pending', state.pending) : t('guide.3.none')}
          </p>
          {state.pending > 0 && (
            <>
              <Button variant={current === 3 ? 'default' : 'outline'} size="sm" className="self-start" disabled={!canPublish || publishAll.isPending} onClick={() => setConfirming(true)}>
                {publishAll.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SendIcon aria-hidden />}
                {t('guide.3.action')}
              </Button>
              {!canPublish && <p className="text-xs text-muted-foreground">{t('guide.3.noPermission')}</p>}
            </>
          )}
        </Step>
      </ol>
      <ScreenConfirm
        open={confirming}
        onOpenChange={setConfirming}
        title={t('guide.3.confirmTitle')}
        description={tc('guide.3.confirmText', state.pending)}
        confirmLabel={t('guide.3.confirm')}
        destructive={false}
        pending={publishAll.isPending}
        onConfirm={publish}
      />
    </section>
  )
}
