import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { InfoIcon, XIcon } from 'lucide-react'
import { useLocale } from '../i18n/locale'
import { NoticeContext } from '../notices'

type Notice = { id: number; message: string }

const DISMISS_AFTER_MS = 10_000

/** Short messages for the shopper at the bottom of the screen, announced politely; dismissible, gone after 10 s. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setNotices((list) => list.filter((n) => n.id !== id)), [])
  const notify = useCallback((message: string) => {
    nextId.current += 1
    const id = nextId.current
    setNotices((list) => [...list.filter((n) => n.message !== message), { id, message }].slice(-3))
  }, [])

  return (
    <NoticeContext value={notify}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4" data-testid="notices">
        {notices.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} onDismiss={dismiss} />
        ))}
      </div>
    </NoticeContext>
  )
}

function NoticeItem({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const { t } = useLocale()
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notice.id), DISMISS_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [notice.id, onDismiss])

  return (
    <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-sf-card bg-sf-heading px-4 py-3 text-sm text-white shadow-lg">
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1">{notice.message}</p>
      <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-white/20" aria-label={t('common.dismiss')} onClick={() => onDismiss(notice.id)}>
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  )
}
