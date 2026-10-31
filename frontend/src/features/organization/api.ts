import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { authKeys } from '@/features/auth/api'

export type Organization = {
  id: string
  name: string
  slug: string
  legal_name: string | null
  tax_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  base_currency: string
  timezone: string
  tax_mode: 'exclusive' | 'inclusive'
  status: 'active' | 'suspended'
  settings: { receipt_header?: string | null; receipt_footer?: string | null; invoice_prefix?: string | null }
}

export type OrganizationInput = Partial<Pick<Organization, 'name' | 'legal_name' | 'tax_number' | 'email' | 'phone' | 'address' | 'timezone' | 'tax_mode' | 'settings'>>

export const organizationKeys = { current: ['organization'] as const }

export function useOrganizationQuery() {
  return useQuery({
    queryKey: organizationKeys.current,
    queryFn: ({ signal }) => api.get<Organization>('/organization', { signal }).then((r) => r.data),
  })
}

export function useUpdateOrganizationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OrganizationInput) => api.patch<Organization>('/organization', input).then((r) => r.data),
    onSuccess: (organization) => {
      queryClient.setQueryData(organizationKeys.current, organization)
      void queryClient.invalidateQueries({ queryKey: authKeys.me })
    },
  })
}
