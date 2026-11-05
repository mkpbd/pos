import type { Messages } from '../types'

/** The wishlist page and the heart toggle. */
export const wishlist = {
  'wishlist.title': 'Wishlist',
  'wishlist.localNote': 'Your wishlist is saved in this browser. {signIn} to keep it in your account.',
  'wishlist.signIn': 'Sign in',
  'wishlist.loadFailed': 'Your wishlist could not be loaded. Please try again.',
  'wishlist.loading': 'Loading your wishlist',
  'wishlist.empty': 'Your wishlist is empty.',
  'wishlist.emptyHint': 'Tap the heart on a product to save it for later.',
  'wishlist.startShopping': 'Start shopping',
  'wishlist.savedProducts': 'Saved products',
  'wishlist.updateFailed': 'The wishlist could not be updated. Please try again.',
  'wishlist.full': 'Your wishlist is full ({max} products). Remove something to add more.',
  'wishlist.moveToCartLabel': 'Move {name} to the cart',
  'wishlist.moveToCart': 'Move to cart',
  'wishlist.chooseOptionsLabel': 'Choose options: {name}',
  'wishlist.chooseOptions': 'Choose options',
  'wishlist.removeLabel': 'Remove {name}',
  'wishlist.remove': 'Remove',

  'wishlist.button.addLabel': 'Add {name} to the wishlist',
  'wishlist.button.removeLabel': 'Remove {name} from the wishlist',
  'wishlist.button.add': 'Add to wishlist',
  'wishlist.button.saved': 'Saved to wishlist',
  'wishlist.button.removeTitle': 'Remove from wishlist',
} as const satisfies Messages
