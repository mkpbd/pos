# Visual store builder — delivery report (B1–B5)

Date: 2026-11-12 · Branch `phase-8-ai` · Plan and as-built notes: [STORE_BUILDER_PLAN.md](STORE_BUILDER_PLAN.md) · Earlier theme demos: [STOREFRONT_THEMES_REPORT.md](STOREFRONT_THEMES_REPORT.md)

The no-code store builder (brief §14) is built into the existing POS and online store. A shop owner designs their own store: the home page, content pages, landing pages, header, footer, the shop and product page areas, and the site-wide colours and fonts. They drag and drop real storefront components, style them per device, preview them in a real storefront canvas, and publish when ready. Drafts never touch the live store, every publish is versioned, and each organization can only see and change its own designs. With nothing published in the builder, every store renders exactly as before.

## 1. What a client can do (brief §A–§K)

| Brief | Delivered |
|---|---|
| **A. Drag & drop editor** | Full-screen editor:<br>• **Left panel:** Add (grouped, searchable elements), Layers (tree, drag, keyboard drag, hide, duplicate, delete) and Templates.<br>• **Centre:** the real storefront in an iframe at 1366 / 768 / 375 px, with drop indicators across the iframe, a selection mini toolbar (move, duplicate, hide, delete, save as template) and drag-resizable columns.<br>• **Right panel:** the inspector (Content / Style / Advanced).<br>• **Top toolbar:** undo / redo, autosave, preview, publish, discard and version history. |
| **B. Components** | • **Layout:** section with 1–6 column presets, inner row, spacer, divider.<br>• **E-commerce:** product grid, carousel and tabs, categories, brands, search box, promoted product, cart icon.<br>• **Marketing:** hero slider, banners, countdown and hot deals, newsletter, testimonials, discount with coupon copy, call to action.<br>• **Content:** heading, text, image, video (click-to-load, privacy-enhanced), icon, button, FAQ list, contact form, and custom HTML (sanitized; own permission).<br>• **Site parts:** logo, menu, account, wishlist, cart, language switch, announcement, social icons, payment icons, contact details, copyright. |
| **C. Colour & styling** | • **Colour:** solid colours, theme colours, palettes (8 built-in plus up to 8 of the store's own), HEX, RGB(A) and opacity.<br>• **Backgrounds:** linear and radial gradients (2–5 stops), images with an overlay.<br>• **Typography:** font, size, weight, line height, letter spacing, align, transform.<br>• **Box:** margin and padding, size, gap and alignment, border and per-corner radius.<br>• **Effects:** box and text shadows, opacity, hover effects.<br>• **Global colour roles:** primary, secondary, background, text, heading, button, button hover, border, link, sale badge. |
| **D. Responsive** | • Desktop / Tablet / Mobile editing with per-device overrides, "inherited / set here" indicators and reset.<br>• Per-device visibility and column widths.<br>• Products per row per device (default 3 / 3 / 2). |
| **E. Live preview** | Every change shows in the canvas without saving or reloading; site styles preview instantly too. |
| **F. Theme customization** | • The three demo looks (Vegan, Handmade, Classic) are starting points ("Start from a demo look").<br>• The home page, header, footer, product cards (theme), category / listing areas, colour schemes, banners and images can all be changed, and additional pages added.<br>• 46 professionally designed templates are included. |
| **G. Page management** | • Home, Shop (zones and columns), and About / Contact / FAQ / Privacy / Terms (any CMS page) in the builder.<br>• Custom landing pages at `/p/<slug>`.<br>• Each page has its own document, draft and versions. |
| **H. Header & footer** | Builders for both, started from today's layout. The header is used from 768 px; phones keep the compact header. |
| **I. Save / undo / publish** | • **Saving:** autosave, manual flush, undo / redo (100 steps), draft preview on the real store.<br>• **Publishing:** publish with a note, publish all, discard, version history with restore.<br>• **Protection:** a guard against leaving with unsaved changes, and a conflict dialog when another tab saved first. |
| **J. Persistence** | • Validated JSON documents (`builder_documents` / `builder_versions`; never stored as HTML).<br>• Per store, page or part: sections → columns → elements with styles, responsive overrides, order, visibility and schedules.<br>• Draft and published versions.<br>• Tenant-scoped on every endpoint, with tests. |
| **K. Usability** | Plain labels and tooltips, presets and templates first, advanced options collapsed, confirmations before destructive actions, Bangla content fields, and a Bangla user manual (§17.3–§17.7). |

## 2. Acceptance criteria (brief §L)

| # | Criterion | Evidence |
|---|---|---|
| 1 | A client can create a storefront from an existing demo | `e2e/builder-acceptance.spec.ts` "§L1": Demo Mart uses *Start from a demo look → Classic → Create drafts → Publish all*. The store becomes the Classic look with a builder home page, header and footer. Backend `BuilderTemplatesApiTest` covers start-from-demo for every look. |
| 2 | A client can drag and drop sections | acceptance "§L2": drag a Heading from Add onto the page. `e2e/demo-stores.spec.ts` "B2": the Mati & Co. owner drags in a heading and publishes. Mocked `store-builder.spec.ts`: drag into the canvas and Layers, plus keyboard drag. |
| 3 | Add, remove, duplicate and reorder components | acceptance "§L3": duplicate, delete with confirmation, move down / up. Mocked spec: Layers reorder, duplicate, hide; template insert. |
| 4 | Change colours, gradients, fonts, shadows and spacing | acceptance "§L4": a gradient background shows live in the canvas and on the store. Mocked spec and vitest: every style control (colours, gradients, typography, spacing, border, shadow, hover), Site styles. Theme draft tests. |
| 5 | Customize Desktop, Tablet and Mobile layouts | acceptance "§L5": the heading is 48 px on computers and 22 px on phones only, measured on the live store at 1366 and 375 px. Mocked spec: column drag-resize and device widths. |
| 6 | Changes appear in real-time preview | acceptance "§L6": typed text appears in the canvas before any save. Mocked spec: style and site-style changes show instantly. |
| 7 | Changes can be saved as drafts | acceptance "§L1" / "§L2": drafts and autosave are not visible to shoppers. demo-stores "B2", "B4"; integration "theme…" (a saved theme draft is not live). |
| 8 | Published designs appear on the live storefront | acceptance "§L1", "§L8"; demo-stores "B1" (an imported homepage looks identical), "B2", "B4" (footer and About page); integration theme publish. |
| 9 | Previous versions can be restored | acceptance "§L9": restore version 1 to the draft, publish, the heading is gone. Backend tests for versions and restore on documents and the theme. |
| 10 | Store configurations are isolated between clients | acceptance "§L10": another store's owner gets 404 and the document isn't in their list; their store doesn't show it. Backend tenant-isolation tests on every builder, theme and template endpoint; demo-stores "Demo Mart sees none…". |
| 11 | Existing POS functionality remains unchanged | Full-stack `integration.spec.ts` 24/24 (POS sales, returns, purchasing, inventory, web orders, COD, reports, AI and more) on PostgreSQL with the demo stores. The backend suite is green. With nothing published, the builder renders the classic pages: 7,596-element style parity check at B3, and grid parity at B4. |

## 3. Test results (final, 2026-11-12)

| Suite | Result |
|---|---|
| Backend PHPUnit, PostgreSQL `pos_test` | 891 tests: 890 pass, 1 opt-in skip |
| Backend PHPUnit, SQLite | 891 tests: 885 pass, 6 skip |
| Pint, typecheck, lint, build | clean |
| Vitest | 148 files, 1261 tests pass |
| Mocked Playwright (all specs, desktop + mobile) | 202 passed, 100 skipped (opt-in full-stack specs) |
| Full-stack integration (PostgreSQL + demo stores) | 24 / 24 |
| Full-stack demo stores | 8 / 8 |
| Full-stack builder acceptance | 4 / 4 |

**Notes:**
- **Run frontend tests from `D:\`:** they must be run from an uppercase path (`D:\Learning\pos\frontend`). From a lowercase `d:\` working directory, every vitest file fails with "failed to find the current suite".
- **Single-threaded dev server:** the full-stack specs run against `php artisan serve`, which handles one request at a time on Windows. Under heavy machine load (other applications), tests can time out at random steps. The full-stack specs therefore use 15 s assertions and 60–180 s per test. The results above were taken at normal load.

## 4. Upgrade steps for an existing installation

1. `php artisan migrate` — the B1 tables `builder_documents`, `builder_versions`, `builder_templates`. Additive only.
2. `php artisan pos:permissions:sync` — adds `storefront.publish` and `storefront.custom_html` to the built-in roles. Without it, nobody can publish.
3. Nginx: map `/admin/builder-canvas` to `dist/builder-canvas.html` (DEPLOYMENT_GUIDE). If a CSP is used, allow `frame-src 'self'`.
4. Optional, local or demo only: `php artisan db:seed --class=DemoThemesSeeder` for the three demo stores (see README).

## 5. Known limitations

- **Header on phones:** the builder header is used from 768 px; phones keep the store's compact header and drawer.
- **Functional pages:** product, cart, checkout and account pages stay functional pages. They are customized through zones, theme settings and the header and footer, not freely.
- **Brand templates:** the two brand templates have no screenshot, because the demo stores have no brands.
- **Divider colour:** the divider's colour field in the Content tab uses the simple theme-colour select.
- **Full width on smaller devices:** "Fill the column width" can't be turned off on a device that inherits 100 % width from a larger one.
- **Deleted CMS pages:** deleting a CMS page leaves its builder design behind, listed without a page.
- **Version restore:** restoring a version doesn't re-check the custom-HTML permission, because that HTML was allowed when it was saved.
- **Open bug (not from the builder):** under heavy machine load, the admin *New product* form once lost typed prices and barcode after choosing a unit. It was not reproducible at normal load; to be investigated.
