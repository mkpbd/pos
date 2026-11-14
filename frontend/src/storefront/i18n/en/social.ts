import type { Messages } from '../types'

/** P2b social: the share bar, "Order on WhatsApp", the floating chat button and the messages they prefill. */
export const social = {
  'social.share.product': 'Share this product',
  'social.share.page': 'Share this page',
  'social.share.post': 'Share this post',
  'social.share.facebook': 'Share on Facebook',
  'social.share.messenger': 'Send in Messenger',
  'social.share.whatsapp': 'Share on WhatsApp',
  'social.share.x': 'Share on X',
  'social.share.pinterest': 'Save to Pinterest',
  'social.share.copy': 'Copy link',
  'social.share.copied': 'Link copied',
  'social.share.copyFailed': 'The link could not be copied. Copy it from here:',
  'social.share.linkField': 'Link to share',
  'social.newTab': '(opens in a new tab)',
  'social.whatsapp.order': 'Order on WhatsApp',
  'social.whatsapp.chat': 'Chat with us on WhatsApp',
  'social.whatsapp.message.order': 'Hello! I would like to order:',
  'social.whatsapp.message.product': 'Product: {name}',
  'social.whatsapp.message.option': 'Option: {option}',
  'social.whatsapp.message.quantity': 'Quantity: {quantity}',
  'social.whatsapp.message.price': 'Price: {price}',
  'social.whatsapp.message.priceEach': 'Price: {price} each',
  'social.whatsapp.message.chat': 'Hello! I have a question about this page: {url}',
} as const satisfies Messages
