# Visual Store Builder — analysis and architecture (B1–B5)

Status: **approved 2026-11-11** (decisions in §10). **B1–B5 done** — delivered; see §11 and the [delivery report](STORE_BUILDER_REPORT.md). Goal: a drag-and-drop, no-code editor in the admin that lets each organization design its own online store (pages, header, footer, global styles) with draft / publish / version history. It is built on top of the existing storefront, catalog, cart, checkout and POS data, which it does not change.

## 1. What already exists (reused)

| Area | Today | How the builder uses it |
|---|---|---|
| Homepage builder | `homepage_sections` table + `SectionType` enum (13 types: hero slider, banner grid, rich text, features, testimonials, newsletter, product carousel / grid / tabs, category strip, brand strip, hot deals, blog posts), each with a `defaults()` / `normalize()` config document and server-side resolution of products, categories and brands | Each type becomes a builder **element** that keeps its React component, config shape and data source. The legacy homepage remains the fallback until a builder home page is published. |
| Theme | `theme_settings.settings` JSON (`ThemeSchema`): colours, fonts, shape, layout variants, 4 presets (T1), announcement, footer content, custom CSS (`CustomCssPolicy`) | Becomes the **global styles** layer. It gains more colour roles, gradients and responsive type sizes, and gets draft / publish through the builder. |
| CMS pages | `cms_pages` (slug, status, templates default / faq / contact, SEO, translations, sanitized `body_html` via `HtmlSanitizer`) | Page management reuses these pages. A new template, `builder`, renders the page from a builder document instead of `body_html`. |
| Menus, banners, media | Menus with a link-target picker, scheduled banners, a media library (jpeg/png/webp/gif) | Header and footer elements pick menus. Image elements use the media picker. Banner elements reuse banners. |
| Tenancy | `BelongsToOrganization` global scope; storefront resolved by host (`ResolveStorefront`); staff preview (`?preview=1`, no-store cache) | All builder tables are organization-owned. The canvas reuses the staff preview path. |
| Audit, cache bust | `AuditTrail`, `ChangesStorefrontContent` | Publish and restore are audited and bust the storefront cache. |

**Conclusion:** the engine (catalog data, product sources, sections, theme variables, preview, sanitizing) is there. The new parts are a **document model with versions**, a **layout tree** (section → columns → elements), a **structured style system**, and the **editor UI**.

## 2. Core design decisions

1. **Structured JSON, never page HTML.** A page is a validated tree of typed nodes, and the storefront renders it with React components. Styles are structured values (for example `{type:'linear', angle:90, stops:[…]}`), not CSS strings. They are compiled to CSS by one function shared by the canvas and the live store. Custom HTML is the only free-form element: it is sanitized server-side and needs its own permission.
2. **One registry, two sides.** An element registry defines each element's type, allowed parents, props schema, defaults and style groups. PHP (`Domain/Builder/ElementRegistry`) validates and normalizes. TypeScript (`builder/registry.ts`) drives the editor inspector and the renderer. A shared JSON fixture test keeps the two in sync.
3. **Draft ≠ live.** Each document has a mutable **draft** and immutable **versions**. Publishing snapshots the draft into a version and points the document at it. The live store reads only published versions. Restoring copies a version into the draft.
4. **Real storefront in the canvas.** The centre canvas is an **iframe** running the storefront renderer with the real CSS. Device widths (1366 / 768 / 375) are therefore true media-query breakpoints. Edits reach the iframe by `postMessage` (origin-checked) and re-render instantly, with no reload and no save needed.
5. **Functional pages stay functional.** Shop, product, cart, checkout and account pages keep their tested logic. The builder customizes them through **zones** (content above or below), settings (grid columns per breakpoint, card style, filters on the left or top) and the global header and footer. Only Home, CMS pages and landing pages are free-form. This keeps POS, stock and checkout behaviour unchanged (acceptance criterion 11).

## 3. Data model (additive; no change to existing tables except one enum value)

```
builder_documents
  id uuid PK, organization_id uuid FK → organizations (restrict)
  kind        varchar(20)   page | header | footer | theme | zone
  key         varchar(120)  'home' | 'cms:<page_id>' | 'landing:<slug>' | 'header' | 'footer' | 'theme' | 'zone:shop.top' …
  title       varchar(160)
  schema_version smallint   (content format; migrations upgrade old docs on read)
  draft       jsonb          the editable tree
  draft_revision integer     optimistic concurrency (autosave from two tabs → 409)
  draft_updated_at / draft_updated_by
  published_version_id uuid FK → builder_versions (null = never published → legacy fallback)
  timestamps;  UNIQUE (organization_id, key)

builder_versions                 (immutable snapshots)
  id uuid PK, organization_id uuid FK, document_id uuid FK → builder_documents (cascade)
  number integer (per document, 1..n), schema_version smallint, content jsonb
  note varchar(160) null, published_at timestamptz null, created_by uuid, created_at
  UNIQUE (document_id, number)

builder_templates                (organizations' own saved section templates; built-ins ship as files, see §11 B5)
  id uuid PK, organization_id uuid null, scope varchar(20) section|page|site,
  preset varchar(20) null (vegan|handmade|classic|…), name, thumbnail_media_id null,
  content jsonb, timestamps
```

`cms_pages.template` gets the new value `builder` (a varchar/enum value, not a column). Retention: every published version is kept, and draft-only snapshots (autosave checkpoints, "Save version") are capped at the last 30 per document.

**Manual SQL** (PostgreSQL; the same as the Laravel migration; additive only, nothing dropped or rewritten):

```sql
CREATE TABLE builder_documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL,
  key varchar(120) NOT NULL,
  title varchar(160) NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_revision integer NOT NULL DEFAULT 0,
  draft_updated_at timestamptz NULL,
  draft_updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  published_version_id uuid NULL,
  created_at timestamptz NULL, updated_at timestamptz NULL,
  CONSTRAINT builder_documents_org_key_unique UNIQUE (organization_id, key)
);
CREATE TABLE builder_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES builder_documents(id) ON DELETE CASCADE,
  number integer NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  note varchar(160) NULL,
  published_at timestamptz NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NULL,
  CONSTRAINT builder_versions_doc_number_unique UNIQUE (document_id, number)
);
ALTER TABLE builder_documents ADD CONSTRAINT builder_documents_published_fk
  FOREIGN KEY (published_version_id) REFERENCES builder_versions(id) ON DELETE SET NULL;
CREATE INDEX builder_versions_org_doc_idx ON builder_versions (organization_id, document_id);
CREATE TABLE builder_templates (
  id uuid PRIMARY KEY,
  organization_id uuid NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  scope varchar(20) NOT NULL, preset varchar(20) NULL,
  name varchar(120) NOT NULL, thumbnail_media_id uuid NULL,
  content jsonb NOT NULL,
  created_at timestamptz NULL, updated_at timestamptz NULL
);
CREATE INDEX builder_templates_org_scope_idx ON builder_templates (organization_id, scope);
```

