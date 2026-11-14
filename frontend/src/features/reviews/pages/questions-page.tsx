import { useEffect, useId, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { CheckIcon, ExternalLinkIcon, EyeOffIcon, Loader2Icon, MessageSquareReplyIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PaginationBar } from '@/components/common/pagination-bar'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/state-views'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth, useCan } from '@/features/auth/use-auth'
import { ProductFilter } from '@/features/reviews/components/product-filter'
import { ReviewsHeader } from '@/features/reviews/components/reviews-header'
import { useAnswerQuestionMutation, useModerateQuestionMutation, useQuestionsQuery, type ProductQuestion, type QuestionModeration } from '@/features/reviews/questions-api'
import {
  ANSWER_MAX,
  askedInBangla,
  EMPTY_QUESTION_TITLES,
  QUESTION_TAB_LABELS,
  QUESTION_TABS,
  questionFiltersFromSearchParams,
  questionFiltersToSearchParams,
  questionListParams,
  questionStatusBadge,
  type QuestionFilters,
  type QuestionTab,
} from '@/features/reviews/questions'
import { formatDateTime } from '@/features/web-orders/orders'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMap } from '@/lib/forms'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return 'This question no longer exists; the list was refreshed.'
  return error instanceof Error ? error.message : 'Something went wrong.'
}

type AnswerFormProps = {
  question: ProductQuestion
  pending: boolean
  /** A refused answer from the server. */
  error?: string
  onSubmit: (answer: string, publish: boolean) => void
  onCancel: () => void
}

