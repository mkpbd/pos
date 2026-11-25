export type BranchSummary = {
  id: string
  code: string
  name: string
  is_active: boolean
}

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
  base_currency: string
  timezone: string
  tax_mode: 'exclusive' | 'inclusive'
  status: 'active' | 'suspended'
  /** Phase 8: AI features switched on for the organization (app and organization settings). */
  ai_enabled?: boolean
}

/** G1a: the signed-in user's two-factor state. `setup_required`: the organization requires it and it is not on yet. */
export type CurrentUserTwoFactor = {
  enabled: boolean
  required: boolean
  setup_required: boolean
}

export type CurrentUser = {
  user: {
    id: string
    name: string
    email: string
    phone: string | null
    is_platform_admin: boolean
    last_login_at: string | null
    /** POS1a: a till PIN is set (some servers send it here rather than at the top level). */
    pin_set?: boolean
  }
  organization: OrganizationSummary | null
  roles: { id: string; name: string; system_key: string | null }[]
  permissions: string[]
  branches: BranchSummary[]
  /** Phase 8: AI features switched on for the organization (app and organization settings). */
  ai_enabled?: boolean
  /** G1a: two-factor sign-in state (absent from servers before G1a). */
  two_factor?: CurrentUserTwoFactor
  /** POS1a: the signed-in user has a till PIN (absent before POS1a). */
  pin_set?: boolean
}
