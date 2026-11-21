import { useId, useState } from 'react'
import { CheckIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useEditorUi } from '../commands'
import { applyMotionTheme, MOTION_THEME_IDS, MOTION_THEME_INFO, movingCount, type MotionThemeChoice } from '../motion-themes'
import { useEditor, useEditorStoreApi } from '../store'

/*
 * B18 §4 Motion themes (toolbar "Motion", Ctrl/Cmd+K "Apply motion theme"): pick Calm, Lively,
 * Festive, Premium, Minimal or Remove all motion; "Keep my own animations" (on by default) leaves
 * parts that already move alone. Applied as one undo step; the canvas then plays the page.
 * The small previews only move for people who allow motion on their device.
 */

const CHOICES: readonly MotionThemeChoice[] = [...MOTION_THEME_IDS, 'none']

/** Tiny looping previews (three blocks) per theme; still under reduced motion. */
const PREVIEW_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .b18-preview i { animation: var(--b18-anim) 2.4s var(--b18-ease) infinite both; }
  .b18-preview i:nth-child(2) { animation-delay: .15s; }
  .b18-preview i:nth-child(3) { animation-delay: .3s; }
}
@keyframes b18-fade { 0%, 15% { opacity: 0 } 45%, 100% { opacity: 1 } }
@keyframes b18-up { 0%, 15% { opacity: 0; transform: translateY(8px) } 45%, 100% { opacity: 1; transform: none } }
@keyframes b18-bounce { 0%, 10% { opacity: 0; transform: scale(.6) } 30% { opacity: 1; transform: scale(1.1) } 40%, 100% { transform: none } }
@keyframes b18-wipe { 0%, 15% { clip-path: inset(100% 0 0 0) } 50%, 100% { clip-path: inset(0 0 0 0) } }
`

const PREVIEW: Record<MotionThemeChoice, { anim: string; ease: string }> = {
  calm: { anim: 'b18-fade', ease: 'ease-out' },
  lively: { anim: 'b18-up', ease: 'cubic-bezier(.34,1.56,.64,1)' },
  festive: { anim: 'b18-bounce', ease: 'ease-out' },
  premium: { anim: 'b18-wipe', ease: 'cubic-bezier(.22,1,.36,1)' },
  minimal: { anim: 'b18-fade', ease: 'linear' },
  none: { anim: 'none', ease: 'linear' },
}

/** Lets the canvas draw the new content before it plays the page. */
const PLAY_AFTER_MS = 300

export function MotionThemesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <ThemesForm onDone={() => onOpenChange(false)} />}</Dialog>
}

function ThemesForm({ onDone }: { onDone: () => void }) {
  const store = useEditorStoreApi()
  const { canvas } = useEditorUi()
  const current = useEditor((s) => s.content.motion_theme ?? null)
  const moving = useEditor((s) => movingCount(s.content))
  const readOnly = useEditor((s) => s.readOnly)
  const [choice, setChoice] = useState<MotionThemeChoice>(current ?? 'calm')
  const [keepOwn, setKeepOwn] = useState(true)
  const keepId = useId()
  const removing = choice === 'none'

  const apply = () => {
    const state = store.getState()
    const result = applyMotionTheme(state.content, choice, { keepOwn })
    if (result.content === state.content || !state.apply(() => result.content)) {
      toast.info(removing ? 'Nothing on this page moves.' : `The page already has the ${MOTION_THEME_INFO[choice].name} motion.`)
      return onDone()
    }
    const kept = result.kept > 0 ? ` ${result.kept} ${result.kept === 1 ? 'part keeps its' : 'parts keep their'} own animation.` : ''
    toast.success(removing ? 'All motion removed. Undo puts it back.' : `${MOTION_THEME_INFO[choice].name} motion applied.${kept} Undo puts it back.`)
    onDone()
    if (removing) return
    const first = store.getState().content.sections.find((section) => section.type === 'section')
    if (!first) return
    window.setTimeout(() => {
      canvas.current?.scrollTo(first.id)
      canvas.current?.playMotion(first.id, 'page')
    }, PLAY_AFTER_MS)
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="motion-themes">
      <style>{PREVIEW_CSS}</style>
      <DialogHeader>
        <DialogTitle>Motion for this page</DialogTitle>
        <DialogDescription>
          Pick a style and every section, heading, picture, button and product list gets matching animation. The top of the page always shows at once, so your store stays fast. Shoppers who turned off animations see everything still.
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-label="Motion style" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CHOICES.map((id) => {
          const info = MOTION_THEME_INFO[id]
          const preview = PREVIEW[id]
          const checked = choice === id
          return (
            <label
              key={id}
              data-testid={`motion-theme-${id}`}
              className={cn(
                'relative flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
                checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/60',
                id === 'none' && 'border-dashed',
              )}
            >
              <input type="radio" name="motion-theme" value={id} checked={checked} onChange={() => setChoice(id)} className="sr-only" />
              <span aria-hidden className="b18-preview flex h-10 items-end gap-1 rounded bg-muted p-1.5" style={{ ['--b18-anim' as string]: preview.anim, ['--b18-ease' as string]: preview.ease }}>
                {id === 'none' ? (
                  <span className="m-auto text-xs text-muted-foreground">No movement</span>
                ) : (
                  <>
                    <i className="block h-3 w-1/3 rounded-sm bg-primary/70" />
                    <i className="block h-5 w-1/4 rounded-sm bg-primary/50" />
                    <i className="block h-2 w-1/4 rounded-sm bg-primary/40" />
                  </>
                )}
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                {info.name}
                {current === id && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-normal text-muted-foreground" data-testid="motion-theme-current">
                    In use
                  </span>
                )}
                {checked && <CheckIcon className="ml-auto size-4 text-primary" aria-hidden />}
              </span>
              <span className="text-xs text-muted-foreground">{info.description}</span>
            </label>
          )
        })}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Switch id={keepId} checked={removing ? false : keepOwn} disabled={removing} onCheckedChange={setKeepOwn} aria-describedby={`${keepId}-hint`} data-testid="keep-own-motion" />
          <label htmlFor={keepId} className={cn('text-sm', removing && 'text-muted-foreground')}>
            Keep my own animations
          </label>
        </div>
        <p id={`${keepId}-hint`} className="text-xs text-muted-foreground">
          {removing
            ? 'Remove all motion takes off every animation, also the ones you set yourself.'
            : 'On: parts you animated yourself stay as they are. Off: the style replaces every animation on the page.'}{' '}
          {moving > 0 ? `${moving} ${moving === 1 ? 'part moves' : 'parts move'} now.` : 'Nothing moves yet.'}
        </p>
      </div>
      <DialogFooter>
        {readOnly && <p className="mr-auto self-center text-xs text-muted-foreground">Someone else is editing this page.</p>}
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" variant={removing ? 'destructive' : 'default'} disabled={readOnly} onClick={apply} data-testid="apply-motion-theme">
          {!removing && <SparklesIcon data-icon="inline-start" />}
          {removing ? 'Remove all motion' : `Apply ${MOTION_THEME_INFO[choice].name}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
