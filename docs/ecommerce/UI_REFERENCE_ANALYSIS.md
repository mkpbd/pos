# UI Reference Analysis — BerryKid (visual and UX reference)

E-commerce track, phase **E2**. Evidence captured 2026-10-31 with Playwright (headless Chromium) from the public demo. REA was not installed (no owner go-ahead); Playwright covered the same need for a website target.

## 1. Source

| Item | Value |
|------|-------|
| Product | BerryKid – Baby Store WooCommerce WordPress Theme (ThemeForest item 19108262) |
| ThemeForest preview | `preview.themeforest.net/…/full_screen_preview/19108262` sits behind a Cloudflare Turnstile challenge that blocks automated browsers. Not bypassed. |
| Demo inspected | `https://demo2.themelexus.com/berrykid2/` — page title "Berrykid2 – Baby Store WooCommerce WordPress Theme", 4 homepage variants (`/`, `/home-2/` … `/home-4/`). The older path `/berrykid/` redirects to a WordPress installer (dead). **Assumption:** this is the current demo of the item; the preview frame could not be opened to confirm. |
| Stack observed | WordPress + WooCommerce, Elementor with theme widgets (`berrykid2-*`), Slider Revolution, WPC Smart Wishlist (`woosw`), Quick View (`woosq`), Compare (`woosc`), Variation Swatches (`wvs`), Contact Form 7, Mailchimp, Google Maps |
| Captures | 49 screenshots (home ×4 widths, shop ×4, product ×4, other pages desktop + mobile, interaction shots) and `data.json` with section structure, computed styles, fonts, breakpoints, forms. Kept **outside the repo** in the session scratchpad: demo photos are stock imagery not licensed to us. |

## 2. Licensing and boundaries

- We recreate **layout, information architecture and interaction patterns** with our own React components. No theme PHP/JS/CSS, images, icons or illustrations are copied.
- The fonts the demo uses are open-licence Google Fonts (OFL), not theme property, so using the same families is allowed. We self-host them via Fontsource.
- Payment and courier logos in the footer are trademarks. We use each provider's official brand assets under its guidelines, uploaded by the shop owner.
- Demo content has typos ("GRIL", "MY OFICCE") and lorem ipsum. Not carried over.

## 3. Global look

| Token | Observed | Note for our version |
|-------|----------|----------------------|
| Primary (orange) | `#ffab05` (`--e-global-color-primary`) | Card blocks, active states, CTAs. White text on it is **1.9:1**, which fails WCAG AA. We darken it for text-bearing surfaces or use dark text on it. |
| Accent (lavender) | `#a993dc` | Nav bar, footer bar, hover state of cards, search button |
| Highlight (mint/teal) | `#58d2b0`, `#96d9d8`; logo teal | Section backgrounds (deal, testimonials), headline colour |
| Sale ribbon | Coral (~`#f47b4f`) | Diagonal corner ribbon with `-41%` |
| Heading text | `#444` | |
| Body text | `#878787` on `#fefefe`, 14px / 26.6px | **3.6:1**, which fails AA. We use a darker grey. |
| Border | `#e1e1e1` | |
| Fonts | Headings **Baloo Paaji 2** 700/800 · body **Poppins** 400–700 · script accents **Pacifico** ("Online", "Shop by look", "Subscribe to newsletter") | For Bangla: **Baloo Da 2** (the Bengali member of the Baloo family, OFL) for headings, **Hind Siliguri** for body. Same personality, real Bangla glyphs. |
| Container | 1170px | Theme setting `container_width`, default 1170 |
| Breakpoints | Many; the effective ones are 1200, 1024, 768, 568, 480 | Tailwind `sm 640 / md 768 / lg 1024 / xl 1200`, with layout changes at md and lg |
| Shape language | Pills (buttons, search, tabs), circles (icon buttons, countdown, category icons), arched top on the card caption, rounded panels, scattered star confetti on hero/footer | Radius tokens: `--radius-pill`, `--radius-card`; the arch is an SVG/clip-path in `ProductCard` |
| Surfaces | Content sits in white panels on a light grey page (`#f3f7fa`) on shop and product pages | `canvas` + `card` tokens, as in the admin theme |

