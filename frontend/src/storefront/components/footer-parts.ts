import type { MenuLocation, SocialNetwork } from '../types'

/** For the default copyright line; a page load is short enough not to straddle New Year in practice. */
export const CURRENT_YEAR = new Date().getFullYear()

export const FOOTER_MENUS: MenuLocation[] = ['footer_1', 'footer_2', 'footer_3']

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
}

/** Products for the footer's product lists: one page of the listing in this order, of which the first few are shown. */
export const FOOTER_PRODUCT_QUERY = { popularity: 'sort=popularity&per_page=12', latest: 'sort=latest&per_page=12', rating: 'sort=rating&per_page=12' } as const

export const FOOTER_LIST_SIZE = 3