## 4. Document format (schema v1)

```jsonc
{
  "sections": [{
    "id": "s_8f2a", "type": "section",
    "props":  { "layout": "boxed", "tag": "section" },          // boxed | full | full-bleed
    "style":  { "base": {…}, "tablet": {…}, "mobile": {…} },     // responsive overrides only
    "visibility": { "desktop": true, "tablet": true, "mobile": false },
    "hidden": false,                                             // editor "eye" toggle
    "columns": [{
      "id": "c_1", "width": { "base": 50, "tablet": 50, "mobile": 100 },   // % of the row; resize handle
      "style": {…},
      "elements": [
        { "id": "e_1", "type": "heading", "props": { "text": "fresh & local", "level": 2 }, "style": {…} },
        { "id": "e_2", "type": "product_grid", "props": { "source": "best_sellers", "limit": 8,
            "columns": { "base": 4, "tablet": 3, "mobile": 2 } } }
      ]
    }]
  }]
}
```

- **Nesting:** section → columns → elements, plus an element `inner_row` (one level deep) for grid or flex layouts inside a column. Moving elements between sections is a move between column `elements` arrays.
- **Style groups** (validated whitelist, each value bounded):
  - background: solid, gradient (linear or radial with stops), image with position, size and overlay
  - colour: hex or rgba plus opacity
  - typography: family from theme fonts, size, weight, line-height, letter-spacing, align, transform
  - spacing: margin and padding per side, in px, rem or %, bounded
  - size: width, height, min-height, max-width
  - layout: gap, row-gap, align, justify, content position
  - border: width, style, colour, radius per corner
  - effects: box-shadow and text-shadow as structured layers, opacity, hover (colour, background, shadow, translate or scale preset)
- **Responsive:** `base` is desktop. `tablet` and `mobile` hold only overrides, compiled to `@media (max-width: 1023px)` and `(max-width: 639px)`. The inspector shows which values are overridden and offers "reset to desktop".
- **Translations:** text props support `{ "en": "…", "bn": "…" }`, following the existing E12b convention.
- **Limits:** at most 60 sections, 400 nodes and 256 KB per document; text lengths are bounded; IDs are validated (`^[a-z]_[a-z0-9]{4,12}$`).

## 5. Element catalog

| Group | Elements (★ = reuses an existing section component and data source) |
|---|---|
| Layout | Section (container), Columns (1–6 presets + resize), Inner row (grid / flex), Spacer, Divider |
| E-commerce | Product grid ★, Product carousel / slider ★, Product tabs ★ (featured / best selling / new arrivals / on sale / category / manual sources), Product categories ★, Brand logos ★, Promotional product card (single product + badge), Product search box, Cart icon (header) |
| Marketing | Hero banner / Image slider ★, Promotional banner ★, Countdown timer ★ (hot deals or a standalone date), Newsletter ★, Testimonials ★, Discount section (live promotion + coupon code copy), Call-to-action |
| Content | Heading, Paragraph / Rich text ★ (sanitized; the Tiptap editor already in the project), Image (media library), Video (YouTube / Vimeo URL allow-list → privacy-enhanced embed), Icon (store icon set), Button (link-target picker), Custom HTML (sanitized server-side; needs the `storefront.custom_html` permission, owner role only) |
| Header / footer only | Logo, Menu, Search, Account, Wishlist, Cart (count / total), Announcement, Language switch, Social icons, Payment icons, Contact block, Copyright |

Product data is always resolved by the server from the organization's own catalog at render time, so builder JSON never contains prices or stock.

## 6. API (thin controllers, `ApiResponse::*`, organization-scoped)

Admin routes (`storefront.view` to read; `storefront.manage` to edit; publishing also requires `storefront.publish`, granted to owner and store-manager roles):

| Method | Path | Purpose |
|---|---|---|
| GET | `/storefront/builder/documents` | List documents: pages, header, footer, theme, zones, with draft and published status |
| POST | `/storefront/builder/documents` | Create a landing page, or a builder layout for a CMS page, optionally from a template |
| GET | `/storefront/builder/documents/{id}` | Draft + revision + published version number |
| PUT | `/storefront/builder/documents/{id}/draft` | Autosave / save, `{revision, content}` → 409 `DRAFT_CONFLICT` if stale; validated and normalized |
| POST | `…/{id}/publish` | Transaction: validate, create a version, point the document at it, audit, bust the cache; theme docs also write `theme_settings` through `SaveTheme` |
| POST | `…/{id}/discard` | Reset the draft to the published version |
| GET | `…/{id}/versions` | Version history |
| POST | `…/{id}/versions/{v}/restore` | Copy into the draft (not live until published) |
| GET | `/storefront/builder/elements` | Registry metadata (labels, limits, enums) for the editor |
| GET / POST / DELETE | `/storefront/builder/templates` | Built-in and organization templates; "save section as template" |
| POST | `/storefront/builder/start-from-demo/{preset}` | Copies a demo site template (theme + home + header + footer + sample pages) into **drafts**; uses the client's own products |
| POST | `/storefront/builder/preview-data` | Resolves product, category and brand data for elements in an unsaved draft (canvas) |

Public storefront: `GET /store/builder/pages/home` and `/store/builder/pages/{slug}` (`/store/pages/{slug}` stays the CMS; landing slug `home` reserved) return the **published** document plus resolved data. The header, footer and theme come in `/store/bootstrap`. With no published builder home, the existing `/store/homepage` keeps serving, so existing stores look identical.

## 7. Frontend architecture

- **Admin:** a full-screen route `/admin/storefront/builder/:documentId`, outside the admin shell.
  - **Top toolbar:** page switcher, device toggle, undo / redo, save status ("Saved · 2 s ago"), Preview (opens the real store with `?preview=draft`), Publish, a ⋯ menu (Discard, Versions, Save as template).
  - **Left panel:** an Elements tab (searchable, grouped, drag onto the canvas), a Layers tab (tree with drag, rename, hide, lock) and a Templates tab (one-click sections and pages).
  - **Right panel:** an inspector with Content / Style / Advanced tabs, plus Global styles (palette, fonts, buttons, links) when nothing is selected.