## 4. Shared chrome

### Header (desktop, not sticky in the demo)
- **Row 1 (99px, white):** logo left · pill search centre (text field + hidden category select `product_cat` + round lavender submit) · right: "My Account" link (opens AJAX login form) + cart icon with count badge and cart total.
- **Row 2 (60px, lavender):** hamburger (opens off-canvas "vertical menu") · main menu uppercase (HOME has a 4-item dropdown; others flat) · right-aligned single link.
- **Announcement bar:** none in this demo. The brief asks for one; it sits above row 1, admin-controlled.
- **Mega menu:** markup present (`has-mega-menu`, 4 items) but hovering in the automated run did not reveal a panel. *Not observed.* We design our own: full-width panel, up to 4 columns of links plus an optional image.
- **Sticky:** the header did **not** stick after scrolling. The product page has a sticky "You're viewing" bar instead (see §6). Our header gets a `sticky` theme toggle, as the brief requires.

### Header (mobile, 390px)
- Logo + hamburger only.
- A **fixed bottom toolbar** with three icons: search, account, cart.
- An off-canvas drawer from the left with tabs **MAIN MENU | VERTICAL MENU**, chevrons on parent items, a close ×, and language flags at the bottom.

### Page title banner
Shop, category, product, cart and account pages open with a 331px full-width image band (light background + illustration) carrying the breadcrumb. Our version: a theme setting `page_header` (background colour, image per page type, show breadcrumb), plus a per-category banner image from `category_listings`.

### Footer
- Four columns: (1) logo, short text, payment logos; (2) "QUESTIONS" with two link columns; (3) "INSTAGRAM" 3×2 image grid; (4) "CONTACT US" with e-mail and phone.
- A social row with 7 labelled networks, then a lavender copyright bar.
- Our version: column 2 = footer menus; column 3 = an admin-chosen image gallery from Media with links (no Instagram API); columns 1/4 from theme contact info; social links from the theme.

## 5. Homepage — section catalogue

Section order of variant 1 (desktop, total height 6570px; 12694px on mobile):

| # | Section (demo) | Observed | Our section type / config |
|---|----------------|----------|---------------------------|
| 1 | Hero slider | 640px full-width. Script kicker ("Online") + big two-colour headline ("Flat 20% Off") + subline + two pill CTAs (lavender "DISCOVER", orange "SHOP NOW" with arrow). Round prev/next buttons bottom centre. Images left and right of the text. | `hero_slider` ← banners `hero_slider` (title, kicker, subtitle, 2 buttons, desktop/mobile image, text colour) |
| 2 | Banner grid | 3 columns. Left and right photo tiles with a circular badge (age range, "Shop by look" / "Shop Now"); the centre is split into a photo tile + an orange promo tile ("UP TO 50% OFF / Free shipping"). | `banner_grid` (layout `3-col-split`) ← banners `home_promo` |
| 3 | Product tabs | Title "New Collection". Pill tabs Popular / New arrivals / Best sellers. 4-up carousel with arrows. | `product_tabs` (tabs: source + limit each) |
| 4 | Deal of the week | Two-colour panel: mint left with "Special offer" script, "Up to 25% off", **countdown as 4 circles (D/H/M/S)**, CTA; circular product thumbs column; photo right on pink. | `hot_deals` (promotion id → countdown end, products, background colours, image) |
| 5 | Product grid | "Hot Products" + subtitle. 4×2 grid. | `product_grid` (source, limit, columns) |
| 6 | Newsletter strip | Coral band, script title "Subscribe to newsletter", line of copy, illustration. (Email field present in the widget.) | `newsletter` (title, text, image, colours) → `newsletter_subscribers` |
| 7 | Categories + products | Left: "Categories" list with round coloured icons; right: product carousel. | `category_showcase` (category ids with icon media, product source) |
| 8 | Brand strip | 6 logos in one row. | `brand_strip` ← `brand_listings` (logos) |
| 9 | Testimonials | Teal panel, round avatar, quote, name + role, arrows. | `testimonials` (items in section config: quote, name, role, avatar media) |
| 10 | Banner trio | "Girl collections" / "Child" / "Boys collections", each "UP TO 50% OFF" with age chips. | `banner_grid` (layout `3-col`) |
| 11 | Features strip | 4 icon columns: Guarantees / Delivery / Payment / Contacts with one-line captions. | `features_strip` (items: icon key, title, text) |

