import { useEffect, useState, type ReactNode } from 'react'
import { LightbulbIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dropTargetOf } from '../media-upload'
import { findNode } from '../tree'
import { useEditor } from '../store'
import { useEaseUi, type EaseLang } from './ease-context'
import type { TipId } from './ease-store'
import { TIP_TEXT } from './tour-steps'

/*
 * B21 contextual tips: one-line hints the first time something happens — a picture is selected,
 * the page is empty, the publish dialog opens. Each is shown once (remembered per person; "Reset
 * tips" in the More menu shows them again) and can be dismissed.
 */

/** A one-line tip: lightbulb, the words (Bangla line under English ones for Bangla stores), an optional action, dismiss. */
export function TipLine({ id, lang, bangla, onDismiss, action, className }: { id: TipId; lang: EaseLang; bangla: boolean; onDismiss: () => void; action?: ReactNode; className?: string }) {
  const text = TIP_TEXT[id]
  return (
    <div role="note" data-testid={`tip-${id}`} className={className ?? 'flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950'}>
      <LightbulbIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
      <p className="min-w-0 flex-1" lang={lang}>
        {text[lang]}
        {lang === 'en' && bangla && (
          <span lang="bn" className="block text-xs opacity-80">
            {text.bn}
          </span>
        )}
      </p>
      {action}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss tip" title="Dismiss tip" onClick={onDismiss} className="text-amber-950 hover:bg-amber-100">
        <XIcon />
      </Button>
    </div>
  )
}

/**
 * The tip strip under the canvas: "drag a picture onto it" the first time a picture is selected,
 * and "Build it for me" (the canvas's button on an empty home or campaign page) the first time
 * such a page is empty. A tip stays while its moment lasts (that picture selected, the page
 * empty) or until it is dismissed.
 */
export function CanvasTips() {
  const { available, tipSeen, seeTip, lang, bangla } = useEaseUi()
  // The empty-page tip where the canvas offers "Build it for me" (the home page and campaign pages).
  const empty = useEditor((s) => s.content.sections.length === 0 && s.document.kind === 'page' && (s.document.key === 'home' || s.document.key.startsWith('landing:')))
  const pictureId = useEditor((s) => {
    const node = findNode(s.content, s.selection)?.node
    return node && dropTargetOf(node) === 'image' ? node.id : null
  })
  const want: { id: TipId; key: string } | null = !available ? null : empty ? { id: 'empty', key: 'empty' } : pictureId ? { id: 'picture', key: pictureId } : null
  const [active, setActive] = useState<{ id: TipId; key: string } | null>(null)
  if (active && active.key !== want?.key) setActive(null)
  else if (!active && want && !tipSeen(want.id)) setActive(want)
  // Shown once: remembered as soon as it appears.
  const activeId = active?.id ?? null
  useEffect(() => {
    if (activeId) seeTip(activeId)
  }, [activeId, seeTip])
  if (!active) return null
  return (
    <div className="shrink-0 border-t bg-background px-3 py-2" data-testid="canvas-tips">
      <TipLine id={active.id} lang={lang} bangla={bangla} onDismiss={() => setActive({ id: active.id, key: '' })} />
    </div>
  )
}

/** The publish dialog's tip, the first time it opens: Check page first (with a button that opens it). */
export function FirstPublishTip({ onShowCheck }: { onShowCheck?: () => void }) {
  const { available, tipSeen, seeTip, lang, bangla } = useEaseUi()
  const [shown, setShown] = useState(() => available && !tipSeen('publish'))
  useEffect(() => {
    if (shown) seeTip('publish')
  }, [shown, seeTip])
  if (!shown) return null
  return (
    <TipLine
      id="publish"
      lang={lang}
      bangla={bangla}
      onDismiss={() => setShown(false)}
      action={
        onShowCheck && (
          <Button type="button" variant="outline" size="sm" onClick={onShowCheck}>
            Check page
          </Button>
        )
      }
    />
  )
}
