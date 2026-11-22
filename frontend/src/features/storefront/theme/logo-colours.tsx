import { useId, useState } from 'react'
import { CheckIcon, ImageIcon, Loader2Icon, PaletteIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMediaLookup } from '@/features/media/api'
import { MediaPicker } from '@/features/media/components/media-picker'
import { useSaveThemeDraftMutation, useThemeDraftQuery } from '@/features/storefront/api'
import { contrastPairs, colorValues } from '@/features/storefront/theme-form'
import { contrastRatio, meetsAA } from '@/features/storefront/contrast'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { logoSwatches, proposeFromLogo, readLogoPixels, type LogoProposal } from './logo-palette'
import type { PaletteColors } from './theme-options'

/*
 * B21 "Get colours from my logo" (contract §6). The logo (the store's, or one chosen / uploaded
 * here) is read in the browser, two or three palettes are proposed with a small live preview
 * (heading, text, card, button, link), each passing WCAG AA, and "Use these colours" hands the
 * chosen palette over. `LogoColours` is controlled (the theme page puts the colours in its form
 * and saves the draft); `LogoColoursStep` saves them to the theme draft itself (the page wizard).
 * Nothing is published.
 */

export type LogoColoursProps = {
  /** The store's logo (theme `logo_media_id`); null = none yet (the owner can choose or upload one here). */
  logoMediaId: string | null
  /** The chosen palette; resolve false when it wasn't used (the button stays available). */
  onUse: (colors: PaletteColors) => Promise<boolean> | boolean | void
  disabled?: boolean
  /** Preview fonts (CSS font stacks) and button corner radius; absent = the page's. */
  headingFont?: string
  bodyFont?: string
  buttonRadius?: string
  /** What the use button says (default "Use these colours"). */
  useLabel?: string
  className?: string
}

type State = { status: 'idle' } | { status: 'reading' } | { status: 'error'; message: string } | { status: 'ready'; proposals: LogoProposal[]; from: string }

export function LogoColours({ logoMediaId, onUse, disabled = false, headingFont, bodyFont, buttonRadius = '0.5rem', useLabel = 'Use these colours', className }: LogoColoursProps) {
  const [picked, setPicked] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [state, setState] = useState<State>({ status: 'idle' })
  const [chosen, setChosen] = useState<LogoProposal['key'] | null>(null)
  const [using, setUsing] = useState(false)
  const mediaId = picked ?? logoMediaId
  const { byId, isPending } = useMediaLookup(mediaId ? [mediaId] : [])
  const logo = mediaId ? byId.get(mediaId) : undefined
  const groupName = useId()

  const read = async (url: string) => {
    setState({ status: 'reading' })
    setChosen(null)
    try {
      const proposals = proposeFromLogo(logoSwatches(await readLogoPixels(url)))
      if (proposals.length === 0) {
        setState({ status: 'error', message: 'Your logo is only black, white or see-through, so there are no colours to take. Pick a ready-made palette below instead.' })
        return
      }
      setState({ status: 'ready', proposals, from: url })
      setChosen(proposals[0]!.key)
    } catch {
      setState({ status: 'error', message: 'We couldn’t read the colours of this picture. Try another file (JPEG, PNG or WebP).' })
    }
  }

  const ready = state.status === 'ready' ? state : null
  const selected = ready?.proposals.find((p) => p.key === chosen) ?? null

  const use = async () => {
    if (!selected) return
    setUsing(true)
    try {
      await onUse(selected.colors)
    } finally {
      setUsing(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid="logo-colours">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white">
          {logo ? <img src={logo.url} alt="" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-5 text-muted-foreground" aria-hidden />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span className="font-medium">{logo ? (picked ? 'The picture you chose' : 'Your store’s logo') : mediaId && isPending ? 'Loading your logo…' : 'No logo yet'}</span>
          <span className="text-muted-foreground">We look at its colours here in your browser and suggest matching store colours. Nothing changes until you choose.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled || !logo || state.status === 'reading'} onClick={() => logo && read(logo.url)}>
            {state.status === 'reading' ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PaletteIcon data-icon="inline-start" />}
            Get colours from my logo
          </Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => setChoosing(true)}>
            {logo ? 'Use another picture' : 'Choose or upload a logo'}
          </Button>
        </div>
      </div>

      {state.status === 'error' && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.message}
        </p>
      )}

      {ready && (
        <fieldset className="flex flex-col gap-3" aria-describedby={`${groupName}-hint`}>
          <legend className="text-sm font-medium">Colours from your logo — pick one</legend>
          <p id={`${groupName}-hint`} className="text-sm text-muted-foreground">
            Every text colour passes the WCAG AA contrast check (4.5:1). You can still change any colour afterwards.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ready.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.key}
                proposal={proposal}
                name={groupName}
                checked={proposal.key === chosen}
                onChoose={() => setChosen(proposal.key)}
                headingFont={headingFont}
                bodyFont={bodyFont}
                buttonRadius={buttonRadius}
                disabled={disabled}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={disabled || !selected || using} onClick={use} data-testid="logo-colours-use">
              {using ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />}
              {useLabel}
            </Button>
            <span className="text-sm text-muted-foreground">They go into your theme draft — your store changes only when you publish.</span>
          </div>
        </fieldset>
      )}

      <MediaPicker
        open={choosing}
        onOpenChange={setChoosing}
        title="Choose your logo"
        selected={mediaId ? [mediaId] : []}
        onConfirm={(ids) => {
          setChoosing(false)
          const id = ids[0]
          if (!id) return
          setPicked(id)
          setState({ status: 'idle' })
          setChosen(null)
        }}
      />
    </div>
  )
}

