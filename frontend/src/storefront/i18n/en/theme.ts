import type { Messages } from '../types'

/** Theme layout variants (T1): top bars, header and footer variants, hero tiles. */
export const theme = {
  'theme.ticker.label': 'Announcement',
  'theme.ticker.pause': 'Pause the announcement',
  'theme.ticker.play': 'Play the announcement',

  'theme.topBar.label': 'Store links',

  'theme.header.searchTitle': 'Search the store',
  'theme.header.cartWithTotal': 'Cart, {items}, {total}',

  'theme.footer.about': 'About us',
  'theme.footer.follow': 'Follow us',
  'theme.footer.popular': 'Popular',
  'theme.footer.new': 'New arrivals',
  'theme.footer.bestSelling': 'Best selling',
  'theme.footer.topRated': 'Top rated',
  'theme.footer.latestPosts': 'Latest posts',
  'theme.footer.newsletter': 'Newsletter',
  'theme.footer.newsletterText': 'Offers and news, straight to your inbox.',
  'theme.footer.subscribe': 'Subscribe',

  'theme.hero.shopNow': 'Shop now',
} as const satisfies Messages
