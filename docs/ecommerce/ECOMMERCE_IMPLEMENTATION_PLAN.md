# E-commerce Implementation Plan

Phases are numbered **E1–E14** so they never collide with the POS roadmap (Phases 1–10 in the README). Each phase ends with: app running, backend + frontend tests green **on PostgreSQL**, Playwright for the slice, docs + CHANGELOG updated, and a checkpoint with the owner before the next phase.

## 0. Preconditions (before E4 code)

1. ✅ POS Phase 6 committed (`653e5e1`, 2026-10-31).
2. ☐ PostgreSQL run of the full backend suite — still blocked: `fe_sendauth: no password supplied` (local `DB_PASSWORD` blank).
3. ✅ E1 decisions accepted as recommended → DECISIONS.md.
4. Branch `ecommerce/e4-storefront-shell` off the committed Phase 6 branch.

## 1. Re-ordering versus the brief

The brief puts "admin management" (its Phase 10) and "CMS, banners, navigation, homepage builder" (its Phase 11) **after** the storefront pages. That conflicts with two non-negotiables: the storefront may not show hardcoded content, and no UI ships without working endpoints. So every phase below is a **vertical slice**: migration → module → admin screen → storefront UI → tests. The brief's Phases 10/11 become hardening/expansion phases rather than the first time admin exists.

## 2. Phases

| # | Phase | Delivers | Exit criteria |
|---|-------|----------|---------------|
| E1 | Existing project analysis | These five documents | Owner approves decisions in §3 |
| E2 ✅ | Reference investigation | UI_REFERENCE_ANALYSIS.md filled with evidence (Playwright on the public demo; screenshots kept outside the repo): global look, header/footer, 15 homepage section types, card, shop, product page, other pages, interaction status, component map, AA-checked tokens | Owner approves visual direction |
| E3 ✅ | Architecture & DB sign-off | DECISIONS.md (ADR-001…017), API_PLAN.md (permissions, endpoints, error codes, OpenAPI tags); DB plan corrected against the code | Owner sign-off |
| E4 ✅ | Storefront shell | Vite second entry, admin under `/admin`, Laravel shell route with server meta; `Storefront` module (settings, domains, theme settings, menus/menu items, announcement bar), `Media` module (upload, renditions); `ResolveStorefront`; public `GET /store/bootstrap` (theme + menus + settings in one call, ETag); admin screens: Store settings, Theme, Menus, Media library; storefront header (announcement, logo, desktop + mega + mobile menu, sticky), footer, 404, theme CSS variables from API | Changing theme colour/logo/menu in admin is visible on the storefront without a deploy (Playwright) |
| E5 | Content & homepage | `Cms` module (pages, FAQ, contact form, newsletter), banners/sliders, homepage sections + items with per-type config schemas, schedule windows; admin homepage builder (list, add, edit, duplicate, enable, reorder, preview) and banner manager; storefront homepage renderer (hero slider, banner grid, category grid, product carousels/tabs, hot deals countdown, brand strip, blog teaser, newsletter, rich text), CMS page route | Brief checks 1, 2, 5, 6 pass; empty sections never render |
| E6 | Catalog & product page | `OnlineCatalog` (listings, slugs, SEO, publish schedule, featured, specs, compare-at, variant images, related/FBT), attribute dictionary, facets (category, brand, price range, attributes, availability), sorting, search + suggestions (`pg_trgm`), `product_stats` job; admin "Online" tab in product editor, category/brand web fields, attributes screen; storefront shop/category/brand/search pages (grid/list, filters, sort, pagination, breadcrumbs, quick view), product page (gallery + zoom, variant selector updating price/SKU/stock/images, tabs, related, recently viewed (local)) | Brief checks 7–10 pass; filters return real counts |
| E7 | Customers, cart, wishlist | `CustomerAccounts` (register, login, logout, verify e-mail, reset password, profile), addresses with BD geography, `Cart` (guest token + customer cart, merge on login, reprice on every read), wishlists (guest local → merge); storefront mini-cart, cart page, wishlist page, account shell | Cart totals equal server totals; guest → login merge tested |
| E8 | Checkout, orders, payments | `Shipping` (zones, methods, rates, COD fee), `Promotions` (automatic discounts, coupons, flash sales; countdown data for E5 hot deals), `Orders` (placement transaction, expiry job, status machine, status history, e-mails), `OnlinePayments` (COD, bank transfer, then SSLCommerz sandbox, bKash sandbox, Nagad sandbox as credentials arrive), ledger extensions; storefront checkout (guest or login, addresses, shipping, coupon, payment choice, confirmation page) | Brief check 13–14: order placed, stock deducted once, idempotent retry, failed payment restocks after expiry; webhook replay safe |
| E9 | Customer account area | Order history, order detail + tracking, re-order, addresses, wishlist, profile/password, review submission (verified purchase) | Customer A can never read customer B's data (tests) |
| E10 | Admin operations | Orders board (filters, status transitions, packing slip/invoice print, shipment + tracking, COD remittance, cancel/refund), online returns/refunds, reviews moderation, customers' web activity, promotions reports | Full order lifecycle driven from admin |
| E11 | CMS depth | Blog (categories, posts, listing, detail), TipTap editor + HTMLPurifier, menu links to pages/blog, section duplication/scheduling polish, popup banner | All "additional pages" from the brief exist and are editable |
| E12 | SEO, localization, performance | Server-rendered meta/OG/JSON-LD for product, category, page, blog; canonical; `sitemap.xml`, `robots.txt`; Bangla UI dictionary + content translations; responsive images (`srcset`), lazy loading; cache tags + invalidation; query review (EXPLAIN on listing/facet queries); Lighthouse budget | Lighthouse mobile ≥ 85 perf, 100 SEO on product page; sitemap valid |
| E13 | AI features | Provider abstraction (existing AI_INTEGRATION.md design), product description + SEO generation with human approval, category suggestions, recommendations (co-purchase from `order_lines`, no LLM needed), support assistant over CMS/FAQ + the customer's own orders (tool-scoped), NL reports over whitelisted report definitions | Storefront works with AI disabled; nothing auto-publishes |
| E14 | Regression & hardening | Full Playwright customer + admin journeys (all 14 brief checks), POS regression suite, security review (OWASP, authz matrix, upload fuzzing, webhook spoofing), load test of listing + checkout | All suites green on PG; security findings closed |

