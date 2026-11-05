import type { Messages } from '../types'

/** Header search, main navigation, footer, announcement / preview ribbon and the contact form. */
export const shell = {
  'shell.preview.ribbon': 'Preview — this store is not open to customers yet.',

  'shell.search.form': 'Products',
  'shell.search.label': 'Search products',
  'shell.search.placeholder': 'Search products…',
  'shell.search.submit': 'Search',
  'shell.search.suggestions': 'Suggestions',
  'shell.search.products': 'Products',
  'shell.search.categories': 'Categories',
  'shell.search.searchFor': 'Search for “{term}”',
  'shell.search.noMatches': 'No matching products.',
  'shell.search.searching': 'Searching…',
  'shell.search.noSuggestions': 'No suggestions',
  'shell.search.available': { one: '{count} suggestion available', other: '{count} suggestions available' },

  'shell.nav.main': 'Main',

  'shell.footer.paymentMethods': 'Payment methods',
  'shell.footer.contactUs': 'Contact us',
  'shell.footer.social': 'Social media',
  'shell.footer.newTab': '(opens in a new tab)',
  'shell.footer.copyright': '© {year} {store}',

  'shell.contact.form': 'Contact form',
  'shell.contact.name': 'Your name',
  'shell.contact.email': 'E-mail',
  'shell.contact.phone': 'Phone (optional)',
  'shell.contact.subject': 'Subject (optional)',
  'shell.contact.message': 'Message',
  'shell.contact.website': 'Website',
  'shell.contact.nameRequired': 'Please enter your name.',
  'shell.contact.emailInvalid': 'Please enter a valid e-mail address.',
  'shell.contact.messageTooShort': 'Please write at least {min} characters.',
  'shell.contact.sending': 'Sending…',
  'shell.contact.send': 'Send message',
  'shell.contact.sendAnother': 'Send another message',
} as const satisfies Messages