/** One proposal: a radio card whose face is the live mini preview (page, card, heading, text, link, button). */
function ProposalCard({ proposal, name, checked, onChoose, headingFont, bodyFont, buttonRadius, disabled }: {
  proposal: LogoProposal
  name: string
  checked: boolean
  onChoose: () => void
  headingFont?: string
  bodyFont?: string
  buttonRadius: string
  disabled: boolean
}) {
  const c = proposal.colors
  const passes = contrastPairs({ colors: colorValues(c) }).every((pair) => meetsAA(contrastRatio(pair.foreground, pair.background)))
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-2.5 text-sm transition has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50',
        checked && 'border-primary ring-2 ring-primary/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      data-testid={`logo-proposal-${proposal.key}`}
    >
      <span className="flex items-center gap-2">
        <input type="radio" name={name} value={proposal.key} checked={checked} onChange={onChoose} disabled={disabled} className="size-4 accent-primary" />
        <span className="font-medium">{proposal.name}</span>
        {checked && <CheckIcon className="ml-auto size-4 text-primary" aria-hidden />}
      </span>
      <span className="text-xs text-muted-foreground">{proposal.description}</span>
      <span aria-hidden className="flex flex-col gap-2 rounded-md border p-3" style={{ background: c.canvas, borderColor: c.border, fontFamily: bodyFont }}>
        <span className="text-base leading-tight font-semibold" style={{ color: c.heading, fontFamily: headingFont }}>
          New this week
        </span>
        <span className="flex flex-col gap-1.5 rounded-md border p-2" style={{ background: c.surface, borderColor: c.border }}>
          <span className="text-xs" style={{ color: c.text }}>
            Fresh picks, packed with care.
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="px-2.5 py-1 text-xs font-semibold" style={{ background: c.button, color: c.button_foreground, borderRadius: buttonRadius }}>
              Add to cart
            </span>
            <span className="text-xs underline" style={{ color: c.link }}>
              See all
            </span>
          </span>
        </span>
        <span className="flex h-3 overflow-hidden rounded-sm">
          {(['primary', 'accent', 'heading', 'text', 'border'] as const).map((role) => (
            <span key={role} className="flex-1" style={{ background: c[role] }} />
          ))}
        </span>
      </span>
      {passes && <span className="text-xs text-emerald-700 dark:text-emerald-400">Easy to read (WCAG AA)</span>}
    </label>
  )
}

/**
 * The same, saving the chosen colours straight to the theme draft (for the "Build it for me"
 * wizard's optional last step). `onDone` runs after a successful save.
 */
export function LogoColoursStep({ onDone, className }: { onDone?: (colors: PaletteColors) => void; className?: string }) {
  const draft = useThemeDraftQuery()
  const save = useSaveThemeDraftMutation()
  if (draft.isPending) return <p className="text-sm text-muted-foreground">Loading your theme…</p>
  if (draft.error || !draft.data) return <p className="text-sm text-muted-foreground">Your theme couldn’t be loaded, so colours can’t be taken from your logo now. You can do it later under Online store → Theme.</p>
  const { settings, draft_revision: revision } = draft.data
  return (
    <LogoColours
      className={className}
      logoMediaId={settings.logo_media_id}
      onUse={async (colors) => {
        try {
          await save.mutateAsync({ revision, settings: { ...settings, colors: { ...settings.colors, ...colors, button_hover: null } } })
          toast.success('Your logo’s colours are in your theme draft. Publish the theme to show them on your store.')
          onDone?.(colors)
          return true
        } catch (error) {
          toast.error(error instanceof ApiError && error.status === 409 ? 'The theme was changed somewhere else. Open Online store → Theme to use your logo’s colours there.' : 'The colours couldn’t be saved. Try again.')
          return false
        }
      }}
    />
  )
}
