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

export type CurrentUser = {
  user: {
    id: string
    name: string
    email: string
    phone: string | null
    is_platform_admin: boolean
    last_login_at: string | null
  }
  organization: OrganizationSummary | null
  roles: { id: string; name: string; system_key: string | null }[]
  permissions: string[]
  branches: BranchSummary[]
  /** Phase 8: AI features switched on for the organization (app and organization settings). */
  ai_enabled?: boolean
}