- **State:** a zustand store (already a dependency) with the document tree, selection and history. Undo / redo are patch-based, keyboard shortcuts, 100 steps, with typing coalesced. Autosave runs 2 s after the last change with revision checks. Unsaved changes are guarded by `beforeunload` plus a router blocker.
- **Canvas:** `builder-canvas.html`, a third Vite entry that imports the storefront renderer and `storefront.css` and none of the admin CSS. It receives `{doc, theme, data}` by `postMessage`, reports clicks, hover outlines and drop targets back, and draws selection handles (move, duplicate, delete, resize columns). Drag-and-drop works across the iframe boundary through an overlay layer in the parent that maps pointer coordinates to canvas drop zones.
- **Renderer:** `storefront/builder/` holds `PageRenderer`, element components (the existing section components wrapped) and `compileStyles(doc) → CSS` (scoped `[data-b="e_1"]` selectors, media queries, sanitized values). The live store and the canvas use the same code, so preview = live.
- **Controls:** a colour control (swatches from the palette, a hex / rgba field, a native picker and an alpha slider), a gradient editor (type, angle, stops), a spacing box (linked or unlinked sides), a typography popover, a shadow layer editor, a device-scoped value indicator, and tooltips on every control. Destructive actions (delete section, discard, restore) ask for confirmation.
- **Accessibility:** dnd-kit gives keyboard drag (space → arrows → space); the layers tree is a `role="tree"`; every control is labelled.
- **New dependencies (need approval):** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (≈ 15 KB gzip, admin bundle only). The colour, gradient and shadow controls are built in-house.

## 8. Security and isolation

- Every builder table is organization-owned behind the `BelongsToOrganization` scope. Route-model binding is scoped, so another organization's ID returns 404. Each endpoint gets an isolation test.
- No raw CSS or HTML reaches the page, except sanitized Custom HTML. Style values are whitelisted and rendered through the style compiler. Image URLs come only from the organization's media library. Video embeds are allow-listed. The `postMessage` origin is checked both ways.
- Publish is audited (`storefront.builder_published`, `…_restored`, `…_discarded`). Templates from other organizations are invisible.

## 9. Phases (checkpoint after each)

| Phase | Scope | Done when |
|---|---|---|
| **B1 — Engine** | Migrations + manual SQL; `ElementRegistry` (PHP + TS) and schema v1; style compiler; documents / draft / publish / discard / versions / restore API; public page endpoints; storefront `PageRenderer` with legacy fallback; layout + content + the 13 existing section types as elements; "convert my current homepage" importer | PHPUnit (validation, limits, draft ≠ live, publish / restore, 409 conflict, isolation, permission), vitest renderer + style compiler; existing store unchanged |
| **B2 — Editor** | Full-screen editor: three panels + toolbar, iframe canvas + `postMessage`, dnd-kit add / reorder / move between sections / duplicate / hide / delete, layers tree, inspector (content tab), undo / redo, autosave, unsaved guard, device preview, publish / discard / version history UI | Criteria 2, 3, 6, 7, 8, 9 pass in mocked Playwright |
| **B3 — Design controls** | Style tab: colours / gradients / overlays / opacity, typography, spacing, size, border, shadows, hover; per-device overrides + column resize; Global styles (extended theme colour roles: secondary, background, button, button hover, link; palettes; responsive type scale) under draft / publish | Criteria 4, 5 |
| **B4 — Pages, header, footer** | Page manager (Home, About, Contact, FAQ, Privacy, Terms, landing pages; SEO; status), `builder` CMS template; header and footer builders; shop / category zones + grid columns per device + card style; remaining elements (video, icon, countdown, discount, CTA, search, promo card, custom HTML + permission) | All pages editable; header and footer published live |
| **B5 — Templates + demos + verification** | Section and page template library per preset; "Start from demo" (Vegan, Handmade, Classic, from the T2 demo stores); full-stack E2E of acceptance criteria 1–11 per demo; docs, manual (Bangla) and CHANGELOG | Criterion 1 + the full acceptance list green on PostgreSQL |

**Relation to T2 (demo stores):** T2 seeds the three demo organizations with products and stock, and B5 turns their designs into "start from demo" templates. The order options are in §10.

## 10. Decisions (answered 2026-11-11)

