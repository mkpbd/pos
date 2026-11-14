import { Navigate } from 'react-router'
import { useCan } from '@/features/auth/use-auth'

/**
 * "/marketing" opens the campaigns for people with marketing.view, and the social posts for people
 * who may only use Facebook & Instagram (social.view without marketing.view; P2b).
 */
export function MarketingRedirect() {
  const can = useCan()

  return <Navigate to={can('marketing.view') || !can('social.view') ? '/marketing/campaigns' : '/marketing/social'} replace />
}
