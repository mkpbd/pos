import { circle, rect, type IconDrawing } from './shapes'

/*
 * Contact: phone, chat, a generic chat bubble with a handset (for messaging apps — deliberately not
 * any messaging app's logo: square bubble, tail on the right), mail, support headset.
 */
export const CONTACT_ICONS = {
  phone: ['M10 8l7-2 5 9-4 3c2 5 6 9 11 11l3-4 9 5-2 7C24 38 9 23 10 8z', 'M30 6a12 12 0 0 1 12 12', 'M30 12a6 6 0 0 1 6 6'],
  chat: ['M8 8h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-10 8v-8H8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z', 'M15 21h2', 'M23 21h2', 'M31 21h2'],
  whatsapp_bubble: [
    'M10 6h28a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-4v8l-9-8H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z',
    'M17 13l3-1 2 4-2 1.5c1 2 2.5 3.5 4.5 4.5L26 20l4 2-1 3c-7 0-12-5-12-12z',
  ],
  mail: [rect(4, 10, 40, 28, 3), 'M5 12l19 14 19-14'],
  headset: ['M8 28v-4a16 16 0 0 1 32 0v4', rect(6, 26, 8, 12, 3), rect(34, 26, 8, 12, 3), 'M38 38v1a5 5 0 0 1-5 5h-5', circle(26, 44, 0.5)],
} satisfies Record<string, IconDrawing>