The other variants reuse the same building blocks in a different order, plus:
- a category icon strip directly under the hero (home 2)
- a large text-promo band (home 3)
- a "category tabs + product grid + side banner" block repeated per audience: "For Infant", "Popular Shop", "New Arrival" (home 4) → `category_tabs` type

**Conclusion:** a structured section builder with about 12 types covers all four demo homepages. No free-form drag-and-drop builder is needed.

## 6. Product card

- 223×332px in 4-up carousels; 3-up on shop pages at 1440px; 1-up on mobile.
- White image area on top. A coral **diagonal corner ribbon** shows the discount %.
- Below it, an orange block with an **arched top edge** holding: uppercase title (Baloo), category names, price (struck-through old price + current price), all in white.
- **Hover** (captured):
  - the block turns lavender
  - a round cart button appears at the top of the arch
  - three round icon buttons slide in on the right of the image: wishlist (heart), quick view, compare
- No star rating on grid cards. Ratings appear in the sidebar "Popular Shop" mini-list.

Our version keeps the arch and ribbon, drops "compare" (out of scope, plan §4), and shows a stock badge ("Out of stock") and a "New" badge from `is_new_until`. Accessibility: the hover-only actions also show on keyboard focus, and appear as a bottom action row on touch devices.

## 7. Shop and category pages

- Page title banner, then two columns:
  - **Left sidebar:** product search, "Product categories" list (+ expanders), "Popular Shop" mini product list (thumb, stars, title, old/new price).
  - **Main:** a white panel with a **grid/list toggle**, sort select, result count ("Showing 1–9 of 20 results"), 3-column grid, and numbered pagination with a next arrow (active page orange).
- Sort options: default, popularity, average rating, latest, price low→high, price high→low. We use the same six.
- **No price, brand, attribute or availability filters in the demo.** The brief requires them. They go into the same sidebar as collapsible groups, reusing the categories list style: price range slider with inputs, brand checkboxes, colour swatches, size buttons, in-stock toggle, plus active-filter chips above the grid.
- Mobile: a "FILTER" button opens the sidebar as an off-canvas panel; the grid becomes 1 column.

## 8. Product page

- Page title banner, then a white panel in two columns:
  - **Gallery (left):** main image with a magnifier icon (hover zoom and lightbox), thumbnails in a horizontal row (3 columns).
  - **Summary (right):** title (Baloo, large), price or price range, short description, variation **swatches** (size as text buttons L/M/S, colour as round dots), quantity stepper (− 1 +), "Add to cart" pill (disabled until a full variant is chosen), "Add to wishlist" + "Compare" text links, meta (SKU, categories, tags).
- **Sticky product bar** appears after scrolling past the summary: thumb, "You're viewing: <name>", price, stars, and a "Select options" / "Add to cart" button.
- Tabs styled as pills under the panel: Description / Additional information / Reviews (n). The review form fields: rating, comment, name, e-mail.
- "Related products" 4-up carousel.
- *Not observed:* the effect of changing a variant. The swatch plugin hides the `<select>`, and the automated selection timed out. Our requirement stands regardless: a variant change updates price, SKU, stock and gallery image.
- Not in the demo, required by the brief: buy now, frequently bought together, recently viewed, specifications table, shipping information. They go into the summary (buy now), a "Specifications" tab, a "Shipping" tab and sections after related products.

## 9. Other pages

