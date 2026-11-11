# Storefront theme demos — delivery and testing report (T1–T3)

Date: 2026-11-11 · Branch `phase-8-ai` · Plan: [STOREFRONT_THEMES_PLAN.md](STOREFRONT_THEMES_PLAN.md) · Next: [STORE_BUILDER_PLAN.md](STORE_BUILDER_PLAN.md)

Three online-store demos — **Green Basket** (vegan), **Mati & Co.** (handmade), **Classic Shop** (classic) — run on the existing storefront and POS backend. Each is an ordinary organization with its own host, catalog, stock, promotions and content. There is no second shop engine, no schema change and no SQL migration: the theme layer lives in the existing theme JSON.

## 1. What was built

| Phase | Delivered |
|---|---|
| **T1 — theme engine** | `preset` + layout keys in `ThemeSchema` (header, footer, card, hero, heading case, top bar), four presets (`ThemePresets`, WCAG AA unit-tested), `GET /storefront/theme/presets`, `POST …/{preset}/apply`, header / top-bar / footer / product-card / hero variants, Playfair Display + Jost fonts, admin preset picker. |
| **T2 — demo stores** | `DemoThemesSeeder` (dev only, idempotent, one transaction per store) with 55 products, variants, photos, stock, sale prices, flash sales, coupons, menus, banners, homepages, pages, blog and verified reviews; demo gallery (`GET /api/v1/demo-stores`, page `/demos`, off by default, never in production); banner text scrim; Vite proxy forwards the browser host for local demo hosts. |
| **T3 — polish and verification** | Visual pass of all three demos and Demo Mart at 1366 / 768 / 375 px (home, category, filters, product, cart, checkout, blog, pages, search, account, 404, menus, quick view, mini cart, empty and error states). Fixes listed in §3. Full-stack E2E per demo, the Bangla manual (§17.1–17.2, screenshots 38–42) and this report. |

## 2. How to run the demos

```bash
cd backend
php artisan migrate:fresh --seed                 # or an existing dev database
php artisan db:seed --class=DemoThemesSeeder     # adds the three demo organizations; re-running skips existing ones
```

In `backend/.env`, set `TRUSTED_PROXIES=127.0.0.1` and `STOREFRONT_DEMO_GALLERY=true`, and add `*.shop.localhost:5173` to `SANCTUM_STATEFUL_DOMAINS` (see `.env.example`). Then open http://localhost:5173/demos, or http://vegan.shop.localhost:5173, http://handmade.shop.localhost:5173 or http://classic.shop.localhost:5173. Owner logins (password `password`): `owner@greenbasket.test`, `owner@mati.test`, `owner@classicshop.test`. Coupons: `GREEN10`, `MATI15`, `CLASSIC20`.

## 3. T3 fixes (shared storefront code — every store benefits)

1. Star ratings: theme-aware `--sf-star` / `--sf-star-empty` variables plus `.sf-on-dark`; stars on the dark classic footer are now clearly visible.
2. Hero and banner buttons: a button whose theme colour would vanish on the scrim is inverted (classic "Shop the sale" is white on the dark photo). A slide with no image gets a background that contrasts with its text.
3. Category and brand strips are centred when they don't scroll; the first rail item is no longer offset 4 px.
4. Grids: the lone last banner tile spans the row at 768 px; 3 testimonials or 3 posts sit in one row; the 3-block footer uses 3 columns (no empty 4th).
5. Card buttons at 375 px no longer wrap to two lines.
6. Discount amounts in cart, mini cart and checkout no longer split across lines.
7. Phone header store name follows the preset (uppercase classic, serif handmade).
8. The search field follows the theme's button shape.
9. Hero slide dots have 24 px tap targets and stay visible on light photos.
10. Empty and error states use consistent 44 px buttons and clearer text in every preset.
11. Rich text that starts with a heading loses its extra top gap.

Demo Mart (default preset) keeps its look; only the bug fixes in items 4, 6, 9 and 10 change it.

## 4. Test results (2026-11-11)

