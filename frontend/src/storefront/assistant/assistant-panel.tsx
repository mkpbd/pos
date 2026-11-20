import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useLocation } from 'react-router'
import { Dialog } from 'radix-ui'
import { BotMessageSquareIcon, SendHorizontalIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useStorefront } from '../api'
import { useMediaQuery } from '../components/use-media-query'
import type { MessageKey } from '../i18n/en'
import { useLocale } from '../i18n/locale'
import type { StoreAssistantBootstrap } from '../types'
import {
  fetchCurrentConversation,
  MAX_MESSAGE_LENGTH,
  pageContext,
  sendAssistantMessage,
  type AssistantHandoff,
  type AssistantLink,
  type AssistantProduct,
  type AssistantStatus,
} from './api'
import { replyHandoff, storeHandoff } from './handoff'
import { HandoffButton, ProductCards, ReplyLinks, SafeText } from './message-view'
import { plainText } from './safe-text'
import { readAssistantToken, writeAssistantToken } from './token-store'

/** From here (Tailwind `sm`) the chat is a side panel beside the page; below it a full-screen dialog. */
const SIDE_PANEL_QUERY = '(min-width: 40rem)'

/** Shown before the shopper's first question (delivery charge, payment methods, return rules). */
const SUGGESTIONS: MessageKey[] = ['assistant.suggestion.delivery', 'assistant.suggestion.payment', 'assistant.suggestion.returns']

type ChatMessage = {
  key: string
  role: 'user' | 'assistant'
  text: string
  products: AssistantProduct[]
  links: AssistantLink[]
  handoff: AssistantHandoff | null
  /** A server status; `error` = the widget's own fallback (network, throttle). */
  status: AssistantStatus | 'error' | null
}

let nextKey = 0
const messageKey = () => `m${++nextKey}`

const userMessage = (text: string): ChatMessage => ({ key: messageKey(), role: 'user', text, products: [], links: [], handoff: null, status: null })

type Props = {
  assistant: StoreAssistantBootstrap
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The chat button: focus goes back to it when the chat closes. */
  returnFocus: RefObject<HTMLElement | null>
}

/**
 * AI2b shopper assistant panel (lazy chunk): a side panel on wider screens (the page stays usable), a
 * full-screen dialog on phones. The conversation's token is kept in localStorage; reopening the store
 * restores the last 20 messages.
 */
