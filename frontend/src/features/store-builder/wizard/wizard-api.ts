import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { builderAdminKeys, type DocumentSummary } from '../api'

/*
 * B21 "Build it for me": POST /storefront/builder/wizard builds a whole page as a DRAFT from
 * built-in section templates (store name, chosen categories / products or best sellers, the
 * running promotion, festival texts, plain copy in English / Bangla; optionally AI-written texts).
 * Home fills the home draft when there is no builder home yet (or an empty, never-published one);
 * everything else is a new campaign page. Nothing is published.
 */

export const WIZARD_PAGE_TYPES = ['home', 'sale', 'product_launch', 'about', 'festival', 'contact'] as const
export const WIZARD_GOALS = ['orders', 'order_form', 'phone_numbers', 'show_collection', 'tell_story'] as const
export const WIZARD_LOOKS = ['current', 'calm', 'lively', 'festive'] as const
export const WIZARD_LANGUAGES = ['en', 'bn', 'both'] as const

export type WizardPageType = (typeof WIZARD_PAGE_TYPES)[number]
export type WizardGoal = (typeof WIZARD_GOALS)[number]
export type WizardLook = (typeof WIZARD_LOOKS)[number]
export type WizardLanguage = (typeof WIZARD_LANGUAGES)[number]

/** The goal picked first for each page type (registry `wizard_default_goals`). */
export const WIZARD_DEFAULT_GOALS: Record<WizardPageType, WizardGoal> = {
  home: 'orders',
  sale: 'orders',
  product_launch: 'order_form',
  about: 'tell_story',
  festival: 'orders',
  contact: 'phone_numbers',
}

/** Registry `limits.wizard`. */
export const WIZARD_LIMITS = { title: 80, categories: 4, products: 8 } as const

export type WizardInput = {
  page_type: WizardPageType
  title: string
  slug?: string
  goal: WizardGoal
  look: WizardLook
  language: WizardLanguage
  use_ai?: boolean
  category_ids?: string[]
  product_ids?: string[]
  festival?: string
}

export type WizardAiStatus = 'not_requested' | 'ok' | 'disabled' | 'budget_exceeded' | 'failed'

export type WizardResult = {
  document: DocumentSummary
  target: 'home' | 'landing'
  sections: { template: string; label: string; label_bn?: string | null }[]
  products?: { source: 'chosen' | 'category' | 'best_sellers' | 'new_arrivals' | 'none'; count: number } | null
  festival?: { key: string; name: string; name_bn: string } | null
  ai: { used: boolean; status: WizardAiStatus }
}

export function buildWithWizard(input: WizardInput): Promise<WizardResult> {
  return api.post<WizardResult>('/storefront/builder/wizard', input).then((r) => ({
    ...r.data,
    sections: Array.isArray(r.data?.sections) ? r.data.sections : [],
    ai: r.data?.ai ?? { used: false, status: 'not_requested' },
  }))
}

export function useWizardMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: buildWithWizard,
    onSuccess: (result) => {
      // The editor fetches the new draft fresh; the lists show the new page.
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.document(result.document.id) })
      void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
    },
  })
}
