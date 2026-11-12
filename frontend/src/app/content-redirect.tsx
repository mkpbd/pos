import { Navigate } from 'react-router'
import { useCan } from '@/features/auth/use-auth'

/**
 * "/content" opens the content pages for people who manage content, and the form submissions
 * for people who may only read those (forms.view without cms.manage).
 */
export function ContentRedirect() {
  const can = useCan()

  return <Navigate to={can('cms.manage') || !can('forms.view') ? '/content/pages' : '/content/forms'} replace />
}
