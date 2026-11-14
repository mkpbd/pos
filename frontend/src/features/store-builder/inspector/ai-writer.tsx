/*
 * B9 AI writer (contract §2): "Write with AI" for an element with text, "Write this section" for a
 * section, and "Translate to Bangla" for both. The AI's texts are shown next to the current ones
 * to review (each can be left out) and applied with one change of the node: one undo step. When AI
 * is off for the organization the reason is shown instead of the buttons.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LanguagesIcon, Loader2Icon, RotateCwIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { authKeys } from '@/features/auth/api'
import type { CurrentUser } from '@/features/auth/types'
import { cn } from '@/lib/utils'
import { Segmented } from '../controls'
import { aiOffReason, describeWriteError, writeWithAi, type AiWriteError, type AiWriteInput } from './ai-writer-api'
import {
  applyProposals,
  currentTexts,
  displayText,
  entriesFor,
  INSTRUCTION_MAX,
  nodeIn,
  proposals,
  SECTION_FIELD_LIMIT,
  sectionTextEntries,
  TONES,
  type AiLanguage,
  type AiTone,
  type Proposal,
  type TextEntry,
} from './ai-writer-model'
import type { BuilderNode, InspectorChangeOptions } from './types'

type Kind = 'write' | 'translate'

type Props = {
  node: BuilderNode
  documentId: string
  /** Bangla is one of the store's languages (adds Bangla writing and "Translate to Bangla"). */
  bangla: boolean
  onChange: (next: BuilderNode, opts?: InspectorChangeOptions) => void
  /** The element label for the review list of a section ("Heading", "Button", …). */
  labelOf?: (type: string) => string
}

/** Whether AI is switched on (session flag; unknown counts as on: the server decides). */
function useAiSwitch(): boolean {
  const queryClient = useQueryClient()
  const me = queryClient.getQueryData<CurrentUser | null>(authKeys.me)
  const flag = me?.ai_enabled ?? me?.organization?.ai_enabled
  return flag !== false
}

/** The buttons above the Content tab's fields. */
export function AiWriterBar({ node, documentId, bangla, onChange, labelOf }: Props) {
  const on = useAiSwitch()
  const [open, setOpen] = useState<Kind | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const section = node.type === 'section'
  const entries = entriesFor(node)
  if (entries.length === 0) return null
  const hasText = entries.some((e) => e.value.trim() !== '')

  if (!on) {
    return (
      <div className="mb-4 flex gap-2 rounded-md border border-dashed p-3 text-sm" data-testid="ai-writer-off">
        <SparklesIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Write with AI is off.</span> {aiOffReason('disabled')}
        </p>
      </div>
    )
  }

  return (
    <div className="mb-4 flex flex-col gap-2" data-testid="ai-writer-bar">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => { setDone(null); setOpen('write') }}>
          <SparklesIcon data-icon="inline-start" /> {section ? 'Write this section' : 'Write with AI'}
        </Button>
        {bangla && (
          <Button type="button" variant="outline" size="sm" disabled={!hasText} title={hasText ? undefined : 'Write the English text first.'} onClick={() => { setDone(null); setOpen('translate') }}>
            <LanguagesIcon data-icon="inline-start" /> Translate to Bangla
          </Button>
        )}
      </div>
      <p role="status" className={cn('text-xs text-muted-foreground', !done && 'sr-only')}>{done ?? ''}</p>
      {open && (
        <AiWriterDialog
          kind={open}
          node={node}
          documentId={documentId}
          bangla={bangla}
          labelOf={labelOf}
          onClose={() => setOpen(null)}
          onApply={(next, count, target) => {
            onChange(next)
            setOpen(null)
            setDone(`${count === 1 ? '1 text' : `${count} texts`} ${target === 'bn' ? 'added in Bangla' : 'updated'}. Undo (Ctrl+Z) brings the old ${count === 1 ? 'text' : 'texts'} back.`)
          }}
        />
      )}
    </div>
  )
}

type Phase =
  | { step: 'ask' }
  | { step: 'working' }
  | { step: 'review'; items: Proposal[]; target: 'base' | 'bn' }
  | { step: 'error'; error: AiWriteError }