/** Write or edit the answer; publishing shows it under the question on the product page. */
function AnswerForm({ question, pending, error, onSubmit, onCancel }: AnswerFormProps) {
  const id = useId()
  const [text, setText] = useState(question.answer ?? '')
  const [empty, setEmpty] = useState(false)
  const published = question.status === 'published'
  const message = empty ? 'Write an answer first.' : error

  const send = (publish: boolean) => {
    if (pending) return
    const answer = text.trim()
    if (answer) onSubmit(answer, publish)
    else setEmpty(true)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(true)
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" aria-label={`Answer to ${question.name}`}>
      <Label htmlFor={`${id}-answer`}>Your answer</Label>
      <Textarea
        id={`${id}-answer`}
        autoFocus
        rows={4}
        maxLength={ANSWER_MAX}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setEmpty(false)
        }}
        aria-invalid={message ? true : undefined}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={message ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
        {message ??
          `${text.length}/${ANSWER_MAX} · ${published ? 'Changes show on the product page right away.' : `Shown under the question on the product page once published. ${question.name} gets an e-mail then.`}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />}
          {published ? 'Save answer' : 'Publish answer'}
        </Button>
        {!published && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => send(false)}>
            Save without publishing
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

type CardProps = {
  question: ProductQuestion
  timeZone: string | undefined
  canModerate: boolean
  busy: boolean
  answering: boolean
  answerError?: string
  /** Offer "Only this product" (no product filter yet). */
  canFilterProduct: boolean
  onStartAnswer: () => void
  onCancelAnswer: () => void
  onAnswer: (answer: string, publish: boolean) => void
  onPublish: () => void
  onReject: () => void
  onDelete: () => void
  onOnlyProduct: () => void
}

function QuestionCard({ question: q, timeZone, canModerate, busy, answering, answerError, canFilterProduct, onStartAnswer, onCancelAnswer, onAnswer, onPublish, onReject, onDelete, onOnlyProduct }: CardProps) {
  const badge = questionStatusBadge(q)
  const bangla = askedInBangla(q)

  return (
    <li className="flex flex-col gap-3 rounded-md border p-4" aria-label={`Question about ${q.product.name} from ${q.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium wrap-break-word">{q.product.name}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {q.product.slug && (
              <a href={`/product/${q.product.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
                View in store <ExternalLinkIcon className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
            {canFilterProduct && (
              <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" aria-label={`Show only questions about ${q.product.name}`} onClick={onOnlyProduct}>
                Only this product
              </button>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm whitespace-nowrap text-muted-foreground">{formatDateTime(q.created_at, timeZone)}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground wrap-break-word">
          <span>
            {q.name} · <a className="underline" href={`mailto:${q.email}`}>{q.email}</a>
          </span>
          {bangla && (
            <Badge variant="outline" title="Asked on the Bangla store">
              Asked in <span lang="bn">বাংলা</span>
            </Badge>
          )}
        </p>
        <p className="wrap-break-word whitespace-pre-line" lang={bangla ? 'bn' : undefined} data-testid="question-text">{q.question}</p>
      </div>

      {q.answer && !answering && (
        <div className="rounded-md border-l-4 border-primary/50 bg-muted/40 p-3" data-testid="question-answer">
          <p className="text-xs font-medium text-muted-foreground">{q.status === 'published' ? 'Answer on the product page' : 'Saved answer — not shown in the store'}</p>
          <p className="mt-1 text-sm wrap-break-word whitespace-pre-line">{q.answer}</p>
          {q.answered_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Answered{q.answered_by_name && ` by ${q.answered_by_name}`} · {formatDateTime(q.answered_at, timeZone)}
            </p>
          )}
        </div>
      )}

      {answering && <AnswerForm question={q} pending={busy} error={answerError} onSubmit={onAnswer} onCancel={onCancelAnswer} />}

      {canModerate && !answering && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Question actions">
          {q.status !== 'published' && q.answer && (
            <Button size="sm" disabled={busy} onClick={onPublish}>
              <CheckIcon data-icon="inline-start" /> Publish answer
            </Button>
          )}
          <Button size="sm" variant={q.answer ? 'outline' : 'default'} disabled={busy} onClick={onStartAnswer}>
            {q.answer ? <PencilIcon data-icon="inline-start" /> : <MessageSquareReplyIcon data-icon="inline-start" />}
            {q.answer ? 'Edit answer' : 'Answer'}
          </Button>
          {q.status !== 'rejected' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              {q.status === 'published' ? <EyeOffIcon data-icon="inline-start" /> : <XIcon data-icon="inline-start" />}
              {q.status === 'published' ? 'Unpublish' : 'Reject'}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
            <Trash2Icon data-icon="inline-start" /> Delete
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * Shoppers' questions about products (P1b): waiting ones first. Moderators answer and publish
 * (the answer shows under the question on the product page), reject or delete; reviews.view alone
 * reads them.
 */
export function QuestionsPage() {
  const me = useAuth()
  const can = useCan()
  const canModerate = can('reviews.moderate')
  const timeZone = me.organization?.timezone
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = questionFiltersFromSearchParams(searchParams)
  // The box is local so typing stays smooth; the address follows the debounced term.
  const [search, setSearch] = useState(filters.search)
  const term = useDebouncedValue(search.trim(), 300)
  const params = questionListParams(filters, term)
  const questions = useQuestionsQuery(params)
  const answer = useAnswerQuestionMutation()
  const moderate = useModerateQuestionMutation()
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [answerError, setAnswerError] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<ProductQuestion | null>(null)
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const busy = answer.isPending || moderate.isPending

  const update = (patch: Partial<QuestionFilters>) =>
    setSearchParams(questionFiltersToSearchParams({ ...filters, search: search.trim(), page: 1, ...patch }), { replace: true })

  const urlSearch = filters.search
  useEffect(() => {
    if (term === urlSearch) return
    setSearchParams(
      (current) => questionFiltersToSearchParams({ ...questionFiltersFromSearchParams(current), search: term, page: 1 }),
      { replace: true },
    )
  }, [term, urlSearch, setSearchParams])

  const rows = questions.data?.items ?? []
  const pendingCount = questions.data?.pendingCount ?? null
  const productName = filters.product ? (picked?.id === filters.product ? picked.name : (rows.find((q) => q.product.id === filters.product)?.product.name ?? null)) : null
  const filtered = !!(term || filters.product)

  const sendAnswer = (q: ProductQuestion, text: string, publish: boolean, fromForm: boolean) => {
    setAnswerError(undefined)
    answer.mutate(
      { id: q.id, answer: text, publish },
      {
        onSuccess: () => {
          toast.success(!publish ? 'Answer saved. It is not shown in the store until you publish it.' : q.status === 'published' ? 'Answer updated on the product page.' : 'Answer published. It is now shown on the product page.')
          setAnsweringId(null)
        },
        onError: (error) => {
          if (fromForm && error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            const errors = fieldErrorMap(error)
            setAnswerError(errors.answer ?? errors.form ?? error.message)
            return
          }
          toast.error(errorMessage(error))
          if (error instanceof ApiError && error.status === 404) setAnsweringId(null)
        },
      },
    )
  }

  const run = (input: QuestionModeration, question: ProductQuestion, onDone?: () => void) =>
    moderate.mutate(input, {
      onSuccess: () => {
        toast.success(input.action === 'delete' ? 'Question deleted.' : question.status === 'published' ? 'Question unpublished. It is no longer shown in the store.' : 'Question rejected. It is not shown in the store.')
        onDone?.()
      },
      onError: (error) => {
        toast.error(errorMessage(error))
        onDone?.()
      },
    })

  return (
    <div className="flex flex-col gap-6">
      <ReviewsHeader title="Questions" description="Shoppers’ questions from your product pages. Answer and publish them so every shopper sees the answer under the question." />
      {!canModerate && <p className="-mt-3 text-sm text-muted-foreground" data-testid="questions-read-only">You can read questions; answering, rejecting and deleting them needs moderation rights.</p>}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={filters.tab} onValueChange={(v) => update({ tab: v as QuestionTab })}>
              <TabsList aria-label="Question status">
                {QUESTION_TABS.map((t) => {
                  const count = t === 'pending' && pendingCount !== null && pendingCount > 0 ? pendingCount : null
                  return (
                    <TabsTrigger key={t} value={t} aria-label={count ? `${QUESTION_TAB_LABELS[t]} (${count} waiting)` : undefined}>
                      {QUESTION_TAB_LABELS[t]}
                      {count && (
                        <Badge variant="warning" className="ml-1" data-testid="pending-count">
                          {count}
                        </Badge>
                      )}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
            <ProductFilter
              value={filters.product}
              name={productName}
              canSearch={can('products.view')}
              onChange={(product) => {
                setPicked(product)
                update({ product: product?.id ?? null })
              }}
            />
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Question, name, e-mail or product" aria-label="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {questions.isPending ? (
            <LoadingState label="Loading questions" />
          ) : questions.error ? (
            <ErrorState error={questions.error} onRetry={() => questions.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? 'No matching questions' : EMPTY_QUESTION_TITLES[filters.tab]}
              description={filtered ? undefined : 'Shoppers ask about a product on its page in your store. New questions show up here and in your notifications.'}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3" aria-label="Questions">
                {rows.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    timeZone={timeZone}
                    canModerate={canModerate}
                    busy={busy}
                    answering={answeringId === q.id}
                    answerError={answeringId === q.id ? answerError : undefined}
                    canFilterProduct={!filters.product}
                    onStartAnswer={() => {
                      setAnswerError(undefined)
                      setAnsweringId(q.id)
                    }}
                    onCancelAnswer={() => setAnsweringId(null)}
                    onAnswer={(text, publish) => sendAnswer(q, text, publish, true)}
                    onPublish={() => q.answer && sendAnswer(q, q.answer, true, false)}
                    onReject={() => run({ id: q.id, action: 'reject' }, q)}
                    onDelete={() => setDeleting(q)}
                    onOnlyProduct={() => {
                      setPicked({ id: q.product.id, name: q.product.name })
                      update({ product: q.product.id })
                    }}
                  />
                ))}
              </ul>
              {questions.data && <PaginationBar pagination={questions.data.pagination} onPageChange={(page) => update({ page })} />}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !moderate.isPending) setDeleting(null)
        }}
        title="Delete this question?"
        description={deleting ? `${deleting.name}’s question about ${deleting.product.name} is removed for good, together with its answer.` : ''}
        confirmLabel="Delete question"
        pending={moderate.isPending}
        onConfirm={() => {
          if (deleting) run({ id: deleting.id, action: 'delete' }, deleting, () => setDeleting(null))
        }}
      />
    </div>
  )
}
