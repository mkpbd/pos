import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { BotMessageSquareIcon } from 'lucide-react'
import { useStorefront } from '../api'
import { useLocale } from '../i18n/locale'
import type { StoreAssistantBootstrap } from '../types'
import { ASSISTANT_ATTRIBUTE, assistantEnabled } from './visibility'

/** The panel (messages, input, product cards, hand-off) is its own chunk: fetched on the first hover, focus or tap. */
const loadPanel = () => import('./assistant-panel')
const AssistantPanel = lazy(loadPanel)

/**
 * AI2b: the floating "ask the shop assistant" button, on every store page when the store's assistant is
 * on (bootstrap `assistant.enabled`), never in previews or the builder canvas (the canvas does not use the
 * store layout). Bottom corner; above the WhatsApp chat button when that shows (storefront.css).
 */
export function AssistantLauncher() {
  const bootstrap = useStorefront()
  const location = useLocation()
  const assistant = bootstrap.assistant
  if (!assistant || !assistantEnabled(bootstrap, location)) return null
  return <Launcher assistant={assistant} />
}

function Launcher({ assistant }: { assistant: StoreAssistantBootstrap }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  // The panel stays mounted once opened, so the chat survives closing it and moving between pages.
  const [mounted, setMounted] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute(ASSISTANT_ATTRIBUTE, '')
    return () => root.removeAttribute(ASSISTANT_ATTRIBUTE)
  }, [])

  const prefetch = () => void loadPanel().catch(() => {})
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        className="sf-assistant-launcher fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-sf-accent text-sf-accent-foreground shadow-lg ring-2 ring-white/80 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
        data-testid="assistant-launcher"
      >
        <BotMessageSquareIcon aria-hidden className="size-7" />
        <span className="sr-only">{t('assistant.launcher', { name: assistant.name })}</span>
      </button>
      {mounted && (
        <Suspense fallback={<span role="status" className="sr-only">{t('assistant.loading')}</span>}>
          <AssistantPanel assistant={assistant} open={open} onOpenChange={setOpen} returnFocus={button} />
        </Suspense>
      )}
    </>
  )
}
