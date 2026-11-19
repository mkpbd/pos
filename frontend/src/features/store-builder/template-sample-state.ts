import { createContext, useContext, useMemo, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import { en } from '@/storefront/i18n/en'
import { formatDate, formatNumber, localizeDigits, type DigitOptions } from '@/storefront/i18n/format'
import { createTranslator, type Dictionary } from '@/storefront/i18n/translate'
import { fieldText, storeContext, type FieldFormatters } from '@/storefront/builder/templates/context'
import type { StorePageContext, StorePageSample, StoreTemplateKey } from '@/storefront/builder/templates/types'
import type { StorefrontBootstrap } from '@/storefront/types'
import { SAMPLE_ORDER, useSampleContextQuery, type SampleChoice, type SampleOption } from './store-pages-api'

/*
 * B14: the canvas sample of a store page design — which category, brand, search words, blog post
 * or order the canvas (and the live text previews in the inspector) show the page with. The
 * toolbar's "Preview with" picker sets it; GET /storefront/builder/sample-context answers the
 * page context and the data the main part draws, and the editor forwards both to the canvas
 * (`page-context`). Normal pages get the store's own fields (name, phone, email, address).
 * The choice is remembered per store page in this browser. The picker: ./template-sample.tsx.
 */

export type TemplateSample = {
  /** The store page of the document (null: a normal page). */
  template: StoreTemplateKey | null
  choice: SampleChoice
  setChoice: (choice: SampleChoice) => void
  /** The page context the canvas draws with (null while the first answer loads). */
  context: StorePageContext | null
  sample: StorePageSample | null
  /** The order page's choices (sample + the latest orders, masked). */
  choices: SampleOption[]
  pending: boolean
  /** The chosen record is gone (404): the server's own pick shows instead. */
  missing: boolean
}

export const TemplateSampleContext = createContext<TemplateSample | null>(null)

/** The editor's sample (null outside the editor, e.g. in the inspector's own tests). */
export const useTemplateSample = () => useContext(TemplateSampleContext)

const STORAGE = 'pos.builder.sample.'

function readStored(template: StoreTemplateKey | null): SampleChoice {
  if (!template) return null
  try {
    return globalThis.localStorage?.getItem(STORAGE + template) || null
  } catch {
    return null
  }
}

function store(template: StoreTemplateKey, choice: SampleChoice) {
  try {
    if (choice) globalThis.localStorage?.setItem(STORAGE + template, choice)
    else globalThis.localStorage?.removeItem(STORAGE + template)
  } catch {
    // Private windows: the choice lasts for this visit only.
  }
}

/** The editor's sample state for a document (`template` null: a normal page, store fields only). */
export function useTemplateSampleState({ template, lang, bootstrap }: { template: StoreTemplateKey | null; lang: string; bootstrap: Pick<StorefrontBootstrap, 'store' | 'theme'> }): TemplateSample {
  const [choices, setChoices] = useState<{ template: StoreTemplateKey | null; choice: SampleChoice }>(() => ({ template, choice: readStored(template) }))
  const choice = choices.template === template ? choices.choice : readStored(template)
  const query = useSampleContextQuery(template, choice, lang)
  // A record that is gone (deleted category, old order): fall back to the server's pick, and say so.
  const [lost, setLost] = useState<string | null>(null)
  if (template && choice !== null && query.error instanceof ApiError && query.error.status === 404) {
    setLost(choice)
    store(template, null)
    setChoices({ template, choice: null })
  }
  const missing = lost !== null && choice === null
  const storeOnly = useMemo<StorePageContext>(() => ({ template: null, store: storeContext(bootstrap) }), [bootstrap])
  const data = query.data
  return {
    template,
    choice,
    setChoice: (next) => {
      if (!template) return
      store(template, next)
      setLost(null)
      setChoices({ template, choice: next })
    },
    context: template ? (data?.context ?? null) : storeOnly,
    sample: template ? (data?.sample ?? null) : null,
    choices: Array.isArray(data?.choices) ? data.choices : [],
    pending: template !== null && query.isFetching,
    missing,
  }
}

/* ----------------------------------------------------------------------------------------------
 * Live text values (the inspector's preview; the canvas draws the same with the store's words)
 * -------------------------------------------------------------------------------------------- */

const EN_DIGITS: DigitOptions = { locale: 'en', banglaDigits: false }

const EN_FORMATTERS: FieldFormatters = {
  t: createTranslator(en as unknown as Dictionary, EN_DIGITS),
  formatNumber: (value) => formatNumber(value, {}, EN_DIGITS),
  formatDate: (iso) => formatDate(iso, 'medium', EN_DIGITS),
  digits: (text) => localizeDigits(text, EN_DIGITS),
}

/** What a live text shows with the sample (without its words before / after), or null when the field has no value. */
export function sampleFieldText(context: StorePageContext | null, field: string, format: Parameters<typeof fieldText>[2], currency?: string | null): string | null {
  try {
    return fieldText(context, field, format, EN_FORMATTERS, currency ?? null)
  } catch {
    return null
  }
}

/** The words of the picker button: what the canvas shows now. */
export function sampleLabel(template: StoreTemplateKey, context: StorePageContext | null, options: SampleOption[], choice: SampleChoice): string {
  const chosen = choice ? options.find((o) => o.id === choice)?.label : undefined
  switch (template) {
    case 'category':
      return context?.category?.name ?? chosen ?? 'A category'
    case 'brand':
      return context?.brand?.name ?? chosen ?? 'A brand'
    case 'search':
      return context?.search?.query ? `“${context.search.query}”` : choice ? `“${choice}”` : 'Search words'
    case 'blog_post':
      return context?.post?.title ?? chosen ?? 'A blog post'
    case 'order':
      if (choice === SAMPLE_ORDER) return 'Sample order'
      return context?.order?.number ? `Order ${context.order.number}` : (chosen ?? 'Latest order')
    default:
      return ''
  }
}
