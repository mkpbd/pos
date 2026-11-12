import type { Messages } from '../types'

/** The demo store gallery (/demos, T2): a page outside any store, linking to the demo stores. */
export const demos = {
  'demos.title': 'Online store demos',
  'demos.intro': 'Ready-made demo stores, each in its own theme: open one to browse the catalogue, try the cart and place a test order.',
  'demos.adminHint': 'To manage a demo, sign in to the admin with its owner account from the setup guide. Logins are not shown here.',
  'demos.list': 'Demo stores',
  'demos.loading': 'Loading the demo stores',
  'demos.errorTitle': 'The demo stores could not be loaded',
  'demos.errorText': 'Check your connection and try again.',
  'demos.disabled': 'Demo gallery is not enabled on this server.',
  'demos.empty': 'No demo stores have been set up yet. Run {command}.',

  'demos.preset': 'Theme: {preset}',
  'demos.preset.default': 'Default',
  'demos.preset.vegan': 'Vegan',
  'demos.preset.handmade': 'Handmade',
  'demos.preset.classic': 'Classic',
  'demos.preset.kids': 'Kids',

  'demos.colors': 'Theme colours',
  'demos.color.primary': 'Primary {value}',
  'demos.color.accent': 'Accent {value}',
  'demos.color.canvas': 'Background {value}',
  'demos.categories': 'Categories',
  'demos.products': { one: '{count} product', other: '{count} products' },

  'demos.openStore': 'Open store',
  'demos.openStoreLabel': 'Open store: {store}',
  'demos.openAdmin': 'Open admin',
  'demos.openAdminLabel': 'Open admin: {store}',
} as const satisfies Messages