## 3. Decisions needed at the E1 checkpoint

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | When does e-commerce start relative to POS Phases 7–10? | Finish/commit POS Phase 6 → run PG → start E2. Fold POS Phase 7 (reports) into E10 and Phase 8 (AI) into E13 to avoid building them twice. |
| Q2 | Storefront tenancy (D1) | Per organization, resolved by host (`storefront_domains`). |
| Q3 | Online order document (D3) | Own `orders` document; not converted into POS invoices. |
| Q4 | Admin URL (D7) | Admin moves under `/admin`; storefront at `/`. |
| Q5 | SEO approach (D8) | Laravel-rendered shell with server meta; no Node SSR for now. |
| Q6 | New dependencies | Frontend: `embla-carousel-react` (sliders), TipTap (E5). Backend: `ezyang/htmlpurifier` (E5); renditions with PHP GD (no package, E4). No payment SDKs — providers' REST APIs via Laravel HTTP client. |
| Q7 | Category depth | Keep `MAX_DEPTH = 4` (mega menus need bounded depth) instead of "unlimited". |
| Q8 | Payment gateway credentials | Needed per provider before its integration: SSLCommerz sandbox store id/password, bKash tokenized sandbox app key/secret/username/password, Nagad merchant id + keys. COD and bank transfer need none. |
| Q9 | Demo imagery and fonts | Theme demo photos are not licensed for reuse. Seed data needs images you own or a permissive source (e.g. Unsplash licence) — or seed without images. Fonts: open-licence fonts self-hosted via Fontsource. |
| Q10 | REA installation (E2) | `npx rea-agents setup` adds an MCP server to Claude Code config and needs Node ≥ 22 + Chrome. Use it only to observe the public live preview (layout, DOM structure, interactions), not to extract theme source. Alternative: Playwright screenshots + DevTools, already installed. |

## 4. What will *not* be built (unless asked)

Multi-currency, multi-warehouse order splitting, marketplace/vendors, subscriptions, product bundles/kits, product comparison (not in the reference either), drag-and-drop visual page builder (structured sections instead), offline PWA checkout, native apps.

## 5. Estimate

Each of E4–E11 is comparable to one POS phase (several working sessions). E12–E14 are smaller but cross-cutting. Gateway phases depend on external sandbox access.
