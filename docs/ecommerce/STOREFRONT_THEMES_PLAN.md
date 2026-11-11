# Storefront theme demos — analysis and plan (T1–T3)

Status: **approved 2026-11-11** — decisions in §5; T1–T3 done ([report](STOREFRONT_THEMES_REPORT.md)); next: the visual store builder, [STORE_BUILDER_PLAN.md](STORE_BUILDER_PLAN.md). Goal: three visually distinct storefront demos — *Vegan Store*, *Handmade Store*, *Classic Shop* — on the existing online store, sharing one e-commerce engine and the existing POS backend.

## 1. What the project already has (reused, not rebuilt)

| Area | Existing implementation | Reuse |
|---|---|---|
| Storefront SPA | `frontend/src/storefront` (second Vite entry): header, mega/mobile menu, search, account, wishlist, mini-cart, catalog with facets, product page with gallery, variants, reviews, quick view, cart, checkout, order pages, blog, CMS pages, English / Bangla | All pages and hooks stay; themes change **presentation only** |
| Tenancy | One storefront per **organization**, resolved by **host** (`storefront_domains`, `ResolveStorefront`) | Each demo = its own demo organization and host |
| Catalog | Products / variants / prices / images (Catalog, Products), online listings (OnlineCatalog), facets: category, brand, price range, in stock, on sale; sorts: featured, popularity, latest, price, name, rating | Demo products are ordinary products |
| Stock | Inventory ledger, fulfilment store per storefront; checkout reserves/deducts stock in a transaction | Unchanged |
| Orders | Orders module (`WEB-…`), COD, bank transfer, shipments, returns, refunds, idempotent checkout | Unchanged |
| Customers | Customers + customer accounts | Unchanged |
| Promotions | Promotions engine: percent/fixed, cart threshold, coupons, flash sales | Unchanged |
| Theme | `ThemeSchema` (colours, heading/body font, button style, card radius, container width, sticky header, logo, announcement bar, footer) + admin *Online store → Theme* | **Extended** with a layout preset |
| Homepage | Builder with 13 section types (hero slider, banner grid, rich text, features strip, testimonials, newsletter, product carousel/grid/tabs, category strip, brand strip, hot deals with countdown, blog posts), banners, menus | Reused; a few section **variants** added |

**Conclusion:** the "common e-commerce engine" and POS integration (requirement §7 of the brief) already exist and are tested (746 backend tests on PostgreSQL, 24 full-stack E2E). The work is a **theme layer** plus **demo content**, not a second shop.

## 2. Reference analysis (layout and UX only — no code, branding or assets copied)

| | Vegan (organic, modern) | Handmade (premium, artisan) | Classic (traditional e-commerce) |
|---|---|---|---|
| Top | Rotating promo ticker; "order by phone" | Slim utility row | Top bar (language, wishlist, social) |
| Header | Logo, categories dropdown + mega menu, search, account, cart | Centered brand, airy menu, few icons | Logo left, wide search centre, account / wishlist / cart-total right; menu row below |
| Hero | Full-width photo slider, lowercase headline, two CTAs | Three editorial promo tiles instead of one hero | Big sale slider (UPPERCASE heavy headline, % off, 3 CTAs) + promo tiles |
| Sections | Feature strip → 4 category image cards → new arrivals grid → lifestyle banner → horizontal product row → flash deals countdown → best sellers compact grid → reviews with average → news → brand banner → newsletter | Trust strip → brand statement → popular categories → newsletter → editor's pick grid → category tiles → seasonal row → artist banners → "for her" grid → journal → newsletter | Featured weekly grid → best sellers grid → categories with counts → service strip → payment logos → testimonials → news |
| Product card | Sale badge, category label, tagline, struck price + % off, variant swatches, add-to-cart | Image-led, name + price (range), "% off" badge, **no buttons** | Second image on hover, wishlist + quick view on hover, category, stars, price, Sale / New / Out of stock badges |
| Type & feel | Rounded friendly sans, lowercase display, greens, soft cards | **Serif** display + light sans, muted earth/cream, lots of whitespace, square corners | Bold uppercase sans, high contrast (dark + one accent), dense grids, small radius |
| Footer | Brand + app badges, link columns, contact, payment logos | Brand + social, product widgets (thumb, stars, price) | 4–5 widget columns: about, news, product lists, tags, newsletter |

## 3. Proposed architecture

