import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'
import { builderAdminKeys, useCreateDocumentMutation, ZONE_ERRORS, ZONE_VERSION_LIMIT, type CreateDocumentInput } from '../api'
import { useScreenText } from './screen-language'

/**
 * Creates a document and opens the editor; a document that already exists refreshes the list (B4).
 * P1b: a zone version over the limit, or for a category / product that is gone, says so plainly.
 */
export function useStartDocument() {
  const { t } = useScreenText()
  const create = useCreateDocumentMutation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: builderAdminKeys.documents })
  const start = (input: CreateDocumentInput) =>
    create.mutate(input, {
      onSuccess: (created) => void navigate(`/storefront/builder/${created.id}`),
      onError: (error) => {
        const code = error instanceof ApiError ? error.code : null
        if (code === 'DOCUMENT_EXISTS') {
          toast.info(t('start.elsewhere'))
          refresh()
        } else if (code === ZONE_ERRORS.limit) {
          const limit = error instanceof ApiError && typeof error.details.limit === 'number' ? error.details.limit : ZONE_VERSION_LIMIT
          toast.error(t('productZones.limit', { limit }))
          refresh()
        } else if (code === ZONE_ERRORS.targetNotFound) {
          toast.error(t('productZones.targetMissing'))
          refresh()
        } else toast.error(error.message)
      },
    })
  const pendingKey = create.isPending ? create.variables?.key : undefined
  return { start, pendingKey, pending: create.isPending }
}
