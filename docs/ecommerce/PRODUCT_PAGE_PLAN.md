# Product variants & product page — plan and as built

User request (2026-11-13, Bangla, translated): improve the online store's product variations, colouring and single product
page. The user chose every option offered; the work is split into two phases.

## P1a — Variants & colours (as built, 2026-11-13)

- **Variant grid** (admin product editor): options → generate combinations (≤200; matched by option values so saves are
  repeat-safe), spreadsheet-like editing, bulk edits with exact decimal maths, opening stock and adjustments through the Inventory
  module only. Products declares the `VariantStock` (Inventory) and `VariantWebData` (OnlineCatalog) contracts with do-nothing
  defaults, keeping the dependency direction (Inventory and OnlineCatalog depend on Products).
- **Photos per colour:** `products.photo_option`, `products.option_styles`, `product_option_images` (≤8 per value). Storefront
  gallery by colour, photo/colour chips, card swatches with hover/focus preview.
- **Stock per option:** `stock_left` only when 0 < qty ≤ 5; sold-out choices crossed out but selectable; back-in-stock requests
  (`back_in_stock_requests`, partial unique index per open variant and e-mail, `site_url` for the link) mailed once through the
  Inventory event `StockBecameAvailable` (fulfilment store only, each request claimed with a conditional update).
- **Size guides:** `size_guides`, `size_guide_categories` (one guide per category, inherited by subcategories),
  `product_listings.size_guide_id` override; accessible dialog with a real table.
- **Product editor:** *Save details* and *Save variants* are separate; the create form has one price row, options come after.

## P1b — Product page (as built, 2026-11-14)

- **Buy now + quick-buy bar:** shared buy state (`cart/buy-box.ts`) for the form and the bar; the bar docks at the bottom once the
  buy buttons scroll out of view (also when they slide under the sticky header), sits above B8b bottom bars
  (`--sf-popup-bar-bottom`), pads the store frame so the page end stays reachable, and is inert while the form is visible. Buy now
  is on the product page only (not quick view / spotlight).
- **Delivery note:** server-built from active shipping zones/methods (common fee or null = "depends", common free-over threshold),
  cached and refreshed when shipping or payment methods change. Zone names have no Bangla field yet.
- **Gallery:** video as the last slide (click to load; privacy-enhanced embeds), pointer-event zoom (pinch, double-tap, wheel,
  keys, drag), side thumbnails, owner badges (`badge-colors.ts` keeps AA contrast). The video parser moved to `Shared\Domain\VideoUrl`.
- **Layout:** `layout.product` theme keys (Theme page card + Site styles drawer share `ProductLayoutFields`); product zones
  `product.below_price` (summary column), `product.after` (unchanged place) and `product.bottom` (page end) with
  `@category:` / `@product:` versions resolved server-side into the product payload (bootstrap keeps the untargeted zones); the
  editor canvas samples the product page around the zone and shows the matching product.
- **More to sell:** `product_affinities` from `OrderBaskets` + `SaleBaskets` (180 days, score ≥ 2, top 20, baskets ≤ 30 products),
  nightly per organization; FBT hand-picked first, else automatic (≤4), shared add-several logic with the B8a bundle; related
  fallback; product questions in the Reviews module (`reviews.*` permissions, bell, one e-mail on first publish).