| Suite | Result |
|---|---|
| Backend PHPUnit, PostgreSQL `pos_test` | 775 tests: 774 pass, 1 opt-in skip (PDF) |
| Backend PHPUnit, SQLite in-memory | 775 tests: 769 pass, 6 skip |
| Pint | clean |
| Frontend vitest | 120 files, **933 pass** |
| typecheck / lint / build | clean |
| Mocked Playwright (all specs, desktop + mobile) | **174 pass**, 68 skip (opt-in full-stack specs) |
| Full-stack integration (`integration.spec.ts`, fresh PostgreSQL + demo stores) | **24 / 24** |
| Full-stack demo stores (`demo-stores.spec.ts`) | **5 / 5**: gallery; for each demo browse → menu category → "On sale" filter → variant → quantity → coupon (server discount = coupon % of subtotal; UI total = server total) → guest COD checkout → owner sees the order with the coupon → variant stock down by the quantity; Demo Mart's owner sees none of the demo orders |
| Seeder feature test | 3 orgs, counts, stock via ledger, prices, coupon, flash sale, sections, menus, pages, reviews, preset, Demo Mart counts unchanged, idempotent re-run, production refusal, guest checkout on a demo host |

**Test-only changes in `integration.spec.ts`:** the repricing test (10 checks in one flow) now has a 90 s budget. The two checkout confirmations wait up to 15 s. Reason: `php artisan serve` handles one request at a time on Windows, so in the suite an order waits behind the page's image requests. Measured directly, a Demo Mart checkout takes 1.7 s (click → confirmation), with no database query over 80 ms.

## 5. Known limitations

- The UPPERCASE classic store name is cut off on 320 px phones (fine from 360 px).
- Classic's sale-hero buttons use the "rounded" button radius while its cards use 4 px: these are theme values, and editable.
- The handmade "Artisan Gift Box" is deliberately out of stock and still appears in the footer's "New arrivals" widget.
- Path-based demo URLs (`/store/vegan`) were not built; the project's tenancy is one store per host (plan §3.4).
- Payment gateways for the demos are COD and bank transfer only (online gateways wait for credentials, E8c).

## 6. Files changed (T1–T3, since commit 58c18d7)

**Backend:**
- **Storefront module:**
  - Domain: `ThemeSchema`, `ThemePresets`
  - Application: `ApplyThemePreset`, `Queries/DemoStoreGallery`, `StorefrontBootstrap`
  - Presentation: `DemoGalleryController`, `StorefrontAdminController`, `ResolveStorefront`, `SaveThemeRequest`, `StorefrontPresenter`, routes `api.php` and `web.php`
  - Tests: `ThemePresetsTest` (feature and unit), `DemoGalleryTest`, `StorefrontPublicTest`
- **Other:**
  - `config/storefront.php`, `.env.example`
  - `database/seeders/DemoThemesSeeder.php` and `demo-themes/{vegan,handmade,classic}.php`
  - 93 images plus `manifest.json` in `demo-themes/images/`
  - `tests/Feature/DemoThemesSeederTest.php`

**Frontend — storefront (`src/storefront`):**
- `theme.ts`, `types.ts`, `storefront.css`, `color.ts`, `routes.tsx`
- Components:
  - New: `top-bar`, `footer-variants`, `footer-parts`, `use-media-query`
  - Changed: `site-header`, `site-footer`, `storefront-layout`, `main-nav`, `header-actions`, `header-search`, `state-views`
- Catalog:
  - New: `product-card-variants`, `card-parts`, `card-pricing`
  - Changed: `product-card`, `product-rail`
- Sections:
  - New: `banner-colors`
  - Changed: `hero-slider`, `banner-content`, `banner-grid`, `content-sections`, `product-sections`, `section-heading`
- Pages: `home-page`, `listing-page`, `product-page`, `content-page`
- Blog: `blog-card`, `blog-pages`
- Cart and checkout: `add-to-cart`, `cart-lines`, `summary-totals`
- Other: `reviews/stars`; `demos/` (gallery page, api, links, locale); i18n `theme`, `demos` and `checkout` in English and Bangla
- Tests: `storefront-themes`, `storefront-demos`, `banner-content`, plus updated suites

**Frontend — admin (`src/features/storefront`):** `api.ts`, `theme-form.ts`, `pages/theme-page.tsx`, `theme-presets.test.tsx`, `components/banner-form.tsx`, `section-editor.tsx`, `banners-page.tsx`.

**Frontend — other:**
- `vite.config.ts` (`xfwd`)
- `package.json` (2 font packages)
- e2e:
  - New: `storefront-themes`, `demo-gallery`, `demo-stores`
  - Changed: `storefront-admin`, `integration`, `manual-shots`

**Docs:**
- `STOREFRONT_THEMES_PLAN.md`, `STORE_BUILDER_PLAN.md`, this report, `DEMO_IMAGE_CREDITS.md`
- `API_DOCUMENTATION.md`
- `USER_MANUAL.bn.md` plus images 38–42
- `README.md`, `CHANGELOG.md`
