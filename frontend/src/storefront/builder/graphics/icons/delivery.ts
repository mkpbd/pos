import { circle, rect, type IconDrawing } from './shapes'

/* Delivery: trucks, vans, a cargo rickshaw van, a delivery motorbike, parcels and places. */
export const DELIVERY_ICONS = {
  delivery_truck: [
    rect(4, 12, 24, 18, 2),
    'M28 17h8l6 7v6H28',
    'M33 17v7h9',
    circle(13, 34, 4),
    circle(35, 34, 4),
  ],
  delivery_van: [
    'M9 30H4V16a4 4 0 0 1 4-4h20l8 8h4a4 4 0 0 1 4 4v6h-5',
    'M17 30h14',
    'M28 12v8h8',
    'M8 20h12',
    circle(13, 31, 4),
    circle(35, 31, 4),
  ],
  rickshaw_van: [
    rect(4, 14, 20, 13, 2),
    'M24 27h8l5 7',
    'M28 27v-7',
    'M25 20h6',
    'M32 27l3-10h5',
    circle(14, 35, 5),
    circle(38, 35, 5),
  ],
  motorbike_delivery: [
    rect(5, 12, 13, 10, 2),
    'M11 34l5-10h13l3 10',
    'M29 24l3-8h5',
    'M18 24h9',
    circle(11, 34, 5),
    circle(37, 34, 5),
  ],
  parcel: ['M24 6l16 8v20l-16 8-16-8V14z', 'M8 14l16 8 16-8', 'M24 22v20', 'M16 10l16 8v6'],
  parcel_open: ['M10 22v16l14 6 14-6V22', 'M10 22l14 6 14-6', 'M24 28v16', 'M10 22L5 15l14-6 5 7', 'M38 22l5-7-14-6-5 7', 'M24 4v4'],
  location_pin: ['M24 43s-13-12.5-13-23a13 13 0 0 1 26 0c0 10.5-13 23-13 23z', circle(24, 20, 5)],
  map: ['M6 12l11-4 14 4 11-4v28l-11 4-14-4-11 4z', 'M17 8v28', 'M31 12v28'],
} satisfies Record<string, IconDrawing>
