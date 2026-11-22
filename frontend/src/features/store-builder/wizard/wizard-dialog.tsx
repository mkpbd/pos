import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  BookOpenIcon,
  ClipboardListIcon,
  HouseIcon,
  ImageIcon,
  LayoutGridIcon,
  Loader2Icon,
  PackageIcon,
  PaletteIcon,
  PartyPopperIcon,
  PercentIcon,
  PhoneCallIcon,
  PhoneIcon,
  RocketIcon,
  ShoppingCartIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useCurrentUserQuery } from '@/features/auth/api'
import { aiEnabledFor } from '@/features/ai/api'
import { useProductSearchQuery, useWebCategoriesQuery } from '@/features/online-catalog/api'
import { useFestivalsQuery } from '@/features/storefront/festivals/api'
import { LogoColoursStep } from '@/features/storefront/theme/logo-colours'
import { ApiError } from '@/lib/api/client'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { cn } from '@/lib/utils'
import { useScreenText } from '../pages/screen-language'
import {
  WIZARD_DEFAULT_GOALS,
  WIZARD_GOALS,
  WIZARD_LANGUAGES,
  WIZARD_LIMITS,
  WIZARD_LOOKS,
  WIZARD_PAGE_TYPES,
  useWizardMutation,
  type WizardGoal,
  type WizardInput,
  type WizardLanguage,
  type WizardLook,
  type WizardPageType,
  type WizardResult,
} from './wizard-api'
import { aiKey, goalKey, langKey, lookKey, typeKey, wizardWord, type WizardWordKey } from './wizard-words'

/*
 * B21 "Build it for me" (Editor A): four short steps — what page, what you sell, what it should
 * do, how it looks (+ language and AI texts when AI is on) — then the server builds a DRAFT and the
 * editor opens on it with a toast listing its sections. Radio cards are real radio buttons (arrow
 * keys move between them); each step's heading takes the focus; nothing is ever published.
 */

const TYPE_ICONS: Record<WizardPageType, LucideIcon> = { home: HouseIcon, sale: PercentIcon, product_launch: RocketIcon, about: BookOpenIcon, festival: PartyPopperIcon, contact: PhoneIcon }
const GOAL_ICONS: Record<WizardGoal, LucideIcon> = { orders: ShoppingCartIcon, order_form: ClipboardListIcon, phone_numbers: PhoneCallIcon, show_collection: LayoutGridIcon, tell_story: BookOpenIcon }