export default function AssistantPanel({ assistant, open, onOpenChange, returnFocus }: Props) {
  const bootstrap = useStorefront()
  const { t, locale } = useLocale()
  const { pathname } = useLocation()
  const side = useMediaQuery(SIDE_PANEL_QUERY)

  const [token, setToken] = useState<string | null>(() => readAssistantToken())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(() => token !== null)
  const [pending, setPending] = useState(false)
  const [draft, setDraft] = useState('')
  const [announcement, setAnnouncement] = useState('')
  // "New chat" swaps the footer back to the input: focus moves there once it is rendered.
  const [focusRequest, setFocusRequest] = useState(0)

  const content = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const hintId = useId()
  const counterId = useId()

  // Reopening the store: the conversation this browser was having (unknown or someone else's → start afresh).
  const restoreToken = useRef(token)
  useEffect(() => {
    const stored = restoreToken.current
    if (!stored) return
    const controller = new AbortController()
    fetchCurrentConversation(stored, controller.signal).then(
      (current) => {
        if (!current.conversation_token) {
          writeAssistantToken(null)
          setToken(null)
        } else {
          setMessages((now) => [
            ...current.messages.map((message) => ({
              key: messageKey(),
              role: message.role,
              text: message.text,
              products: message.products ?? [],
              links: message.links ?? [],
              handoff: message.handoff ?? null,
              status: message.status ?? null,
            })),
            ...now,
          ])
          setRemaining(current.remaining_messages)
        }
        setRestoring(false)
      },
      () => {
        if (!controller.signal.aborted) setRestoring(false)
      },
    )
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus()
  }, [focusRequest])

  // The newest message in view (no smooth scrolling: nothing moves on its own).
  useLayoutEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, pending, open])

  const firstQuestion = messages.find((message) => message.role === 'user')?.text ?? null
  const fallbackHandoff = storeHandoff(bootstrap, t, firstQuestion)
  const full = remaining === 0
  const started = messages.length > 0
  const closeOnPhone = () => {
    if (!side) onOpenChange(false)
  }

  async function send(text: string) {
    const message = text.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!message || pending || full) return
    const question = userMessage(message)
    const sentWith = token
    setMessages((now) => [...now, question])
    setDraft('')
    setPending(true)
    try {
      const turn = await sendAssistantMessage({ conversation_token: sentWith ?? undefined, message, language: locale, page: pageContext(pathname) })
      const reply: ChatMessage = {
        key: messageKey(),
        role: 'assistant',
        text: turn.reply.text,
        products: turn.reply.products ?? [],
        links: turn.reply.links ?? [],
        handoff: turn.reply.handoff ?? null,
        status: turn.status,
      }
      // A different token: the server could not continue the old conversation and started a new one.
      const fresh = Boolean(sentWith && turn.conversation_token && turn.conversation_token !== sentWith)
      setMessages((now) => (fresh ? [question, reply] : [...now, reply]))
      if (turn.conversation_token) {
        setToken(turn.conversation_token)
        writeAssistantToken(turn.conversation_token)
      }
      setRemaining(turn.conversation_token ? turn.remaining_messages : remaining)
      setAnnouncement(plainText(turn.reply.text))
    } catch (error) {
      const key: MessageKey =
        error instanceof ApiError && error.status === 429 ? 'assistant.error.busy' : error instanceof ApiError && error.status === 422 ? 'assistant.error.invalid' : 'assistant.error.failed'
      const text = t(key, { max: MAX_MESSAGE_LENGTH })
      setMessages((now) => [...now, { key: messageKey(), role: 'assistant', text, products: [], links: [], handoff: null, status: 'error' }])
      setAnnouncement(text)
    } finally {
      setPending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void send(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line; an IME (Bangla keyboards) composing a word keeps Enter for itself.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send(draft)
  }

  function newChat() {
    writeAssistantToken(null)
    setToken(null)
    setMessages([])
    setRemaining(null)
    setDraft('')
    setAnnouncement('')
    setFocusRequest((n) => n + 1)
  }

  const greeting = assistant.greeting?.trim() || t('assistant.greeting')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!side}>
      <Dialog.Portal>
        <Dialog.Content
          ref={content}
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            // The side panel is ready to type in; on a phone the keyboard waits until the shopper taps the box.
            if (side && input.current && !input.current.disabled) input.current.focus()
            else content.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus.current?.focus()
          }}
          // The side panel stays open while the shopper uses the page beside it.
          onInteractOutside={(event) => {
            if (side) event.preventDefault()
          }}
          className={cn(
            'sf-assistant-panel fixed z-50 flex flex-col overflow-hidden bg-sf-surface text-sm text-sf-text shadow-2xl focus:outline-none',
            side ? 'right-4 bottom-4 h-[min(42rem,calc(100dvh-2rem))] w-[25rem] max-w-[calc(100vw-2rem)] rounded-sf-card border border-sf-border' : 'inset-0',
          )}
          data-testid="assistant-panel"
        >
          <header className="flex items-start gap-3 border-b border-sf-border px-4 py-3">
            <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-sf-accent text-sf-accent-foreground">
              <BotMessageSquareIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate font-heading text-base font-bold text-sf-heading">{assistant.name}</Dialog.Title>
              <p className="text-xs text-sf-text" data-testid="assistant-notice">
                {t('assistant.notice')}
              </p>
            </div>
            {started && (
              <button
                type="button"
                onClick={newChat}
                disabled={pending}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-sf-button px-2.5 text-xs font-semibold text-sf-heading hover:text-sf-accent focus-visible:outline-2 focus-visible:outline-sf-accent disabled:opacity-60"
              >
                <SquarePenIcon aria-hidden className="size-4" />
                {t('assistant.newChat')}
              </button>
            )}
            <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-full text-sf-heading hover:bg-sf-canvas focus-visible:outline-2 focus-visible:outline-sf-accent">
              <XIcon aria-hidden className="size-5" />
              <span className="sr-only">{t('assistant.close')}</span>
            </Dialog.Close>
          </header>

          <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain bg-sf-canvas px-4 py-4" data-testid="assistant-messages">
            <Bubble role="assistant">
              <p>{greeting}</p>
            </Bubble>

            {restoring ? (
              <p role="status" className="text-center text-xs text-sf-text">
                {t('assistant.loading')}
              </p>
            ) : (
              !started && (
                <div role="group" aria-label={t('assistant.suggestions')} className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void send(t(key))}
                      disabled={pending || full}
                      className="min-h-10 rounded-full border border-sf-accent bg-sf-surface px-3.5 py-2 text-start text-sm font-semibold text-sf-accent hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-60"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              )
            )}

            <ol aria-label={t('assistant.conversation', { name: assistant.name })} className="flex flex-col gap-3">
              {messages.map((message) => {
                const handoff = message.status === 'error' ? fallbackHandoff : replyHandoff(message.handoff, t, firstQuestion)
                return (
                  <li key={message.key} className={cn('flex flex-col gap-2', message.role === 'user' ? 'items-end' : 'items-start')} data-testid={`assistant-message-${message.role}`}>
                    <Bubble role={message.role} status={message.status}>
                      <span className="sr-only">{message.role === 'user' ? t('assistant.you') : t('assistant.said', { name: assistant.name })} </span>
                      {message.role === 'user' ? <p className="whitespace-pre-wrap">{message.text}</p> : <SafeText text={message.text} onNavigate={closeOnPhone} />}
                    </Bubble>
                    {message.role === 'assistant' && (
                      <>
                        <ProductCards products={message.products} onNavigate={closeOnPhone} />
                        <ReplyLinks links={message.links} onNavigate={closeOnPhone} />
                        {handoff && <HandoffButton target={handoff} onNavigate={closeOnPhone} testId="assistant-handoff" />}
                      </>
                    )}
                  </li>
                )
              })}
            </ol>

            {pending && (
              <div role="status" className="flex items-center gap-2 self-start rounded-2xl rounded-bl-sm bg-sf-surface px-4 py-3" data-testid="assistant-typing">
                <span aria-hidden className="flex gap-1">
                  {[0, 1, 2].map((dot) => (
                    <span key={dot} className="size-2 rounded-full bg-sf-text/60 motion-safe:animate-bounce" style={{ animationDelay: `${dot * 150}ms` }} />
                  ))}
                </span>
                <span className="sr-only">{t('assistant.typing', { name: assistant.name })}</span>
              </div>
            )}
          </div>

          {/* Replies are announced once, as plain text. */}
          <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="assistant-announcer">
            {announcement}
          </div>

          <footer className="flex flex-col gap-2 border-t border-sf-border bg-sf-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            {full ? (
              <div className="flex flex-col items-start gap-2" data-testid="assistant-full">
                <p className="font-semibold text-sf-heading">{t('assistant.limit')}</p>
                <button
                  type="button"
                  onClick={newChat}
                  className="inline-flex min-h-11 items-center gap-2 rounded-sf-button bg-sf-accent px-4 text-sm font-bold text-sf-accent-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
                >
                  <SquarePenIcon aria-hidden className="size-4" />
                  {t('assistant.newChat')}
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-1">
                <label htmlFor={`${hintId}-input`} className="sr-only">
                  {t('assistant.input.label')}
                </label>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={input}
                    id={`${hintId}-input`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                    onKeyDown={onKeyDown}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={2}
                    placeholder={t('assistant.input.placeholder')}
                    aria-describedby={`${hintId} ${counterId}`}
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-sf-card border border-sf-border bg-sf-surface px-3 py-2 text-base text-sf-heading placeholder:text-sf-text/70 focus-visible:border-sf-accent focus-visible:outline-2 focus-visible:outline-sf-accent sm:text-sm"
                  />
                  <button
                    type="submit"
                    disabled={pending || draft.trim() === ''}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-sf-accent text-sf-accent-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <SendHorizontalIcon aria-hidden className="size-5" />
                    <span className="sr-only">{t('assistant.send')}</span>
                  </button>
                </div>
                <div className="flex justify-between gap-3 text-xs text-sf-text">
                  <span id={hintId}>{t('assistant.input.hint')}</span>
                  <span id={counterId} className={cn('shrink-0 tabular-nums', draft.length >= MAX_MESSAGE_LENGTH && 'font-semibold text-sf-sale')}>
                    {t('assistant.input.counter', { count: draft.length, max: MAX_MESSAGE_LENGTH })}
                  </span>
                </div>
                {remaining !== null && remaining > 0 && remaining <= 5 && (
                  <p className="text-xs text-sf-text" data-testid="assistant-remaining">
                    {t('assistant.remaining', { count: remaining })}
                  </p>
                )}
              </form>
            )}
            {fallbackHandoff && (
              <HandoffButton target={fallbackHandoff} onNavigate={closeOnPhone} className="self-start border-none px-0 text-xs underline underline-offset-2 hover:no-underline" testId="assistant-talk-to-person" />
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Bubble({ role, status, children }: { role: 'user' | 'assistant'; status?: ChatMessage['status']; children: ReactNode }) {
  return (
    <div
      className={cn(
        'max-w-[88%] rounded-2xl px-4 py-2.5 leading-relaxed',
        role === 'user' ? 'rounded-br-sm bg-sf-accent text-sf-accent-foreground' : 'rounded-bl-sm bg-sf-surface text-sf-heading',
        role === 'assistant' && status && status !== 'ok' && 'border border-sf-border',
      )}
    >
      {children}
    </div>
  )
}