### 3.1 Theme preset (one engine, three skins)
- `ThemeSchema` gains `preset: default | vegan | handmade | classic` and a `layout` group:
  `header_style` (`standard | centered | commerce`), `footer_style` (`columns | minimal | widgets`), `card_style` (`standard | minimal | commerce`), `hero_style` (`full | tiles | sale`), `heading_case` (`normal | lowercase | uppercase`), `top_bar` (ticker / utility / none).
  Choosing a preset in the admin fills these + colours + fonts; every value stays individually editable. Stored in the existing theme JSON — **no schema change, no SQL migration**.
- Frontend: `storefront/themes/` registry → `useTheme()` exposes the layout; `SiteHeader`, `SiteFooter`, `ProductCard`, `HeroSlider` pick a variant component. Data hooks, cart, checkout, i18n untouched.
- Fonts: add one serif and one geometric sans (e.g. Playfair Display / Jost) as `@fontsource` packages — the same mechanism the store already uses for Baloo and Poppins. **New dependency — needs your OK.**

### 3.2 Gaps to close while doing it
- Product card: hover second image, % off label, variant price range, swatches on card (Vegan), minimal card (Handmade).
- Listing: grid/list toggle if missing; category counts on category tiles.
- Footer product widgets (latest / best selling / top rated) — new footer block fed by existing product sources.
- Average-rating header on the testimonials section.
- Billing address separate from delivery address: **not added** (Bangladesh COD flow uses one address); listed as optional.

### 3.3 Demo data — strictly separated
- `DemoThemesSeeder` (dev only, refuses in production like `DatabaseSeeder`) provisions **three demo organizations** — *Green Basket* (vegan), *Mati & Co.* (handmade), *Classic Shop* — each with its own domain (`vegan.shop.localhost`, `handmade.shop.localhost`, `classic.shop.localhost`), branch, store, categories, brands, products with variants, opening stock (through the normal stock adjustment action), listings, promotions (flash sale, coupon), banners, menus, homepage sections, reviews, blog posts and theme preset.
- Real organizations are never touched; tenant scoping isolates everything. Removing the demos = not running the seeder (or deleting the demo organizations).
- Images: ~60 product/banner images. **Decision needed** (see §5).

### 3.4 URLs
The project's convention is **one store per host**, so the demos live at their own hosts (above). `/store`, `/store/vegan`… paths would need path-based tenant resolution on every API call — a large, risky change for demo-only benefit. Instead:
- `/admin` → *Online store → Theme* gets a **preset picker with live preview** (preview mode already exists for disabled stores);
- a **demo gallery page** on the platform host listing the three demos with screenshots and links.

## 4. Phases (checkpoint after each)

| Phase | Scope | Done when |
|---|---|---|
| **T1 — Theme engine** | Preset + layout fields (backend schema, validation, tests); header / footer / card / hero variants; fonts; admin preset picker + preview | Existing store unchanged by default; each preset switchable in admin; vitest + PHPUnit + mocked Playwright green |
| **T2 — Demo stores** | `DemoThemesSeeder` with three organizations, catalogs (Vegan: vegetables, vegan food & drinks, natural beauty, fitness, accessories; Handmade: jewellery, ceramics, candles, plants, decorations, gifts; Classic: men, women, shoes, bags, accessories), stock, promotions, content, images; demo gallery | `migrate:fresh --seed` + demo seeder builds all three; each store browsable, orderable end to end |
| **T3 — Polish & verification** | Pixel pass per demo at 375 / 768 / 1366; loading / empty / error states; a11y; full-stack E2E per demo (browse → filter → variant → cart → coupon → checkout → admin sees order, stock down); docs, manual update | Testing report; screenshots of all three |

## 5. Decisions (answered 2026-11-11)

- URLs: **host per demo** + admin preset picker with preview + demo gallery.
- Images: **royalty-free photos** (Unsplash / Pexels licence), credited in `docs/ecommerce/DEMO_IMAGE_CREDITS.md`.
- Fonts: **add two `@fontsource` packages**.

Original questions:
1. **URLs:** host per demo + admin preview + demo gallery (recommended), or path-based `/store/<demo>` (large tenancy change).
2. **Images:** (a) download royalty-free photos (Unsplash / Pexels licence) into the repo, ~10–15 MB; or (b) locally generated original artwork (illustrated / gradient product images, no licence questions, looks less real).
3. **Fonts:** OK to add two `@fontsource` font packages?
