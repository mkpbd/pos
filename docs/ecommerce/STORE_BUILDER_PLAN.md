# Visual Store Builder — analysis and architecture (B1–B5)

Status: **approved 2026-11-11** (decisions in §10). **B1 done** (engine; see §11); B2 (editor) next. Goal: a drag-and-drop, no-code editor in the admin that lets each organization design its own online store (pages, header, footer, global styles) with draft / publish / version history. It is built on top of the existing storefront, catalog, cart, checkout and POS data, which it does not change.

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

builder_templates                (section / page templates; org_id NULL = built-in)
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