- Order: **T2 demo stores first**, then B1–B5.
- Dependency: **add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`** (admin only).
- Schema: **Laravel migration** for the three new tables (manual SQL in §3 kept as reference).
- Theme page: **draft + publish** as well, after B3 (one publish flow, versioned).

Original questions:

1. **Order:** finish T2 (the demo stores) first and then B1–B5, *or* start the builder now and seed the demos directly as builder documents in B5.
2. **Dependency:** may we add `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities` (admin only)?
3. **Schema:** may we add three new tables via a Laravel migration (§3; manual SQL provided; additive only)?
4. **Theme saves:** after B3, should the existing *Theme* page also save as a draft (one consistent publish flow), or keep saving straight to live as a "quick settings" page?

## 11. As built — B1 (2026-11-11)

- **Placement:** a sub-area of the Storefront module (`Domain/Builder`, `Application/Builder`, `Infrastructure/Models/Builder*`). It shares `SectionType`, the section content resolver, `ResolveStorefront`, the cache version, bootstrap and the HTML shell; a separate module would need contracts both ways.
- **Shared resolver:** `Application/Queries/SectionContentResolver` builds each section object for both `/store/homepage` and builder pages. The homepage output is unchanged, and a test pins `data[<element>]` to the homepage object in English and Bangla. The section config rules are extracted to `Domain/SectionConfigRules` and used by both APIs.
- **Schema:**
  - `BuilderDocumentSchema::normalize` is pure, with `StyleSchema` and `ElementRegistry`.
  - `PrepareBuilderContent` sanitizes and checks references.
  - Errors are `422 DOCUMENT_INVALID` with `details.errors[] {path, node_id, message, code?, ids?}`.
  - The shared fixture `frontend/src/storefront/builder/__fixtures__/sample-document.v1.json` round-trips unchanged on both sides.
  - Wrapped-section elements must satisfy the homepage rules (e.g. a hero slider needs ≥ 1 banner).
- **API:** the admin API is `/storefront/builder/*`; the public endpoints are `/store/builder/pages/{home|slug}` (published; `?preview=draft` for staff). Rules:
  - publishing needs `storefront.publish`; Online Store Manager has it by default
  - an empty page can't be published (`422 DOCUMENT_EMPTY`)
  - `409 DRAFT_CONFLICT` on a stale revision
  - draft saves are not audited (autosave noise); publish, discard, restore and delete are
- **Public render:**
  - hidden or out-of-schedule nodes are removed
  - wrapped elements without content are dropped, and a section whose elements all dropped out is removed (no empty band)
  - a section left empty on purpose stays
  - draft preview keeps everything with `state`
- **Storefront:**
  - `builder/` holds the types, registry, TS validator mirror, `compileStyles` and `PageRenderer`
  - the home page switches when bootstrap `builder.home` is true, otherwise renders exactly as before
  - landing pages are served at `/p/:slug` and by the HTML shell
  - `compileStyles` re-validates every value; selectors are `[data-b]` / `[data-b-row]`; breakpoints are 1023 / 639 px; `prefers-reduced-motion` is respected
- **Importer** (`from: homepage`): one `full-bleed` section per homepage section (the section components draw their own container). Disabled sections become `hidden`; schedules go on the section node. A full-stack test converts Classic Shop's homepage and publishes it: same headings, product cards and links.
- **For B2:** drafts are strictly validated, so the editor must collect a wrapped element's required content (e.g. banners) before inserting it. Built-in templates (`organization_id` null) need `withoutGlobalScope` in B5.

### As built — B2 (2026-11-11)

- **Admin code:**
  - Editor: `frontend/src/features/store-builder/`. The state in `store.ts` is zustand, one store per document, with snapshot history (≤ 100 steps, 800 ms typing coalescing); pure tree operations live in `tree.ts`, checked by `check.ts`.
  - Inspector: `inspector/`. It reuses `features/storefront/components/section-editor.tsx` (`BannerChooser`, `ConfigFields`, …); the helpers moved to `section-draft.ts`.
- **Canvas:** `frontend/src/storefront/builder/canvas/`, served from `builder-canvas.html` at `/admin/builder-canvas`.
  - The postMessage protocol (`protocol.ts`, `v: 1`, source `pos-builder`, origin and window checks) adds `scroll-by` (drag autoscroll) and a `pending` list (skeletons for sections still loading) to the plan.
  - The editor builds the render tree locally, so text and layout changes show instantly. `POST /builder/resolve` is called 400 ms after a change, only for changed wrapped elements and unknown media.
- **Drag & drop:** dnd-kit in the editor. While dragging, a transparent layer covers the iframe and drop targets come from the canvas `rects`. Layers support the keyboard sensor.
- **Autosave:** 1.5 s after a change, and on blur, hide, preview, publish and leave. One save runs at a time, always with the latest revision.
  - 409 opens a dialog: *Load their version* / *Keep mine*.
  - 422 maps problems to nodes, shown red in the canvas, the layers and the inspector.
  - Network errors retry with backoff (2 → 30 s).
- **Choices:**
  - The canvas renders the default language; Bangla is edited in the inspector.
  - A hidden node disappears from the canvas unless it is selected.
  - The setup dialog opens only when an element type's defaults are invalid.
  - Version "View" is available for the live version only (no endpoint previews older versions).
- **Polish for B3:** layers rows say only "Section"; name them after their content.

### As built — B3 (2026-11-12)

- **Controls:** `features/store-builder/controls/` (ColorControl, GradientControl, LengthControl, SpacingBox, ShadowControl, TypographyControl, BorderControl, BackgroundControl, HoverControl). Values go in and out; every write is checked against `validate.ts`, so the Style tab never writes a value the server would drop. `compile-styles.ts` is unchanged.
- **Per device:** mobile falls back to tablet, then desktop. A filled dot means set for this device; a hollow dot means inherited. Column resize (`column-resize.ts`) keeps each pair's total.
- **Theme document:** `builder_documents` `kind=theme`, `key=theme`, created on the first write. Reading never writes: before the first edit, the draft is the live theme at revision 0. The builder documents API ignores it.
- **New theme keys:**
  - `button`, `button_foreground` and `link` are always hex; old themes copy their own primary pair and accent when normalized.
  - `button_hover: null` = automatic (keeps each button's brightness filter).
  - Type scale defaults 16 / 1.25 / 1.5 / 700 / 1 / 0 reproduce today's sizes exactly (body × 1.25^k gives Tailwind's 20 … 72 px).
  - `palette` is owner content, so applying a preset keeps it.
  - `theme:button` / `theme:link` are not style tokens: the 11-role token list stays shared with `validate.ts`.
- **Draft preview:** `StaffPreview` support. Staff `?preview=draft` on bootstrap and on the HTML shell (`no-store`, noindex); canvas-context always returns the draft theme.
- **Not covered:** the divider's colour field in the Content tab still uses the simple theme-colour select. Turning off "fill the column width" on a device that inherits 100 % isn't possible (no `auto` width).

### As built — B4 (2026-11-12)

- **Kinds and keys:** `page` (`home`, `landing:<slug>`, `cms:<uuid>`), `header`, `footer`, and `zone` (`zone:listing.top|listing.bottom|product.after`). `ElementRegistry` declares `allowed_in` per type, and a sixth group, `site`, covers the header and footer parts.
  - Importers: `from: homepage` (home), `cms` (cms keys), `current` (header and footer).
  - Deleting any non-home document returns that part to its classic rendering.
- **Module boundaries:**
  - Promotions exposes `PromotionShowcase` (countdowns, discounts and the first usable coupon code).
  - Cms exposes `PageContent` and declares `PageDesigns` (bound by Storefront; `NoPageDesigns` by default).
  - OnlineCatalog adds `latestProductSlug()` for the product-zone preview link.
  - Menu trees moved to `Storefront/Application/Queries/MenuTrees`, with unchanged output.
- **Data elements:** countdown, discount, promo card, menu and FAQ list resolve server-side. Published payloads drop an element whose data isn't running; drafts keep it with `state`. Countdown and promotion boundaries feed the next-change time, so caches expire on time.
- **Storefront:**
  - Bootstrap carries header, footer and zone payloads.
  - The header applies from 768 px; phones keep the compact header.
  - `listing_columns` breakpoints are 768 / 1024 px, so the default output stays identical to today.
  - CMS builder pages keep the page title band unless the design has its own visible h1.
- **Custom HTML:** sanitized by `HtmlSanitizer` (class and id dropped) and re-sanitized on the client. The permission is checked when a node is added or its `html` changes. Restoring a version does not re-check it, because that HTML was allowed when it was saved.
- **Open:**
  - Deleting a CMS page leaves its builder document behind (the list shows it without a page).
  - The divider's colour field in the Content tab still uses the simple select.

### As built — B5 (2026-11-12)

- **Built-in templates are files** in `backend/resources/builder-templates/`: a `manifest.json` plus one JSON file per template. There are 46: 38 sections (vegan 10, handmade 10, classic 9, neutral 9), 5 pages (About, Contact, FAQ, Sale landing, New collection) and 3 sites (one per demo look).
  - `builder_templates` holds only organizations' own saved sections, with description, context and `allowed_in` inside `content` (no migration).
  - Thumbnails live in `frontend/public/builder-templates/<id>.png` (44). The two brand templates use the generated placeholder, because the demo stores have no brands.
- **Portable format:**
  - Images are `{asset}` (from the demo photo set).
  - Banners are inline `{banner: {…, image: {asset}}}`.
  - Menus use `menu_ref` (`main`, `footer`, `footer_1..3`); `when_menu` drops a node when that menu is missing.
  - Catalogue content uses sources only, never ids, so a template never references another organization's data.
- **Instantiate** converts a template to concrete nodes for the organization:
  - photos are imported through `MediaLibrary::import()` (deduplicated by checksum);
  - banners are created through `ManageBanners`, reusing an identical one;
  - menu refs are resolved;
  - the result is validated in the target context and returned. Nothing is written into a document; the editor inserts it as one undo step.
- **Start from demo** writes drafts only: the theme draft gets the preset, and home, header, footer and listing top are created or have their draft replaced (published versions are kept). **Publish all** publishes the chosen drafts and the theme in one transaction.
- **Editor:** a Templates tab (All / this look / Mine, categories, search, insert by click or drag), Save as template, and a "Start from a demo look" card with a review panel and Publish all.

### As built — K1 Kids demo look (2026-11-12)

- **Preset and card:** preset `kids` and card style `arched`; existing presets and their output are unchanged. The lavender commerce menu bar is a kids-only CSS rule keyed on `data-sf-preset`.
- **Demo store:** Little Sprouts is the fourth demo organization (`DemoThemesSeeder`, data in `demo-themes/kids.php`, photos in `images/kids/`).
- **Templates:**
  - `site-kids` plus 10 kids section templates, with thumbnails.
  - The kids "Deal of the week" template puts the photo next to hot deals in two columns on a mint panel, because `hot_deals` has no image field.

### As built — B6 more elements, motion and charts (2026-11-12)

- **Elements:** `B6ElementProps` normalizes the 19 new types. A new registry group `media` sits between content and commerce.
  - List item translations use `<list>.<item_id>.<field>`; chart labels use `labels.<index>`.
  - Keys of removed items are dropped on save.
- **Styles:** `motion` (base only, any node) and `background.video` (base only, sections and inner rows; the poster is omitted when absent).
- **Section props:** `sticky`, `shape_top` and `shape_bottom` are kept only when set, so older documents round-trip unchanged.
- **Data:** category card, product spotlight (the product-detail shape) and shop the look (cards by id). Unavailable ones are dropped publicly and get a draft `state`. `/builder/resolve` covers all three.
- **Storefront:**
  - `builder/motion.ts` is one shared IntersectionObserver; entrances are off in the canvas, and `playMotion` handles the editor preview.
  - `section-layers.tsx` / `section-layer-utils.ts` handle shapes, the background video and sticky.
  - Charts live in `builder/elements/chart/` (lazy, D3 modules only).
- **Chart choices:**
  - A single series uses palette slot 1, because the default and kids theme primaries fail the palette validator.
  - Pie / donut with more than 6 parts or a negative value is drawn as horizontal bars.
  - The data table toggle is always offered (contrast relief); `show_table` only sets whether it starts open.
- **Canvas protocol:** additive `play-motion {id}` (v1).

### As built — B6.1 banner editing (2026-11-12)

- **Endpoint:** `EditBuilderBanner` + `BuilderBannerUsage`. A banner referenced outside this document's draft is copied: homepage section items, other documents' drafts (including the theme), any version's content, and the organization's saved templates. On PostgreSQL the check is `jsonb_path_exists`; on other databases it is a text match. The banner rules are shared with the Banners API (`BannerRules`).
- **Editor:** a `banner-edited` command swaps a copied id across the draft as one undo step, and `usePreviewData.refresh(ids)` forces a re-resolve even when the element's own input is unchanged.

### As built — B7 easier start screen (2026-11-12)

- **Looks:** site templates are listed `site-kids` ("BerryKid Kids Store", the kids preset's new display name), `site-default`
  ("Original look", new: preset `default`, a general-store home of 10 sections, its header, footer and shop top; 5 photos, 4
  banners), then vegan, handmade, classic. `start-from-demo/default` is accepted. 66 built-in templates.
- **Previews:** manifest `preview` → `preview_url` in the template list; only the five sites have one
  (`/builder-templates/<id>-full.jpg`, full-page screenshots at 640 px wide, ~120–260 KB). The Original look's images were
  taken with it applied to the Classic demo store (real product photos).
- **Start screen (`/admin/storefront/pages`):**
  - an English / বাংলা toggle for this screen only (`pages/messages.ts`, `screen-language.ts`; localStorage
    `pos.storeBuilder.pagesLang`, `lang` on the screen root and on its dialogs). The editor stays English;
  - a state-aware 3-step guide (choose a look → edit your pages → publish, with "N unpublished changes" and *Publish all
    changes* through publish-all), hideable;
  - looks in API order, the first one featured; each card has *Preview* (the tall image, falling back to the thumbnail),
    *See live demo* (only when `GET /demo-stores` lists the preset — never for `default`) and *Use this look*;
  - the Use dialog offers *Save as draft* (the B5 flow) or *Use and publish now* (needs `storefront.publish`; confirm →
    start-from-demo → publish-all → "… is live on your shop");
  - plain grouping: *Your pages* (home, other pages, campaign pages), *Header & footer*, *Shop pages*.
- **Not translated:** the Original look's features-strip items and testimonial quotes stay English (those section configs
  have no translations).

### As built — B8a selling, people and data blocks (2026-11-12)

- **Elements (10):** `pricing_table`, `comparison_table`, `bundle` (commerce); `flash_sale_bar`, `review_wall` (marketing);
  `before_after`, `photo_grid` (media); `team`, `store_hours` (+ footer), `progress_bars` (content). Normalizers in
  `B8ElementProps`; shared helpers moved to an `ElementProps` base class (B6 unchanged).
- **Two-level translation keys** (`plans.<id>.features.<id>.text`, `rows.<id>.cells.<column id>.text`), listed in
  `limits.nested_list_translatable`; the storefront/editor translation resolvers walk keys of any depth.
- **Data through contracts only:** `ReviewShowcase` (approved reviews, public author name, star counts),
  `StorefrontCatalog::liveProductIds()`, `PromotionShowcase::claimed()` (real redemptions, only with a usage limit),
  `OrganizationDirectory` timezone. A flash sale bar without a chosen promotion also expires the page cache at the next automatic
  promotion start/end.
- **Chart:** stacked kinds (d3 `stack()`, one value axis, totals in tooltip/table, legend always on); `data_source` store sources
  render from `data[id]` (public counts only; a store source is never stacked). Progress bars use the theme primary only when it
  passes the palette checks (lightness, chroma, 3:1), else palette slot 1.
- **Storefront:** before/after is a `role="slider"` (keyboard + pointer capture); the comparison table is a real table in a focusable
  scroll region with a sticky first column; bundle adds items one by one through the cart mutation with a polite live region and a
  per-item failure list; store hours status renders after mount (no hydration mismatch) and refreshes each minute; Bengali digits
  follow the store's `bangla_digits` setting.
- **Editor:** setup dialogs for before/after, bundle and photo grid; comparison grid; store-hours week editor (Saturday first, copy to
  all, after-midnight and 24-hour hints); chart "Numbers come from" with a read-only store preview; prices accept "১,২৫০" / "৳ 99.50".
- **Templates:** 10 neutral sections with thumbnails (76 built-ins).

### As built — B8b popups & bars, form builder (2026-11-13)

- **Popups:** kind `popup`, key `popup:<uuid>`; content `{schema_version, popup, sections}` (`PopupSettings` normalizer; the
  schedule is inside the settings and versioned; `active` is a column, not versioned). Live = published + active + in schedule.
  `BuilderPopups` serves `GET /store/builder/popups` (priority order, cache expiring at the next schedule change); settings key order
  is restored after jsonb storage. Context `popup` allows a fixed element list; button `action: "dismiss"` only there.
- **Storefront:** `builder/popups/` (`PopupHost` in the store layout, rules, triggers, frame). Frequency in localStorage
  `sf.popup.<id>` (memory fallback when storage is blocked). One modal-like popup at a time, one bar per edge; a modal waits while
  another dialog is open. Canvas draws a popup over a faded sample page with nothing running.
- **Forms:** `B8ElementFormProps`; `SubmitBuilderForm` validates against the published element (document live, CMS page published,
  popup live, element and ancestors shown and in schedule) → `builder_form_submissions` (answers as base-language labels; `fields`
  snapshot for stable export columns; `document_id` is not a foreign key, so deleting a page keeps its messages). `FormSubmitted`
  → queued bell notification + optional e-mail (failures logged). Templates may use `promotion_ref: "coupon"`
  (`PromotionShowcase::runningCouponPromotion()`).
- **Admin:** Content → Form submissions (`/content/forms[/:id]`); `/content` redirects forms-only staff there.

### As built — B9 global sections, AI writer, copy & paste, page SEO, more animation (2026-11-15)

- **Global sections:** kind `global` with a stored `context` column (a restore can't change it); one section per global; reference
  node `global_section` in `sections[]`; `BuilderGlobals` expands references at render (published for live pages, draft for drafts),
  keeps the reference id and adds a `global` marker; usage = drafts and live versions that reference it; publishing a global bumps
  the content version. The editor expands references locally for the canvas (badge, clicks select the reference, inner nodes edited
  in the global's own document), lists globals in a **Global** tab and on the start screen; *Make global* publishes the new global
  at once when the user may publish (no page uses it yet).
- **AI writer:** `WriteBuilderTexts` through `Shared\AiTextWriter` (feature `builder_writer`), field keys from the element registry,
  clamped and sanitized; no template fallback (every failure is `AI_UNAVAILABLE` with a reason). Editor: review with per-text tick
  boxes, applied as one undo step; Bangla always into `translations.bn`.
- **Copy & paste:** editor-only (`clipboard.ts`): system clipboard JSON with a marker plus `pos.builder.clipboard.<org>`; new ids;
  refused with reasons for elements a context can't hold, custom HTML without permission, another store's copy, sections into a
  global, globals that don't fit; copy/paste style replaces the whole style (all devices, motion, hover).
- **SEO:** content `seo` (page and cms only); shell + SPA meta (`withPageSeo`) use the published seo with per-field fallback.
- **Animation:** CSS keyframes for the new entrances and loops; `every_time` resets on leaving the viewport; stagger driven by the
  parent; loops pause on hover/focus and stop after three cycles; hover under `(hover:hover) and (pointer:fine)` and on focus-visible;
  parallax as an aria-hidden layer (≤20 % of the section height) on desktop pointers only; all under
  `prefers-reduced-motion: no-preference`.

### As built — B10 edit on the page, page check, fonts & Bangla typography (2026-11-15)

- **Edit on the page:** the canvas (`canvas/text-fields.ts`, `text-edit.ts`, `format-bar.tsx`, `use-canvas-editing.ts`) finds a
  node's texts from the registry's translatable fields (translation-key names, e.g. `items.<id>.title`) and makes the drawn element
  `contenteditable` in place; the original DOM is restored when the edit ends (React's nodes are never lost) and the typed text stays
  until the editor's next render. Protocol v1 additions: editor → canvas `edit-text`, `set-locale`, `end-text-edit`,
  `text-edit-link-result`, `theme.fonts`; canvas → editor `text-edit-start|commit|cancel`, `text-edit-link`, `image-drop` (the File),
  `image-replace`. The editor (`inline-edit.ts`) re-sanitizes HTML (`sanitizeRichText`, the server's tags), applies limits and
  `validateNode`, one undo step; refused commits trigger a re-render. Locale `en` writes props, others `translations[locale]`.
- **Pictures, spacing, quick bar:** dropped files upload with XHR progress (`media-upload.ts`, the API client's XSRF and branch
  headers) and set the image or the background at the current device; the overlay lets desktop file drags through. Spacing grips
  (`spacing-handles.tsx`) write px padding (Alt: margin) to the current device, 4 px snap, 0–400; %, vh and vw values are left to the
  Style tab. Quick bar: alignment + text colour for text elements (buttons excluded).
- **Page check:** client engine `page-check.ts` (pure, over the expanded content + theme + media) and fixes `page-check-fix.ts`;
  contrast only where the page sets colours (theme pairs are checked on the Theme page); issues inside a global point at its
  reference. Server `BuilderPageCheck` reuses `BuilderReferences` (same "gone" codes as the save check) plus link, liveness, global,
  order-form and form-recipient checks; `{content}` checks unsaved edits. Fix it = `focus` (inspector `focus` prop: tab, card, field;
  null node = page SEO), `apply` (one undo step) or `site-styles`. Publishing is never blocked.
- **Fonts:** catalogue `storefront/fonts.ts` (ids → families, stacks, Bangla flags), loader `font-loader.ts` (dynamic CSS import per
  font, body font preloaded, uploaded fonts as `@font-face` with the server's opaque `sf-custom-…` family). Bangla keys live in
  `typography`; the payload's `fonts` gives the effective Bangla fonts so old themes keep Hind Siliguri / Baloo Da 2 for Bangla
  glyphs only. Custom fonts have their own table (`storefront_fonts`, not the image media library): WOFF2 header check, 4 per store,
  500 KB, in-use = live theme or draft (409), restore falls back to defaults.

### As built — B11 publish later, versions & approval, picture tools, five new looks (2026-11-15)

- **Publish later:** `builder_schedules` hold a snapshot (content + draft revision) — one pending per document (partial unique
  index); `storefront:publish-scheduled` claims due rows with `SKIP LOCKED` and publishes in a savepoint through the same
  `publishSnapshot` path as a manual publish (`via: scheduled`, audited as the scheduler). Gone references → `failed` with the
  validator's errors and a bell notification; unexpected errors leave it pending. `cancel_schedule` on publish-now avoids an older
  snapshot replacing a newer fix. Theme drafts schedule the same way (no theme checkpoints/reviews).
- **Versions:** `builder_versions` gain `kind` (version | checkpoint), `name`, `via`; checkpoints are unnumbered draft snapshots
  (20 per document). `BuilderDiff` compares two contents node by node (added / removed / moved / changed fields, plain text ≤300,
  style changes flagged only). The editor's compare screen draws two read-only canvases (the existing canvas page, `inert` iframe
  with an overlay that scrolls by message) plus the change list as the accessible view.
- **Approval:** `builder_reviews` snapshot the draft; anyone with `storefront.manage` may submit, publishers approve (now or as a
  schedule), send back (comment required) or the submitter withdraws; `draft_changed` compares content values. No org setting:
  the permission split decides. Pages list: "Waiting for approval" tab; the bell link `/storefront/pages?review=<id>` opens it.
- **Picture tools:** `GdImageProcessor` (crop → rotate → flip → brightness → contrast → saturation, matching the CSS preview;
  per-pixel for transparency); copies link `edited_from_id`; replace checks `MediaReferences` + every FK to `media` (read from the
  PostgreSQL catalog). Focal point on media flows through `MediaLibrary::refs()` to every storefront picture that is cropped by CSS
  (`storefront/focal.ts`); product photos (catalog images) and CSS background images are unaffected. Uploads are capped at
  2560 px with EXIF orientation applied; full-width WebP rendition for big JPEG/PNG.
- **Five new looks:** presets fashion, electronics, grocery (Bangla fonts), beauty, furniture — existing T1 layout options only;
  demo stores with 12 products and exactly 10 photos each (reused for banners, tiles, blog covers; ≈ 4.4 MB total); site templates
  with Bangla; 40 section templates without thumbnails (the template browser draws a sketch with name and category).

### As built — B12 faster building (2026-11-15)

- **Selection:** `selection` stays the primary item; `selectedIds` holds the group (pick order). Ctrl/Cmd toggles, Shift selects
  siblings in the displayed (device) order; group actions (move as a block, duplicate, delete, hide, copy/paste style, wrap) are each
  one undo step and need siblings where it matters (else disabled with the reason). The inspector's **Common style** shows only
  the style parts every selected item supports, "Mixed" values, and writes to all for the current device; **Line up** (align text,
  place blocks via auto margins, equal spacing, same width) lives there too.
- **Command box (Ctrl/Cmd+K)**, shortcut sheet (`?`), undo history persisted per document and draft revision (reset with a note when
  the page changed elsewhere). The canvas forwards modifier clicks and the two shortcuts (not during a text edit).
- **Snapping:** spacing grips snap to neighbours' values and common steps (dashed guide + badge), column handles to row shares and
  other columns; Alt turns it off. `setSpacing` / `resizeColumns` only clamp — the handles snap.
- **Device order:** `device_order` per device for the page root and columns (not columns themselves), normalized on the server
  (`DeviceOrder`), rendered as real DOM order (`orderedChildren`, `useViewportDevice`; canvas by its device prop). Editor:
  `device-order-edit.ts` mirrors the server rules; Layers, arrow keys and Move up/down follow the device order in tablet/phone view;
  drag within a container there changes only that device; "Same as computer" (or "Same as tablet" for phones) deletes the entry.
- **Copy to other pages:** `CopyBuilderSection` copies into each target draft in its own transaction (new ids, context
  validation, never publishes); the open document is left out of the picker (its revision would change under the editor).

### As built — B17 festival packs & Bangladesh trust blocks (2026-11-15)

- **Elements:** `ornament` (16 original SVG drawings, decorative/aria-hidden, theme or hex colours, borders repeat), `payment_badges`
  (the store's checkout methods via `CheckoutPaymentMethods` + owner-picked wallets as text, never logos), `delivery_promise`
  (`ShippingRates::activeZones()`; fee / free-over / COD worked out with Decimal), `bangla_date` (client-side Bangladesh revised
  calendar — 2019 revision, Falgun 29/30 — and tabular Hijri marked expected; data is only the store timezone so the published cache
  never goes stale at midnight); `trust_badges` extended (≤ 8, item links, popups).
- **Festival packs:** 30 templates (10 occasions × landing / hero / bar), no photos, every text in Bangla, every text/background pair
  WCAG AA under all 10 presets (tests). Ekushey is a tribute (no sale elements or wording); Independence and Victory Day are dignified
  with a modest offer. Wallets start empty so a page never claims a wallet the shop doesn't take.
- **Calendar & setup:** `FestivalCalendar` (fixed dates computed; lunar/tithi from a sourced 2026–2028 table); `SetupFestival` writes
  drafts only — landing page, hero sections on top of the home draft with the window as node schedule (replaced on a repeat setup),
  a bar popup with the dates switched on (visible once published) — and overwrites countdown ends and discounts; `publish_ids` feed
  the existing publish-all. One `storefront_festival_setups` row per store, occasion and year. Admin: Online store → Festivals
  (calendar, setup dialog, review & publish); templates browser "Festivals" category.

### As built — B15 know what works: insights, heat map, orders per page, speed (2026-11-19)

- **Collecting:** `storefront/insights/*` — section views (half visible ≥ 1 s, once per page view), clicks with their position inside
  the section (throttled), deepest scroll milestone and LCP / CLS / INP (PerformanceObserver) go in batched beacons (`seq` 0 counts
  the page view) via sendBeacon / keepalive fetch without credentials; never from drafts, previews, the canvas, or with DNT / GPC.
  Server (Marketing `RecordPageEvents`): validates the published version's top-level sections, skips bots, aggregates into daily
  rows with upserts, web vitals as histogram buckets (p75 on read), nothing personal kept; `marketing:prune-page-insights`.
- **Orders:** the last builder page + section clicked toward a product (sessionStorage, 30 min, not with DNT / GPC) travels as
  `attribution.builder` on add-to-cart, checkout and the order form → `orders.attribution.builder`; insights count non-cancelled
  orders and revenue per page / section / day.
- **Admin:** Insights panel (headline sentence, figure tiles, daily chart with publish markers and a table view, sections with
  seen / clicked / orders bars, speed traffic lights), heat map overlay (single-hue 5-step scale, legend, scroll-reach markers,
  "Clicks as a list" alternative), Pages list "Views (30 days)" / "Orders" columns.
- **Speed:** page check "Speed" group with a 0–100 score (`page-check-speed.ts`: page weight from served renditions, first-screen
  pictures, background video, slideshows, embeds, scripts in custom HTML, pictures in text, fonts, long pages) and Fix it; the
  renderer gives the first picture of the first screen `fetchpriority="high"` + eager, lazy-loads the rest and reserves picture space.

### As built — B13 audiences & A/B tests (2026-11-19)

- **Audiences:** `AudienceRules` validates and normalizes `audience` on sections, global refs and elements; the storefront's pure
  `evaluateAudience` decides in the browser (visitor flag and district in localStorage, campaign touch from the URL / P2a session,
  cart subtotal, store time from the payload `timezone`) — a node with rules renders only once its context is known (no flash);
  presentation only, never a lock. Editor: Advanced → *Who sees this* (one rule per kind, plain sentence, not-for-secrets note),
  badges on canvas and Layers, toolbar *Preview as* (canvas `preview-as` message fades non-matching nodes; never filters).
- **A/B tests:** `Experiments` (document list + section arms, contiguous blocks, server-managed status) and
  `ManageBuilderExperiments` (start / stop / keep on the draft with revision checks). The storefront assigns a sticky arm by split
  (localStorage), renders only that arm, sends `arms` on beacons and `experiments` in attribution; DNT / GPC → A, not counted.
  `ExperimentResults` + `BetaBinomial` (exact Beta posterior probability, no dependency); add-to-cart via a Cart event. Editor:
  *Test a different version* (B = copy next to A), A/B tests panel with honest plain-word results, a per-day rate chart, Keep A / B;
  the editor sends the canvas only the shown arm (the canvas never filters).

### As built — B18 Motion studio (2026-11-21)

- **Schema:** `StyleSchema` (easings, new entrances / loops / hover effects; silent drop), `ElementRegistry` (`TEXT_EFFECT_*`,
  `CARD_HOVER_*`, `text_effect.words.*` translations), `BuilderDocumentSchema` (`textEffect()`, `cardHover()`, divider `animate`,
  `motion_theme`), `BuilderPageCheck` (`MOTION_LCP`, `MOTION_TOO_MUCH`, `TEXT_EFFECT_LONG`). Mirrored in the storefront
  `types.ts` / `validate.ts` (`B18_ENUMS`, `B18_LIMITS`, `b18PropProblems`).
- **Storefront:** `compile-styles.ts` writes easing curves (`spring` / `bounce` as `linear()` after a cubic-bezier fallback) and the new
  keyframes (transform, opacity, clip-path, filter, background-position only — tested); one rAF-throttled pointer listener drives
  `tilt-3d` / `glare` (fine pointers, ≤ 8°). Text effects: the real text stays as the accessible text and sizes the box, the moving copy
  is an `aria-hidden` `inert` overlay removed when done, rotating words sit in an inline grid cell as wide as the longest word, Bangla
  splits by grapheme cluster merged across viramas and joiners (`text-effects.ts`, lazy, 2 kB gzip). Dividers: `flow` translates a
  doubled strip; `layered_waves` three layers; `blob` transform only. `motion-pause.ts` / `pause-toggle.tsx`: the Pause animations pill
  appears only with motion longer than 5 s (and never under reduced motion); paused loops keep entrances finishing.
- **Editor:** Motion group rebuilt (`b18-motion-tiles.tsx`: roving-focus tile groups, previews via the Web Animations API on hover /
  focus; `EasingChips` with a curve drawing), Text effect form, Card hover picker, divider Animate; one toolbar *Motion* menu (themes, *Preview motion*
  checkbox, *Play page*); below 1600 px the secondary toolbar buttons are icon-only and the toolbar scrolls rather than clips;
  page check `remove-entrance` fix. `motion-themes.ts` (pure, idempotent; *Keep my own animations* compares against
  what the current theme would produce; never animates the first section's pictures or headings; ≤ 6 loops per section, no
  endless loops). `timeline/` docked panel: rows in reading order with delay + duration sliders (`role="slider"`), drag snaps to
  50 ms, keyboard ←/→ (delay) and Shift+←/→ (duration), one undo step per drag.

### As built — B16 teamwork & safety (2026-11-20)

- **Presence & lock:** `Collaboration\BuilderPresence` (cache; viewers 60 s, lease 90 s) and `BuilderEditLock::assertCanWrite`
  (423 `DOCUMENT_LOCKED`) on every draft-writing action, plus the `EnsureBuilderEditLock` middleware on the routes; take-over needs
  storefront.publish while the lease is live. Polling only (no websockets): the editor heartbeats every 20 s and on focus
  (`collab/use-presence.ts`), turns view-only (canvas, inspector, layers, keyboard) when another person holds the lock, refreshes the
  draft when its revision moves, and keeps the person's unsaved changes copyable after a take-over.
- **Comments:** `builder_comments` (node + anchor 0–1, one reply level, mentions, soft delete), `BuilderComments` +
  `BuilderCollaborationNotifier` (bell notifications with an editor deep link `?comment=`). Editor: comment mode and numbered pins
  over the canvas (`collab/comment-pins.tsx`), threads panel, `@` autocomplete (`mention-textarea.tsx`), canvas key `c` forwarded.
- **Activity:** the Shared `AuditHistory` contract reads a subject's audit entries; `BuilderActivity` merges them with
  `builder_edit_sessions` (per-person rolling save sessions, 15-minute gap) — Activity tab in Version history.
- **Export / import:** `Portability\ExportBuilderDocument` / `ImportBuilderDocument` with `Domain\Builder\Portable\PortableRefs`
  (`@ref:<type>:<n>`); media through `MediaLibrary::originalFile` and checksum de-duplication; catalog mapping through
  `StorefrontCatalog::portableReferences` / `findPortable`; missing references drop the element, then `PrepareBuilderContent` is
  re-run until the content validates. Never publishes.
- **Redirects:** `storefront_redirects` + `Redirects\StorefrontRedirects` (normalize, collapse chains, drop loops, hits batched per
  minute) fed by the Shared `PublicAddressChanged` event from Cms / OnlineCatalog saves and `ChangeLandingAddress`; the shell
  controller answers would-be 404s with 301 / 302, and the storefront not-found page calls `/store/redirects/resolve`. Admin page
  *Online store → Redirects*.

### As built — B14 design the whole store (2026-11-19)

- **Store page templates:** seven `template:*` page keys validated in `template:<key>` (main part rules; `seo` not allowed), starters
  in `resources/builder-templates/store-pages/`, bootstrap `builder.templates`, public `GET /store/builder/templates/{key}`,
  `unpublish` for "Use the standard page". The storefront routes switch to a published template with a page context and fall back to
  the standard page on any error; SEO, canonical, noindex and 404 status stay with the route (`pages/listing-meta.ts`).
- **Live data:** `dynamic_text` reads the page context (category, brand, search, post, order, store) in the browser —
  `formatDynamicText` joins prefix / value / suffix (the server trims edge spaces).
- **Main parts:** `product_listing` reuses the standard listing (`catalog/listing-body.tsx` + `listing-controller.ts`; filters on /
  off, layouts, URL state, load more; scoped listings use `categories[]` / `brand[]`), `blog_post_body` and `order_summary` reuse
  `BlogPostView` / `OrderDetails` (the order stays client-side), `not_found_message` replaces the 404 everywhere when published.
- **Editor:** Pages list "Store pages" group (design from starter / empty, edit, view, use the standard page), toolbar "Preview with"
  (sample category / brand / search / post / masked order via `sample-context`; the canvas stays offline and draws from `sample`),
  element forms with live values, main part only where allowed, page check fixes (insert / select).