| Page | Observed | Our version |
|------|----------|-------------|
| Cart | Empty state only. Adding to cart in the automated run left the count at 0. *Filled cart not observed.* | Line items with thumb/variant/qty stepper/remove, coupon box, totals card (subtotal, discount, shipping estimate by district, tax, total), checkout CTA |
| Checkout | Standard WooCommerce billing fields (first/last name, company, country, address 1/2, city, state, postcode, phone, e-mail, order notes). Payment methods not rendered with an empty cart. | Single page in steps: contact (phone first) → shipping address (division/district/area) → shipping method → payment → review. Login link for existing customers. |
| My account | Login form (username, password, remember me). A header dropdown offers AJAX login. | Login/register tabs, then a dashboard with orders, addresses, wishlist, profile |
| Wishlist | Plugin page (table of saved items) | Card grid with "Move to cart" |
| Blog | List with sidebar search; posts have a comment form | Blog list + category filter; post detail; comments **out of scope** for v1 (moderation burden) unless asked |
| Contact | Google map, "Get in touch with us." text, social icons, form (name, e-mail, subject, message) | Same, with an embedded map from a theme setting (OpenStreetMap or Google embed URL), form → `contact_messages` |
| About | Two image + text blocks | CMS page with rich text |
| FAQ | **404 in this demo** | CMS page with accordion from `faq_items` |
| 404 | Theme 404 page (status 404) | Own 404 with search and links |

## 10. Interactions — status

| Interaction | Status |
|-------------|--------|
| Card hover actions | Observed (§6) |
| Quick view | Observed partly: full-screen dark overlay, prev/next arrows to step through products, loading spinner. Content had not loaded within 3s headless. |
| Mobile off-canvas menu with tabs | Observed (§4) |
| Mobile bottom toolbar | Observed (§4) |
| Sticky product bar on product page | Observed (§8) |
| Search suggestions | Not observed: typing "co" returned an empty result box within 2.5s. The category list in the search select was confirmed. |
| Mega menu panel | Not observed (§4) |
| AJAX add to cart → mini-cart | Not observed (count stayed 0) |
| Variant selection effects | Not observed (§8) |
| Sticky header | Observed **absent** on the homepage |

The unobserved items are specified from the brief, not from the reference. A manual check in a normal browser can fill them in if wanted.

## 11. Component map (React, storefront entry)

`AnnouncementBar` · `SiteHeader` (`HeaderSearch`, `AccountMenu`, `CartButton`) · `MainNav` + `MegaMenu` · `CanvasMenu` (vertical menu drawer) · `MobileMenuDrawer` (tabs) · `MobileToolbar` · `PageTitleBanner` + `Breadcrumbs` · `SiteFooter` · `HeroSlider` · `BannerGrid` · `ProductTabs` · `ProductCarousel` · `ProductGrid` · `HotDeal` + `Countdown` · `NewsletterStrip` · `CategoryShowcase` · `CategoryTabs` · `BrandStrip` · `Testimonials` · `FeaturesStrip` · `ProductCard` · `ProductListItem` · `QuickViewDialog` · `FilterSidebar` (+ off-canvas) · `SortSelect` · `ViewToggle` · `Pagination` · `ProductGallery` (zoom, lightbox) · `VariantSwatches` · `QuantityStepper` · `StickyProductBar` · `ProductTabsPanel` · `ReviewList`/`ReviewForm` · `MiniCartSheet` · `CartTable` · `CheckoutSteps` · `AccountLayout`.

## 12. Design tokens (proposal, admin-editable via `theme_settings`)

```css
--sf-primary: #f59e0b;        /* orange; text on it uses --sf-primary-foreground #3b2500 (6.7:1) */
--sf-primary-strong: #a35a00; /* orange surface for white text (5.2:1) */
--sf-accent: #6f55c2;         /* lavender, darkened for white text (5.6:1) */
--sf-highlight: #2fb79a;      /* mint; dark text only */
--sf-sale: #c2410c;           /* ribbon, white text (5.2:1) */
--sf-heading: #3d3d3d;
--sf-text: #5f6368;           /* body text ≥ 4.5:1 on white */
--sf-canvas: #f3f7fa;
--sf-border: #e1e1e1;
--sf-radius-card: 12px; --sf-radius-pill: 999px;
--sf-container: 1170px;
--sf-font-heading: 'Baloo 2', 'Baloo Da 2', system-ui;
--sf-font-body: 'Poppins', 'Hind Siliguri', system-ui;
--sf-font-script: 'Pacifico', cursive;
```

These are defaults with a similar mood that pass AA, not copies of the demo values. Admins can change them; the theme screen warns when a chosen pair fails contrast.
