import { useId, useState } from 'react'
import { CheckIcon, ChevronDownIcon, EyeIcon, Loader2Icon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { hasSamplePicker, sampleOptions, useLinkTargetsForSample, type SampleOption } from './store-pages-api'
import { sampleLabel, useTemplateSample } from './template-sample-state'

/*
 * B14: the toolbar's "Preview with" picker of a store page design — the category, brand, search
 * words, blog post or order the canvas shows the design with (state: ./template-sample-state.ts).
 */

/* ----------------------------------------------------------------------------------------------
 * The toolbar's "Preview with" picker
 * -------------------------------------------------------------------------------------------- */

const PICKER_WORDS: Record<'category' | 'brand' | 'search' | 'blog_post' | 'order', { title: string; text: string; empty: string; filter?: string }> = {
  category: {
    title: 'Preview with a category',
    text: 'The canvas shows this design with the category you pick. On your shop each category page shows its own name and products.',
    empty: 'You have no categories yet.',
    filter: 'Find a category',
  },
  brand: {
    title: 'Preview with a brand',
    text: 'The canvas shows this design with the brand you pick. On your shop each brand page shows its own name and products.',
    empty: 'You have no brands yet.',
    filter: 'Find a brand',
  },
  search: {
    title: 'Preview with search words',
    text: 'Type what a shopper might search for. The canvas shows the products that match.',
    empty: '',
  },
  blog_post: {
    title: 'Preview with a blog post',
    text: 'The canvas shows this design with the post you pick. On your shop every post uses it.',
    empty: 'You have no blog posts yet.',
    filter: 'Find a post',
  },
  order: {
    title: 'Preview with an order',
    text: 'Shoppers only ever see their own order. Here names, phone numbers and addresses are hidden.',
    empty: 'No orders yet: the canvas shows a made-up sample order.',
  },
}

function OptionList({ options, value, onChoose, label }: { options: SampleOption[]; value: string | null; onChoose: (id: string) => void; label: string }) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" data-testid="sample-options">
      {options.map((option) => {
        const checked = option.id === value
        return (
          <label
            key={option.id}
            className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50', checked ? 'bg-secondary font-medium' : 'hover:bg-muted')}
          >
            <input type="radio" className="sr-only" name={name} checked={checked} onChange={() => onChoose(option.id)} />
            <CheckIcon className={cn('size-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.note && <span className="text-xs text-muted-foreground">{option.note}</span>}
          </label>
        )
      })}
    </div>
  )
}

/** "Preview with: <what>" in the toolbar of a store page design (nothing for shop and page-not-found). */
export function SamplePicker() {
  const sample = useTemplateSample()
  const template = sample?.template ?? null
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [words, setWords] = useState('')
  const listTemplate = template === 'category' || template === 'brand' || template === 'blog_post'
  const targets = useLinkTargetsForSample(listTemplate)
  if (!sample || !hasSamplePicker(template)) return null
  const options = sampleOptions(template, targets.data, sample.choices)
  const words_ = PICKER_WORDS[template]
  const label = sampleLabel(template, sample.context, options, sample.choice)
  const q = filter.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  // The selected record: the choice, else the one the server picked (matched by name).
  const selected =
    sample.choice ??
    options.find((o) => o.label === (template === 'category' ? sample.context?.category?.name : template === 'brand' ? sample.context?.brand?.name : template === 'blog_post' ? sample.context?.post?.title : undefined))?.id ??
    (template === 'order' && sample.context?.order ? options.find((o) => o.id === sample.context?.order?.number)?.id ?? null : null)
  const choose = (id: string | null) => {
    sample.setChoice(id)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setFilter('')
          setWords(template === 'search' ? (sample.context?.search?.query ?? sample.choice ?? '') : '')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-w-56" data-testid="sample-picker" aria-label={`Preview with: ${label}. Change what the canvas shows this page with`}>
          {sample.pending ? <Loader2Icon className="animate-spin" aria-hidden /> : <EyeIcon aria-hidden />}
          <span className="hidden text-muted-foreground xl:inline">Preview with</span>
          <span className="min-w-0 truncate" data-testid="sample-label">{label}</span>
          <ChevronDownIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <PopoverTitle className="text-sm font-semibold">{words_.title}</PopoverTitle>
          <PopoverDescription className="text-sm text-muted-foreground">{words_.text}</PopoverDescription>
        </div>
        {template === 'search' ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const value = words.trim().slice(0, 100)
              choose(value === '' ? null : value)
            }}
          >
            <Input value={words} maxLength={100} onChange={(e) => setWords(e.target.value)} aria-label="Search words" placeholder="e.g. panjabi" data-testid="sample-search-words" />
            <Button type="submit" size="sm">
              <SearchIcon aria-hidden /> Show
            </Button>
          </form>
        ) : listTemplate && targets.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{words_.empty}</p>
        ) : (
          <>
            {words_.filter && options.length > 8 && <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={words_.filter} placeholder={words_.filter} />}
            {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches “{filter}”.</p> : <OptionList options={shown} value={selected} label={words_.title} onChoose={choose} />}
          </>
        )}
        {sample.missing && (
          <p role="status" className="text-sm text-muted-foreground">
            The one you picked before is gone, so the canvas shows another.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