function AiWriterDialog({ kind, node, documentId, bangla, labelOf, onClose, onApply }: {
  kind: Kind
  node: BuilderNode
  documentId: string
  bangla: boolean
  labelOf?: (type: string) => string
  onClose: () => void
  onApply: (next: BuilderNode, count: number, target: 'base' | 'bn') => void
}) {
  const ids = useId()
  const section = node.type === 'section'
  const scope = section ? 'section' : 'element'
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState<AiLanguage>('en')
  const [tone, setTone] = useState<AiTone>('friendly')
  const [phase, setPhase] = useState<Phase>(kind === 'translate' ? { step: 'working' } : { step: 'ask' })
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const abort = useRef<AbortController | null>(null)
  const total = section ? sectionTextEntries(node).length : entriesFor(node).length

  /** Sends the request; state changes only when the answer arrives. */
  const request = async (lang: AiLanguage) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const all = entriesFor(node)
    const entries: TextEntry[] = kind === 'translate' ? all.filter((e) => e.value.trim() !== '') : all
    const input: AiWriteInput = {
      mode: kind === 'translate' ? 'translate' : section ? 'section' : 'element',
      document_id: documentId,
      node_id: node.id,
      ...(section ? {} : { type: node.type }),
      instruction: kind === 'translate' ? '' : instruction.trim(),
      language: kind === 'translate' ? 'bn' : lang,
      tone,
      current: section ? currentTexts(entries, 'section') : currentTexts(entries, 'element'),
    }
    try {
      const answer = await writeWithAi(input, controller.signal)
      if (controller.signal.aborted) return
      const target = answer.target === 'translations.bn' ? 'bn' : 'base'
      setSkipped(new Set())
      setPhase({ step: 'review', items: proposals(entries, answer, scope, target, (id) => nodeIn(node, id)), target })
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({ step: 'error', error: describeWriteError(error) })
    }
  }

  const run = (lang: AiLanguage) => {
    setPhase({ step: 'working' })
    void request(lang)
  }

  // Translating needs no questions: it starts when the dialog opens (and stops when it closes).
  useEffect(() => {
    if (kind === 'translate') void request('bn')
    return () => abort.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per dialog
  }, [])

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const title = kind === 'translate' ? 'Translate to Bangla' : section ? 'Write this section with AI' : 'Write with AI'
  const description =
    kind === 'translate'
      ? 'The AI writes Bangla versions of the English texts. Check them before you use them.'
      : section
        ? 'Say what the section is about. The AI writes its headings, texts and buttons; you check them before anything changes.'
        : 'Say what it should say. The AI writes the text; you check it before anything changes.'

  const chosen = phase.step === 'review' ? phase.items.filter((p) => !skipped.has(`${p.entry.nodeId}.${p.entry.key}`)) : []

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl" data-testid="ai-writer-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" aria-hidden /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {phase.step === 'ask' && (
          <form
            id={`${ids}-form`}
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(language)
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-instruction`}>What should it say?</Label>
              <Textarea
                id={`${ids}-instruction`}
                rows={3}
                maxLength={INSTRUCTION_MAX}
                value={instruction}
                placeholder={section ? 'e.g. Our Eid collection of cotton panjabis, 20% off until Friday, free delivery in Dhaka' : 'e.g. Invite shoppers to see the new winter shawls'}
                aria-describedby={`${ids}-instruction-hint`}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <p id={`${ids}-instruction-hint`} className="text-xs text-muted-foreground">
                Optional. Your shop’s name and the products shown here are added for you; no customer details are sent. {instruction.length}/{INSTRUCTION_MAX}
              </p>
            </div>
            {bangla && (
              <Segmented
                label="Language"
                tooltip="Bangla texts go into the Bangla fields; the English texts stay as they are."
                value={language}
                options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা', title: 'Bangla' }]}
                onChange={setLanguage}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <Segmented label="Tone" value={tone} options={TONES.map((t) => ({ value: t.value, label: t.label }))} onChange={setTone} />
              <p className="text-xs text-muted-foreground">{TONES.find((t) => t.value === tone)?.hint}</p>
            </div>
            {section && total > SECTION_FIELD_LIMIT && (
              <p className="text-xs text-muted-foreground">This section has {total} texts; the AI writes the first {SECTION_FIELD_LIMIT}.</p>
            )}
          </form>
        )}

        {phase.step === 'working' && (
          <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="ai-writer-working">
            <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {kind === 'translate' ? 'Translating…' : 'Writing…'} This takes a few seconds.
          </p>
        )}

        {phase.step === 'error' && (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="ai-writer-error">
            <p className="font-medium">{phase.error.title}</p>
            <p>{phase.error.message}</p>
          </div>
        )}

        {phase.step === 'review' && (
          phase.items.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">The AI didn’t send back any text to use. Try again, perhaps with different words.</p>
          ) : (
            <div className="flex flex-col gap-2" data-testid="ai-writer-review">
              <p role="status" className="text-sm">
                {phase.target === 'bn' ? 'Bangla texts' : 'New texts'} for {phase.items.length === 1 ? '1 field' : `${phase.items.length} fields`}. Untick any you don’t want.
              </p>
              <ul className="flex flex-col gap-2">
                {phase.items.map((p) => {
                  const key = `${p.entry.nodeId}.${p.entry.key}`
                  const checkId = `${ids}-${key}`
                  const on = !skipped.has(key)
                  const where = section ? `${labelOf?.(p.entry.nodeType) ?? p.entry.nodeType} · ${p.entry.label}` : p.entry.label
                  return (
                    <li key={key} className={cn('flex gap-3 rounded-md border p-3', !on && 'opacity-60')}>
                      <Checkbox
                        id={checkId}
                        checked={on}
                        className="mt-0.5"
                        onCheckedChange={(checked) =>
                          setSkipped((s) => {
                            const next = new Set(s)
                            if (checked === true) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Label htmlFor={checkId} className="text-xs font-medium text-muted-foreground">{where}</Label>
                        <p className="text-sm break-words" lang={phase.target === 'bn' ? 'bn' : undefined} data-testid="ai-writer-new">
                          {displayText(p.entry, p.after)}
                        </p>
                        {p.before.trim() !== '' && (
                          <p className="text-xs break-words text-muted-foreground">
                            <span className="font-medium">Now:</span> <span lang={phase.target === 'bn' ? 'bn' : undefined}>{displayText(p.entry, p.before)}</span>
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          {phase.step === 'ask' && (
            <Button type="submit" form={`${ids}-form`}>
              <SparklesIcon data-icon="inline-start" /> Write
            </Button>
          )}
          {(phase.step === 'review' || (phase.step === 'error' && !phase.error.off)) && (
            <Button type="button" variant="outline" onClick={() => (kind === 'translate' ? run('bn') : setPhase({ step: 'ask' }))}>
              <RotateCwIcon data-icon="inline-start" /> {phase.step === 'error' ? 'Try again' : kind === 'translate' ? 'Translate again' : 'Write again'}
            </Button>
          )}
          {phase.step === 'review' && phase.items.length > 0 && (
            <Button type="button" disabled={chosen.length === 0} onClick={() => onApply(applyProposals(node, chosen, phase.target), chosen.length, phase.target)}>
              Use {chosen.length === 1 ? 'this text' : 'these texts'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
