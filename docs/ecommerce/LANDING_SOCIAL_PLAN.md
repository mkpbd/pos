# Landing pages & social media — plan and as built

User request (2026-11-13, Bangla, translated): a landing page design option and posting to Facebook, Instagram and others. The
user chose every option offered; the work is split into P2a (landing pages) and P2b (social media).

## P2a — Landing pages (as built, 2026-11-14)

- **Order form element** (`order_form`) + **direct checkout** (`PlaceOrder::direct()`, `PlaceDirectOrder`): the same transaction,
  promotion locks, stock, numbering, payment and notifications as the cart checkout; `CartPricer::quoteItems()` /
  `CheckoutQuoter::quoteLines()` are the shared pricing path. Idempotency scope `idempotent:visitor` (customer or session hash).
  The form's rules (product/variant, quantity limit, one add-on, e-mail/note rules, COD only) are enforced server-side. Orders may
  have no e-mail (shopper e-mails skipped, staff alerts kept).
- **Attribution:** captured client-side only with UTM tags or `sl=` (last touch, 30 days), sanitized server-side, stored on orders
  with `source`; campaigns are matched at query time (short link → its campaign, else `utm_campaign`), so campaigns created later
  still pick up earlier orders.
- **Marketing module:** campaigns (archive only), short links (`/go/{code}`, registered before the storefront catch-all), visits
  (`campaign_daily_stats`, uniques via a daily salt kept only in the cache and hashes pruned after two days), stats.
  Contracts: `Orders\OrderForms`, `Orders\OrderCampaigns`, `Marketing\LandingPages`, `Marketing\AttributedOrders`,
  `ShippingRates::districtMethods()`.
- **Landing templates** (scope `page`, category `landing`) with `product_ref {source: "landing"}`; *New campaign page* dialog.
- **Campaign domains:** `storefront_domains.entry_path`; the storefront renders that page on `/` (canonical `/`) and falls back to
  the home page when it is gone.
- **Admin:** Marketing → Campaigns (tiles, by-campaign table, campaign page with by-day chart + table, by source, top landing
  pages, its short links), Short links (copy, QR code from a local encoder — byte mode, level M, versions 1–10), web order source
  and *Where it came from*, *Opens on* per domain.
- Known limits: published page data (prices, stock, delivery hints) can be stale until the next content change — the preview is
  always current; QR codes were verified by decoding in tests, not yet by a phone camera.

## P2b — Social media (as built, 2026-11-14)

- **Share bar** (`storefront/social/`): native share on coarse pointers (fallback to buttons unless the shopper closed the sheet),
  network buttons with tagged canonical links (visitor UTM tags, `sl`, click ids, `preview` and `token` stripped). Product summary
  column, after campaign page content (also on a campaign domain's entry page), under blog posts; hidden in previews and the canvas.
- **WhatsApp:** settings normalised to wa.me digits; bootstrap flags are effective values. Order message in the shopper's language
  and digits; the chat link keeps only `variant`, `q`, `page`, `lang`.
- **Feeds:** `OnlineCatalog\CatalogFeed` contract; files written item by item on the `local` disk and regenerated on catalog
  changes; token-only lookup (any host); `private, no-store` so a rotated token stops at once even behind a proxy.
- **Social module:** settings (secret write-only, encrypted), `MetaGraphClient` with `HttpMetaGraphClient` (no SDK; token exchanges
  as form POSTs; `appsecret_proof` on every user/page-token call; tokens only in the Authorization header) and
  `SandboxMetaGraphClient` (no network; `sandbox.invalid` permalinks; `#fail-test` fails); queued publishing with per-target
  conditional claims; `social:publish-due` also marks stuck targets `PUBLISH_INTERRUPTED`; short links per target through
  `Marketing\MarketingLinks`; captions through `Shared\AiTextWriter` (AI `social_captions`, template fallback).
- **Admin:** Marketing → Social posts (connection card, Meta app card with setup steps and redirect URI, composer with photo
  picker, caption suggestions, Instagram rule checklist, post list driven by `allowed_actions`, polling while publishing) and
  Marketing → Product feeds; Sharing & WhatsApp card in Online store settings.
- **Not verified against real Meta:** the live client is tested against faked Graph responses only. Meta App Review is needed for
  some permissions before posting to a real Page.