/** A first page name for each type (until one is typed). */
const DEFAULT_TITLES: Record<WizardPageType, { en: string; bn: string }> = {
  home: { en: 'Home', bn: 'হোম' },
  sale: { en: 'Big sale', bn: 'বড় সেল' },
  product_launch: { en: 'New arrival', bn: 'নতুন পণ্য' },
  about: { en: 'About us', bn: 'আমাদের সম্পর্কে' },
  festival: { en: 'Festival offers', bn: 'উৎসবের অফার' },
  contact: { en: 'Contact us', bn: 'যোগাযোগ' },
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type PickedProduct = { id: string; name: string; image_url: string | null }
type Step = 1 | 2 | 3 | 4
type FieldErrors = Partial<Record<'title' | 'slug' | 'festival' | 'category_ids' | 'product_ids' | 'goal' | 'look' | 'language', string>>

const STEP_OF_FIELD: Record<keyof FieldErrors, Step> = { title: 1, slug: 1, festival: 1, category_ids: 2, product_ids: 2, goal: 3, look: 4, language: 4 }

function useWords() {
  const { lang } = useScreenText()
  return { lang, w: (key: WizardWordKey, values?: Record<string, string | number>) => wizardWord(lang, key, values) }
}

/** One radio card (a real radio, visually a card; the focus ring sits on the card). */
function RadioCard({ name, value, checked, onChange, icon: Icon, title, text, picture, testId }: { name: string; value: string; checked: boolean; onChange: () => void; icon?: LucideIcon; title: string; text: string; picture?: ReactNode; testId: string }) {
  return (
    <label
      data-testid={testId}
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {picture ?? (Icon && (
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
          <Icon className="size-5" aria-hidden />
        </span>
      ))}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </label>
  )
}

/** A tiny moving preview of a look (still under reduced motion). */
function LookPreview({ look }: { look: WizardLook }) {
  const bar = 'h-1.5 rounded-full bg-current'
  const motion =
    look === 'calm' ? 'motion-safe:animate-pulse' : look === 'lively' ? 'motion-safe:animate-bounce' : look === 'festive' ? 'motion-safe:animate-ping' : ''
  return (
    <span aria-hidden className={cn('relative flex size-12 shrink-0 flex-col justify-center gap-1 overflow-hidden rounded-md border px-2', look === 'festive' ? 'bg-amber-50 text-amber-700' : look === 'lively' ? 'bg-sky-50 text-sky-700' : look === 'calm' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>
      <span className={cn(bar, 'w-3/4', look !== 'festive' && motion)} />
      <span className={cn(bar, 'w-1/2 opacity-60')} />
      {look === 'festive' && <SparklesIcon className={cn('absolute top-1 right-1 size-3', motion)} />}
    </span>
  )
}

/** Up to eight products, picked from the admin product search. */
function ProductPicker({ value, onChange, labelId }: { value: PickedProduct[]; onChange: (next: PickedProduct[]) => void; labelId: string }) {
  const { w, lang } = useWords()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const results = useProductSearchQuery(term, open)
  const hits = (results.data?.items ?? []).filter((p) => !value.some((v) => v.id === p.id))
  const full = value.length >= WIZARD_LIMITS.products
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2" data-testid="wizard-products">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {w('productsPicked', { count: value.length, max: WIZARD_LIMITS.products })}
      </p>
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((product) => (
            <li key={product.id} className="flex items-center gap-2 rounded-md border p-1.5 text-sm">
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                {product.image_url ? <img src={product.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-3.5 text-muted-foreground" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate">{product.name}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={w('productRemove', { name: product.name })} onClick={() => onChange(value.filter((v) => v.id !== product.id))}>
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch('')
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={full}>
            <PackageIcon aria-hidden /> {w('productAdd')}
          </Button>
        </PopoverTrigger>
        <PopoverContent lang={lang} className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
          <Command shouldFilter={false} label={w('productsSearch')}>
            <CommandInput value={search} onValueChange={setSearch} placeholder={w('productsSearch')} />
            <CommandList>
              <CommandEmpty>{results.isFetching ? w('productsSearching') : w('productsEmpty')}</CommandEmpty>
              {hits.length > 0 && (
                <CommandGroup>
                  {hits.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={product.id}
                      onSelect={() => {
                        const next = [...value, { id: product.id, name: product.name, image_url: product.images[0]?.url ?? null }]
                        onChange(next)
                        if (next.length >= WIZARD_LIMITS.products) setOpen(false)
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{product.name}</span>
                        {product.variants[0]?.sku && <span className="truncate text-xs text-muted-foreground">{product.variants[0].sku}</span>}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Step 2's category chips (toggle buttons; at most four). */
function CategoryChips({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { w } = useWords()
  const categories = useWebCategoriesQuery()
  const [note, setNote] = useState<string | null>(null)
  const shown = (categories.data ?? []).filter((c) => c.is_active && c.listing?.is_visible !== false)
  if (categories.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden /> …
      </p>
    )
  }
  if (categories.error) return <p className="text-sm text-muted-foreground">{w('categoriesError')}</p>
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">{w('categoriesNone')}</p>
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2" aria-label={w('categories')}>
        {shown.map((category) => {
          const on = value.includes(category.id)
          return (
            <li key={category.id}>
              <button
                type="button"
                aria-pressed={on}
                data-testid={`wizard-category-${category.id}`}
                onClick={() => {
                  if (on) {
                    setNote(null)
                    return onChange(value.filter((id) => id !== category.id))
                  }
                  if (value.length >= WIZARD_LIMITS.categories) return setNote(w('categoriesMax', { max: WIZARD_LIMITS.categories }))
                  onChange([...value, category.id])
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {category.name}
              </button>
            </li>
          )
        })}
      </ul>
      {note && (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}

/** The festival of a festival page (default: the next one coming up). */
function FestivalChoice({ value, onChange, error }: { value: string; onChange: (key: string) => void; error?: string }) {
  const { w, lang } = useWords()
  const festivals = useFestivalsQuery()
  const list = festivals.data ?? []
  if (list.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="wizard-festival">{w('festival')}</Label>
      <select
        id="wizard-festival"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || undefined}
        className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <option value="">{w('festivalNext')}</option>
        {list.map((festival) => (
          <option key={festival.key} value={festival.key}>
            {lang === 'bn' ? festival.name_bn : festival.name}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** The progress words while the page is built (one after another, read politely). */
function progressSteps(goal: WizardGoal, ai: boolean): WizardWordKey[] {
  const steps: WizardWordKey[] = ['progress.hero']
  if (goal !== 'tell_story' && goal !== 'phone_numbers') steps.push('progress.products')
  steps.push('progress.trust')
  if (ai) steps.push('progress.texts')
  steps.push('progress.finish')
  return steps
}

function Progress({ steps }: { steps: WizardWordKey[] }) {
  const { w } = useWords()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), 1200)
    return () => clearInterval(timer)
  }, [steps.length])
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="wizard-progress">
      <Loader2Icon className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
      <p className="font-medium">{w('building')}</p>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {w(steps[index]!)}
      </p>
    </div>
  )
}

export type WizardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page type picked first (the editor: the open page's kind). */
  initialType?: WizardPageType
  /** After the build (default: opens the editor on the new draft). */
  onBuilt?: (result: WizardResult) => void
}

export function WizardDialog(props: WizardDialogProps) {
  const { lang } = useScreenText()
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent lang={lang} className="max-h-[92svh] overflow-y-auto sm:max-w-2xl" data-testid="wizard-dialog">
        {props.open && <WizardSteps {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function WizardSteps({ onOpenChange, initialType = 'home', onBuilt }: WizardDialogProps) {
  const { w, lang } = useWords()
  const navigate = useNavigate()
  const me = useCurrentUserQuery().data
  const aiOn = me ? aiEnabledFor(me) : false
  const build = useWizardMutation()
  const ids = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const [step, setStep] = useState<Step>(1)
  const [type, setType] = useState<WizardPageType>(initialType)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [festival, setFestival] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [mode, setMode] = useState<'best' | 'choose'>('best')
  const [products, setProducts] = useState<PickedProduct[]>([])
  const [goal, setGoal] = useState<WizardGoal>(WIZARD_DEFAULT_GOALS[initialType])
  const [goalTouched, setGoalTouched] = useState(false)
  const [look, setLook] = useState<WizardLook>('current')
  const [language, setLanguage] = useState<WizardLanguage>(lang === 'bn' ? 'bn' : 'en')
  const [useAi, setUseAi] = useState(false)
  const [logoOpen, setLogoOpen] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const effectiveTitle = titleTouched ? title : DEFAULT_TITLES[type][lang]
  const titleProblem = effectiveTitle.trim() ? null : w('pageNameProblem')
  const slugProblem = slug && type !== 'home' && !SLUG.test(slug) ? w('addressProblem') : null

  // Each step's heading takes the focus (screen readers hear where they are).
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  const pickType = (next: WizardPageType) => {
    setType(next)
    if (!goalTouched) setGoal(WIZARD_DEFAULT_GOALS[next])
  }

  const go = (next: Step) => {
    setProblem(null)
    setStep(next)
  }

  const submit = () => {
    setTried(true)
    if (titleProblem || slugProblem) return setStep(1)
    setErrors({})
    setProblem(null)
    const input: WizardInput = {
      page_type: type,
      title: effectiveTitle.trim().slice(0, WIZARD_LIMITS.title),
      goal,
      look,
      language,
      ...(aiOn ? { use_ai: useAi } : {}),
      ...(slug && type !== 'home' ? { slug } : {}),
      ...(categories.length > 0 ? { category_ids: categories } : {}),
      ...(mode === 'choose' && products.length > 0 ? { product_ids: products.map((p) => p.id) } : {}),
      ...(type === 'festival' && festival ? { festival } : {}),
    }
    build.mutate(input, {
      onSuccess: (result) => {
        const labels = result.sections.map((s) => (lang === 'bn' && s.label_bn ? s.label_bn : s.label))
        const ai = aiOn && useAi ? aiKey(result.ai.status) : null
        const description = [labels.length > 0 ? w('readySections', { list: labels.join(', ') }) : null, ai ? w(ai) : null].filter(Boolean).join(' ')
        toast.success(w('ready'), { description: description || undefined, duration: 10_000 })
        onOpenChange(false)
        if (onBuilt) onBuilt(result)
        else void navigate(`/storefront/builder/${result.document.id}`)
      },
      onError: (error) => {
        if (!(error instanceof ApiError)) return setProblem(w('error.other'))
        if (error.code === 'NOTHING_TO_SHOW') {
          setProblem(w('error.nothing'))
          return setStep(3)
        }
        if (error.code === 'DOCUMENT_EXISTS') {
          setErrors({ slug: w('error.exists') })
          setStep(1)
          return
        }
        if (error.status === 429) return setProblem(w('error.tooMany'))
        if (error.status === 403) return setProblem(w('error.denied'))
        const fields = error.fieldErrors
        const found: FieldErrors = {}
        for (const key of Object.keys(STEP_OF_FIELD) as (keyof FieldErrors)[]) {
          const message = fields[key]?.[0] ?? Object.entries(fields).find(([k]) => k.startsWith(`${key}.`))?.[1]?.[0]
          if (message) found[key] = message
        }
        const first = (Object.keys(found) as (keyof FieldErrors)[])[0]
        if (first) {
          setErrors(found)
          setStep(STEP_OF_FIELD[first])
          return
        }
        setProblem(error.message || w('error.other'))
      },
    })
  }

  if (build.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{w('title')}</DialogTitle>
          <DialogDescription className="sr-only">{w('building')}</DialogDescription>
        </DialogHeader>
        <Progress steps={progressSteps(goal, aiOn && useAi)} />
      </>
    )
  }

  const headingId = `${ids}-heading`
  const heading = (key: WizardWordKey) => (
    <h3 id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
      {w(key)}
    </h3>
  )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <WandSparklesIcon className="size-5 text-primary" aria-hidden /> {w('title')}
        </DialogTitle>
        <DialogDescription>{w('intro')}</DialogDescription>
      </DialogHeader>
      {/* The bar is a picture of the visible "Step n of 4" line below it. */}
      <div className="flex gap-1.5" aria-hidden data-testid="wizard-steps">
        {([1, 2, 3, 4] as const).map((n) => (
          <span key={n} className={cn('h-1.5 flex-1 rounded-full', n <= step ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="wizard-step">
        {w('stepOf', { n: step })}
      </p>

      <form
        id={`${ids}-form`}
        noValidate
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (step < 4) {
            if (step === 1) {
              setTried(true)
              if (titleProblem || slugProblem) return
            }
            return go((step + 1) as Step)
          }
          submit()
        }}
      >
        {step === 1 && (
          <>
            {heading('step1.title')}
            <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              {WIZARD_PAGE_TYPES.map((option) => (
                <RadioCard key={option} name="wizard-type" value={option} checked={type === option} onChange={() => pickType(option)} icon={TYPE_ICONS[option]} title={w(typeKey(option))} text={w(`${typeKey(option)}.text` as WizardWordKey)} testId={`wizard-type-${option}`} />
              ))}
            </div>
            {type === 'home' && <p className="text-sm text-muted-foreground">{w('homeNote')}</p>}
            {type === 'festival' && <FestivalChoice value={festival} onChange={setFestival} error={errors.festival} />}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-title`}>{w('pageName')}</Label>
              <Input
                id={`${ids}-title`}
                value={effectiveTitle}
                maxLength={WIZARD_LIMITS.title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setTitleTouched(true)
                }}
                aria-invalid={(tried && !!titleProblem) || !!errors.title || undefined}
                aria-describedby={tried && titleProblem ? `${ids}-title-error` : undefined}
              />
              {((tried && titleProblem) || errors.title) && (
                <p id={`${ids}-title-error`} className="text-sm text-destructive">
                  {errors.title ?? titleProblem}
                </p>
              )}
            </div>
            {type !== 'home' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-slug`}>{w('address')}</Label>
                <Input
                  id={`${ids}-slug`}
                  value={slug}
                  maxLength={60}
                  placeholder="eid-offer"
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))
                    setErrors((current) => ({ ...current, slug: undefined }))
                  }}
                  aria-invalid={!!errors.slug || !!slugProblem || undefined}
                  aria-describedby={`${ids}-slug-help`}
                />
                <p id={`${ids}-slug-help`} className="text-sm text-muted-foreground">
                  {slug ? (
                    <>
                      {w('addressHelp')} <span className="font-mono text-foreground">/p/{slug}</span>
                    </>
                  ) : (
                    w('addressAuto')
                  )}
                </p>
                {(errors.slug ?? (tried ? slugProblem : null)) && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.slug ?? slugProblem}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {heading('step2.title')}
            <p className="text-sm text-muted-foreground">{w('step2.text', { max: WIZARD_LIMITS.categories })}</p>
            <CategoryChips value={categories} onChange={setCategories} />
            {errors.category_ids && <p className="text-sm text-destructive">{errors.category_ids}</p>}
            <div role="radiogroup" aria-label={w('chooseProducts')} className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              <RadioCard name="wizard-products" value="best" checked={mode === 'best'} onChange={() => setMode('best')} icon={SparklesIcon} title={w('bestSellers')} text={w('bestSellersText')} testId="wizard-best-sellers" />
              <RadioCard name="wizard-products" value="choose" checked={mode === 'choose'} onChange={() => setMode('choose')} icon={PackageIcon} title={w('chooseProducts')} text={w('productsSearch')} testId="wizard-choose-products" />
            </div>
            {mode === 'choose' && (
              <>
                <span id={`${ids}-products`} className="sr-only">
                  {w('chooseProducts')}
                </span>
                <ProductPicker value={products} onChange={setProducts} labelId={`${ids}-products`} />
              </>
            )}
            {errors.product_ids && <p className="text-sm text-destructive">{errors.product_ids}</p>}
          </>
        )}

        {step === 3 && (
          <>
            {heading('step3.title')}
            <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              {WIZARD_GOALS.map((option) => (
                <RadioCard
                  key={option}
                  name="wizard-goal"
                  value={option}
                  checked={goal === option}
                  onChange={() => {
                    setGoal(option)
                    setGoalTouched(true)
                  }}
                  icon={GOAL_ICONS[option]}
                  title={w(goalKey(option))}
                  text={w(`${goalKey(option)}.text` as WizardWordKey)}
                  testId={`wizard-goal-${option}`}
                />
              ))}
            </div>
            {errors.goal && <p className="text-sm text-destructive">{errors.goal}</p>}
          </>
        )}

        {step === 4 && (
          <>
            {heading('step4.title')}
            <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              {WIZARD_LOOKS.map((option) => (
                <RadioCard key={option} name="wizard-look" value={option} checked={look === option} onChange={() => setLook(option)} picture={<LookPreview look={option} />} title={w(lookKey(option))} text={w(`${lookKey(option)}.text` as WizardWordKey)} testId={`wizard-look-${option}`} />
              ))}
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{w('language')}</legend>
              <div className="inline-flex w-fit flex-wrap gap-1 rounded-full border p-1">
                {WIZARD_LANGUAGES.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      'cursor-pointer rounded-full px-3 py-1 text-sm font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                      language === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <input type="radio" name="wizard-language" value={option} checked={language === option} onChange={() => setLanguage(option)} className="sr-only" />
                    <span lang={option === 'bn' ? 'bn' : undefined}>{w(langKey(option))}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {aiOn && (
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Switch id={`${ids}-ai`} checked={useAi} onCheckedChange={setUseAi} aria-describedby={`${ids}-ai-text`} />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`${ids}-ai`}>{w('ai')}</Label>
                  <p id={`${ids}-ai-text`} className="text-xs text-muted-foreground">
                    {w('aiText')}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {step === 4 && (
          // Frontend C's brand kit: the logo's colours into the theme draft (optional, never published).
          <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="wizard-logo-colours">
            <Button type="button" variant="ghost" size="sm" className="self-start" aria-expanded={logoOpen} aria-controls={`${ids}-logo`} onClick={() => setLogoOpen((v) => !v)}>
              <PaletteIcon aria-hidden /> {w('logo')}
            </Button>
            <p className="text-xs text-muted-foreground">{w('logoText')}</p>
            <div id={`${ids}-logo`} hidden={!logoOpen} className="flex flex-col gap-2">
              {logoOpen && (
                <>
                  <LogoColoursStep onDone={() => setLogoOpen(false)} />
                  <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setLogoOpen(false)}>
                    {w('logoSkip')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {problem && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive" data-testid="wizard-problem">
            {problem}
          </p>
        )}
      </form>

      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {w('cancel')}
        </Button>
        {step > 1 && (
          <Button type="button" variant="outline" onClick={() => go((step - 1) as Step)}>
            {w('back')}
          </Button>
        )}
        <Button type="submit" form={`${ids}-form`}>
          {step < 4 ? w('next') : (
            <>
              <WandSparklesIcon aria-hidden /> {w('build')}
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  )
}

/** "Build it for me": the button and its dialog (Pages list, the empty home page card). */
export function BuildForMeButton({ initialType, variant = 'outline', className }: { initialType?: WizardPageType; variant?: 'default' | 'outline' | 'secondary'; className?: string }) {
  const { w } = useWords()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)} title={w('openHint')} data-testid="build-for-me">
        <WandSparklesIcon aria-hidden /> {w('open')}
      </Button>
      <WizardDialog open={open} onOpenChange={setOpen} initialType={initialType} />
    </>
  )
}
