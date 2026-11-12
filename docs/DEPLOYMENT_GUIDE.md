# Deployment Guide

> Status: baseline written in Phase 1; completed and validated in Phase 10.

## Target topology

```
            ┌──────────── HTTPS (TLS terminates here) ────────────┐
Browser ──▶ │ Nginx                                                │
            │  /assets/*   → frontend/dist/assets (static)         │
            │  /admin/builder-canvas                               │
            │              → frontend/dist/builder-canvas.html     │
            │  /admin/*    → frontend/dist/index.html (admin SPA)  │
            │  /api, /sanctum, /docs, /storage, /robots.txt,       │
            │  /sitemap*.xml, all other paths                      │
            │              → PHP-FPM (backend/public); storefront  │
            │                pages = Laravel shell around          │
            │                frontend/dist/storefront.html         │
            └──────────────────────────────────────────────────────┘
                     │                  │                  │
               PHP-FPM 8.4       queue workers (N)     scheduler (1)
                     └──────────┬───────┴──────────────────┘
                         PostgreSQL 18      Redis
```

The PHP-FPM hosts also need Node.js ≥ 22.12 and a Chromium for PDF exports (X1, below).

Serving the SPA and API from the **same origin** is required for Sanctum cookie authentication without third-party cookies.

**Store builder upgrade (B1–B4):** run `php artisan migrate` (B1 adds `builder_documents`, `builder_versions` and `builder_templates`) and `php artisan pos:permissions:sync`. The sync adds `storefront.publish` (builder and theme publishing; Organization Admin and Online Store Manager) and `storefront.custom_html` (custom HTML elements; Organization Admin only) to the built-in roles. Without the sync, nobody can publish on an existing database.

The store builder's canvas (B2) is a third built page that the admin editor loads in an iframe from the same origin. Map it before the `/admin/` fallback:

```nginx
location = /admin/builder-canvas { try_files /builder-canvas.html =404; }   # root = frontend/dist
location /admin/ { try_files $uri /index.html; }
```

## Environment (`backend/.env` in production)

```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://pos.example.com
FRONTEND_URL=https://pos.example.com
SANCTUM_STATEFUL_DOMAINS=pos.example.com
# SESSION_DOMAIN is deliberately not set: host-only cookies work on the back office and on every storefront host
SESSION_SECURE_COOKIE=true
SESSION_ENCRYPT=true
DB_CONNECTION=pgsql
CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
REDIS_CLIENT=predis
LOG_CHANNEL=daily
LOG_LEVEL=warning
# Address(es) of the TLS-terminating load balancer / reverse proxy (comma-separated, CIDR allowed), or *
TRUSTED_PROXIES=10.0.0.0/8
```

Secrets (`APP_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`, `AI_API_KEY`) come from the host's secret store or environment, never from the repository.

> **Database session timezone — UTC.** The `pgsql` connection pins the session `timezone` to `UTC` (`config/database.php`, `'timezone' => 'UTC'`); keep it. Laravel writes naive UTC timestamp strings, and PostgreSQL reads a naive string into a `timestamptz` in the *session* timezone, so on a server whose default zone is not UTC every timestamp would be stored off by that zone's offset (the first PostgreSQL run, on a server set to Asia/Dhaka, stored them 6 hours off). This matters on any managed or self-hosted server whose `timezone` setting is not UTC. Do not override it with a connection option or a role/database `ALTER … SET timezone`. Check after deploying: `php artisan tinker --execute="dump(DB::selectOne('SHOW timezone'))"` shows `UTC`.

> **PostgreSQL verification.** The full backend suite ran on PostgreSQL 18 on 2026-11-11 (747 tests, 746 pass, 1 opt-in skip), including every CHECK constraint, append-only trigger, partial unique index, the row-locking concurrency tests, the jsonb Bangla search and the report SQL; `migrate:fresh --seed` works, also repeated. Still pending before production: `EXPLAIN ANALYZE` of the heavy queries (reports, dashboard, storefront listing) on production-sized data.

> **`SESSION_DOMAIN` — leave it unset.** Host-only session cookies are what a multi-domain setup needs: the back office and every storefront host (`shop.example.com`, `www.another-shop.com`, …) each get their own cookie. Setting `SESSION_DOMAIN=pos.example.com` makes browsers drop the session cookie on every storefront host (shopper sign-in, cart and checkout then fail with 419). Set it to a common parent (`.example.com`) only if the back office and *all* storefronts live under that parent. Earlier versions of this guide showed `SESSION_DOMAIN=pos.example.com` in the sample; remove it.

> **`TRUSTED_PROXIES` — required behind a TLS-terminating proxy or load balancer.** `config/trustedproxy.php` reads it at runtime for Laravel's `TrustProxies` middleware (it works with `config:cache`): a comma-separated list of proxy addresses or CIDR ranges, or `*` when the application is reachable *only* through the proxy. Without it Laravel ignores `X-Forwarded-Proto` / `X-Forwarded-For`, so (1) links in e-mails (order confirmation, e-mail verification, password reset, newsletter) say `http://`, (2) the guest `cart_token` cookie loses its `Secure` flag, and (3) every rate limit (`storefront`, `storefront-write`, `customer-auth`, `checkout`, `auth`) counts all visitors as the proxy's single IP. Leave it empty only when PHP is reached directly over HTTPS. Covered by `Shared/Tests/Feature/TrustedProxiesTest`.

Storefront hosts: every host listed under **Online store → Domains** must point at this server (and be covered by the TLS certificate); the backend resolves the organization from the `Host` header. Settings: `STOREFRONT_SHELL_PATH` (default `../frontend/dist/storefront.html`), `MEDIA_DISK` (`public`, or an S3-compatible disk whose URL is the CDN). Leave `STOREFRONT_DEFAULT_HOST` empty in production.

Newsletter confirmations and other storefront e-mails need a working mailer (`MAIL_*`) and a queue worker (the confirmation e-mail is queued). Links in these e-mails use the host the visitor signed up on. HTMLPurifier caches its compiled definitions in `storage/framework/cache/htmlpurifier` (created on first use; the storage directory must be writable).

Online catalog (E6):
- **The scheduler must run** (`php artisan schedule:run` every minute from cron, or `php artisan schedule:work` under a supervisor): it refreshes the storefront popularity figures hourly (`storefront:refresh-product-stats`, also runnable by hand, `--organization=<id>` for one tenant). Without it the *popularity* sort and *best sellers* sections use stale or no data.
- The E6 migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and builds a trigram index on product names. The migrating role needs the right to create the extension (on PostgreSQL 13+ `pg_trgm` is a trusted extension, so `CREATE` privilege on the database is enough; otherwise create it once as a superuser before `migrate`, after which the statement is a no-op).
- Run `php artisan pos:permissions:sync` after deploying (as in the release steps) so the built-in roles receive `online_catalog.view`, `online_catalog.manage` and `attributes.manage`.
- Choose a **fulfilment store** under *Online store → Settings & domains*; until then stock-tracked products show as out of stock on the storefront.

Customer accounts and cart (E7):
- **Mail must work** before the store opens sign-up: the e-mail confirmation (link valid 24 hours) and password-reset (60 minutes) messages are queued notifications, so they need `MAIL_*` and a running queue worker. With `MAIL_MAILER=log` shoppers can still sign up and shop (unverified accounts are allowed) but can never confirm their address or reset a forgotten password. Links use the scheme and host of the shopper's request: storefront hosts must be served over HTTPS, and if TLS terminates at a proxy in front of PHP, set `TRUSTED_PROXIES` (see above) so the request is seen as `https` — otherwise links say `http://` and the `cart_token` cookie loses its `Secure` flag.
- **Sessions on storefront hosts.** Shopper sign-in, cart and wishlist use the normal Laravel session cookie on each storefront host (the `storefront.session` middleware; storefront hosts are **not** added to `SANCTUM_STATEFUL_DOMAINS`). The session cookie must be accepted on every host: leave `SESSION_DOMAIN` unset as in the sample above (host-only cookies — needed whenever storefront domains are not sub-domains of one parent), or set it to a common parent (`.example.com`) only if every storefront and the back office live under it. A `SESSION_DOMAIN=pos.example.com` would make browsers drop the session cookie on `shop.example.com`, and every shopper write would fail with 419. Keep `SESSION_SECURE_COOKIE=true` (HTTPS on every host); the middleware forces httpOnly and SameSite=Lax. Shopper sessions use the same `SESSION_LIFETIME` and store (Redis) as staff sessions; "remember me" uses a long-lived remember cookie of the `customer` guard.
- **The scheduler must run** (as for E6): `cart:prune` runs daily and deletes guest carts 30 days after their last change. Without it abandoned guest carts accumulate (they are ignored once expired, but never deleted).
- `php artisan pos:permissions:sync` as in the release steps. E7 adds **no new permission**: the staff switch that disables a shopper's online sign-in uses the existing `customers.manage`, and the customer sheet's *Online store account* card `customers.view`.
- The E7 migrations create global reference tables `geo_divisions` / `geo_districts` and fill them with Bangladesh's 8 divisions and 64 districts (no external download). They are global — never truncate them per tenant.
- Rate limits: sign-up, sign-in, password reset/change and resend-verification use `customer-auth` (`POS_AUTH_RATE_LIMIT` per e-mail+IP, four times that per IP); shopper writes 60/min per IP and per customer. Behind a proxy the real client IP also needs `TRUSTED_PROXIES`, or all shoppers share one IP bucket.

Checkout and orders (E8a):
- **The scheduler must run every minute** (`php artisan schedule:run` from cron, or `schedule:work` under a supervisor): `orders:expire-pending` (every minute, `withoutOverlapping`) cancels bank-transfer orders whose payment hold ran out and **puts their stock back**. Without it unpaid bank-transfer orders keep their stock reserved forever. It is safe to run by hand and in parallel (orders are taken with `FOR UPDATE SKIP LOCKED`).
- **Mail and a queue worker:** the order confirmation e-mail (lines, totals, address, bank-transfer instructions, link to the order page — with the guest's access token) is a queued notification. With `MAIL_MAILER=log` orders still work, but guests never receive the link to their order page (they see it once, right after placing the order). The link uses the scheme and host of the checkout request, so `TRUSTED_PROXIES` matters here too.
- Run `php artisan pos:permissions:sync` (as in the release steps) so the built-in roles receive the new permissions: `web_orders.view`, `web_orders.manage` and `shipping.manage` (Organization Admin and Online Store Manager) and `payment_gateways.manage` (Organization Admin only, ADR-016). Staff with `web_orders.view` receive the "New online order" inbox notification.
- **Before opening checkout:** a fulfilment store must be set (without one checkout answers `CHECKOUT_UNAVAILABLE`); create delivery zones and methods under *Online store → Shipping* (districts without an active zone get no delivery method, so shoppers there cannot order); review *Online store → Payments* (cash on delivery is on by default; bank transfer is off until enabled with instructions — the bank account details — and a hold time); decide *Allow guest checkout* under *Online store → Settings & domains* (on by default).
- Rate limit: `POS_CHECKOUT_RATE_LIMIT` (default 10) checkout previews and placements per minute per IP and shopper. The checkout page previews 250 ms after each change, so very fast typists on a shared IP may briefly hit it; raise it rather than disabling it.
- Migrations: the idempotency scope change rewrites the unique key of `idempotency_keys` (backfills `scope` for existing rows — quick, the table is pruned daily); the orders migration creates PostgreSQL triggers that make order lines, allocations and history append-only.
- The PostgreSQL-only `CheckoutConcurrencyTest` (two checkouts racing for the last unit) and the order triggers passed on PostgreSQL 18 (2026-11-11).

Promotions and coupons (E8b):
- Run `php artisan pos:permissions:sync` (as in the release steps) so the built-in roles receive `promotions.view` and `promotions.manage` (Organization Admin through `*`; Online Store Manager already lists `promotions.*`, ADR-016). Until then existing databases show no *Promotions* entry in the admin.
- Rate limit: `POS_COUPON_RATE_LIMIT` (default 10) coupon codes tried per minute per signed-in customer, else per guest cart, else per IP (`config('pos.coupon_rate_limit')`) — against guessing codes. Keep it low in production; behind a proxy `TRUSTED_PROXIES` must be right for the IP fallback.
- Migrations: new tables `promotions`, `promotion_targets`, `coupons`, `promotion_redemptions`, `order_promotions`; new columns `orders.discount_total`, `shipping_discount`, `coupon_code`, `order_lines.discount_amount` (all default 0 / NULL, so existing orders stay valid) and `carts.coupon_code`. On PostgreSQL they add CHECK constraints and the append-only triggers on `promotion_redemptions` and `order_promotions`.
- No scheduler job: promotions start and end by their timestamps at request time; flash-sale prices revert on the storefront when `ends_at` passes. Cancelling or expiring an order does **not** give a coupon use back.
- The PostgreSQL-only `PromotionConcurrencyTest` (two placements racing for a single-use coupon), the CHECK constraints and the triggers passed on PostgreSQL 18 (2026-11-11).

Customer account area and reviews (E9):
- Run `php artisan pos:permissions:sync` (as in the release steps) so the built-in roles receive `reviews.view` and `reviews.moderate` (Organization Admin through `*`; Online Store Manager already lists `reviews.*`, ADR-016). Until then existing databases show no *Reviews* entry in the admin, and nobody can approve reviews — new reviews stay pending and invisible on the storefront.
- Rate limit: `POS_REVIEW_RATE_LIMIT` (default 5) new reviews per hour per signed-in customer (`config('pos.review_rate_limit')`); refused attempts count. Edits and deletes use the normal shopper write limit.
- **Mail and a queue worker:** a customer's cancellation sends a queued confirmation e-mail (link to `/account/orders/{number}` with the request's scheme and host — `TRUSTED_PROXIES` matters as for E8a); staff with `web_orders.view` get an inbox notification.
- Migrations: new table `reviews` (foreign keys to organizations, products, customers, order lines and users; on PostgreSQL the CHECK `reviews_rules_check`) and the nullable column `order_status_history.actor_type` (PostgreSQL CHECK; existing history rows stay NULL and are derived when shown — no backfill, the table is append-only). Both are additive; `migrate --force` before switching traffic as usual.
- No scheduler job and no cache: the rating summary is computed from approved reviews per request.
- The new PostgreSQL CHECKs ran with the full suite on PostgreSQL 18 (2026-11-11).

Fulfilment: couriers, shipments, printing and COD remittances (E10a):
- Run `php artisan pos:permissions:sync` (as in the release steps) so the built-in roles receive the new `web_orders.remit` (Organization Admin through `*`, Online Store Manager through `web_orders.*`) and the **Accountant** role its two new permissions `web_orders.view` and `web_orders.remit` — accountants then see *Web orders* and *COD remittances* in the admin. Until then existing databases show no *COD remittances* entry in the admin.
- **Before shipping the first order after the upgrade:** create the couriers under *Online store → Shipping → Couriers* (optionally with a tracking link template, `https://…{tracking}…`). `POST /web-orders/{id}/ship` now requires `courier_id`; with no active courier the admin's *Ship* dialog only links to the settings. Orders already shipped keep their courier text and can still be marked delivered, but get no tracking updates.
- Migrations: new tables `couriers` (Shipping), `shipments`, `shipment_events`, `cod_remittances`, `cod_remittance_lines` (Orders) — additive, no backfill. On PostgreSQL they add CHECK constraints and the append-only triggers on `shipment_events`, `cod_remittances` and `cod_remittance_lines` (reusing `prevent_order_detail_mutation()` from the E8a orders migration, so the migrations must run in order).
- Remittances book the courier fee in the expense category "Courier fees", created on the first remittance with a fee. Remittances cannot be edited or deleted (a reversal may come with E10b), so check the order list before recording one.
- Printing is done by the browser (print-ready HTML, "Save as PDF" in the print dialog) — no PDF tool to install. The organization's legal name, address, phone, e-mail and tax/BIN number and the storefront logo appear on packing slips and invoices, so fill them in.
- No new scheduler job, queue job, environment variable or rate limiter.
- The new PostgreSQL CHECKs and triggers ran with the full suite on PostgreSQL 18 (2026-11-11). Deleting a courier still in use now answers the "in use" error instead of 500 (PostgreSQL raises SQLSTATE 23001 for `ON DELETE RESTRICT`).

Online returns and refunds, customer web activity, promotion report, ratings on cards (E10b):
- Run `php artisan pos:permissions:sync` (as in the release steps) so the built-in roles receive the new `web_orders.refund` (Organization Admin through `*`, Online Store Manager through `web_orders.*`, the **Accountant** explicitly). Until then nobody but platform admins can approve, receive or refund returns, and nobody gets the "return requested" inbox notification; *Web returns* is visible (read-only) to anyone with `web_orders.view`.
- Migrations: `return_window_days` on `storefront_settings` (default 7 — online returns are **on** for every storefront after the upgrade; set `0` under *Online store → Settings → Checkout → Return window* to switch them off), `orders.refunded_total` (default 0) and the new tables `order_returns`, `order_return_lines`, `order_return_line_stock`, `order_return_history` — additive, no backfill. On PostgreSQL they add the CHECKs (`storefront_settings_return_window_check`, `orders_refunded_total_check`, `order_returns_rules_check`, `order_return_lines_rules_check`, …), the append-only triggers on `order_return_line_stock` and `order_return_history` (reusing `prevent_order_detail_mutation()` from the E8a orders migration — run the migrations in order) and the `order_return_lines_guard` trigger with its function `guard_order_return_line()`.
- **Mail and a queue worker:** approved, rejected and refunded returns send a queued e-mail to the order's contact address. Its link to the account order page uses the organization's primary storefront domain (scheme from `APP_URL`); without a domain, or for guest orders, the e-mail has no link. A customer's new request creates a database notification for staff with `web_orders.refund`.
- **Cash refunds** come out of the refunding user's open register session in the order's branch (`CASH_SESSION_REQUIRED` without one); bank transfer and mobile banking refunds need no session. Refunds appear in the payments ledger as `online_order_refund`.
- No new scheduler job, environment variable or rate limiter (return writes use the shopper write limit). No cache: card ratings come from one grouped query per listing.
- The new PostgreSQL CHECKs and triggers ran with the full suite on PostgreSQL 18 (2026-11-11).

Blog, popup banner and refunds for paid cancellations (E11):
- No new permission. `pos:permissions:sync` only refreshes descriptions. **Cancelling a paid web order needs `web_orders.refund`** (Organization Admin, Online Store Manager, Accountant); `web_orders.manage` alone still cancels unpaid orders only — users without `web_orders.refund` get a 403 on paid orders and see no *Cancel* action for them. The blog uses `cms.manage`.
- Migrations: new tables `blog_categories`, `blog_posts` (Cms); `banners.popup_delay_seconds`, `banners.popup_frequency` (Storefront) — additive, no backfill. On PostgreSQL they add the blog CHECKs, rebuild `banners_placement_check` (adds `popup`) and `menu_items_target_check` (adds the targetless `blog` type) and add `banners_popup_settings_check`. Existing banners and menu items satisfy the new checks unchanged. The down migration of the Storefront part fails on PostgreSQL while `popup` banners or `blog` menu items exist — delete them first.
- **Mail and a queue worker:** a paid cancellation sends a queued e-mail (`OrderCancelledWithRefundEmail`) to the order's contact address after commit, linking to the account order page on the primary storefront domain for orders of a customer. Without a worker the cancel and refund still complete; the e-mail waits in the queue.
- **Cash refunds** of paid cancellations come out of the cancelling user's open register session in the order's branch (`CASH_SESSION_REQUIRED`, `INSUFFICIENT_CASH`), as return refunds (E10b).
- **Media:** blog covers come from the media library (`php artisan storage:link` as for other images); a cover used by a post cannot be deleted. The shell's `og:image` is made absolute from the request's scheme and host, so set up the storefront domain (and trusted proxies behind TLS termination) for correct share previews.
- The popup is off until a banner with placement *Popup* is active; at most one shows (the first live by sort order). Visitors' "already seen" state lives in their browser (`localStorage` / `sessionStorage`) — editing the banner shows it again.
- No new scheduler job, environment variable, rate limiter or cache. Scheduled posts appear by time (`published_at ≤ now` at read time) — no job needed.
- The new PostgreSQL CHECKs ran with the full suite on PostgreSQL 18 (2026-11-11).

SEO and performance (E12a):
- **Web server routing:** `/robots.txt`, `/sitemap.xml` and `/sitemaps/*.xml` are answered by Laravel per storefront host. `backend/public/robots.txt` was removed — delete any copy left on the server and make sure Nginx neither serves a static `robots.txt` / `sitemap*.xml` (e.g. from `frontend/dist` or a `location = /robots.txt` block) nor answers them from a static-file `location ~* \.(txt|xml)$` rule; `try_files $uri /index.php?$query_string` is fine once no file exists. Check after deploying: `curl -i https://{storefront host}/robots.txt` lists `Sitemap:` for an open store; `/sitemap.xml` returns `application/xml`.
- **Cache store:** the storefront caches the bootstrap, homepage, catalog candidate set and sitemaps in the default cache store under a per-organization version counter (no cache tags). Use `CACHE_STORE=redis` (recommended) or `database` in production; the `array` store does not share entries between requests and is for tests only. With several app servers the store must be shared (Redis or the database). Flushing the cache is safe (counters restart from the current time).
- **Keep `cache.serializable_classes` = `false`** (`config/cache.php`): cached values are plain arrays by rule; do not allow classes to work around an unserialize error — fix the cached value instead.
- **Staging / preview stores:** switch off *Online store → Settings → Search engines → Allow search engines to index the store* (`allow_indexing`) on any storefront that must not appear in search results (robots `Disallow: /`, sitemaps 404, every page `noindex`). Secondary domains always get `Disallow: /`; the sitemap and `Sitemap:` line use the primary domain with the scheme of `APP_URL`.
- **HTTP caching:** public storefront reads send `Cache-Control: public, max-age=60, stale-while-revalidate=300` and a weak `ETag` for anonymous visitors; answers with a session or cookie are `private`. A CDN or proxy in front must respect `Cache-Control` and must not cache responses that set cookies (no `Vary` header is sent on API answers; public answers carry no personal data; since E12b the HTML shell sends `Vary: Cookie`). Browsers may show a changed page up to 60 s late (plus up to 300 s of stale-while-revalidate, refreshed in the background); the server cache itself is invalidated at commit.
- Migrations: `storefront_settings.allow_indexing` (default `true` — existing stores stay indexable) and three indexes on `product_listings` / `product_variants` (partial on PostgreSQL; plain `CREATE INDEX`, which locks writes to those tables briefly — run at a quiet time on large catalogs). No permission, environment variable, scheduler job or rate limiter (`robots.txt` and sitemaps use the `storefront` limiter).
- The frontend build splits the storefront into lazy chunks: deploy the whole `frontend/dist/assets` directory and keep the previous build's assets for a while, so open tabs can still load chunks they have not fetched yet.
- The index test (`StorefrontIndexesTest`) passed on PostgreSQL 18 (2026-11-11). `EXPLAIN` of the storefront queries on production-sized data is still pending.

Bangla storefront and content translations (E12b):
- **Migrations** (`2026_11_05_100000`–`100700`): nullable `translations` jsonb on `product_listings`, `category_listings`, `brand_listings`, `cms_pages`, `faq_items`, `blog_categories`, `blog_posts`, `menu_items`, `banners`, `homepage_sections`, `shipping_methods`, `payment_gateways`, `promotions`; `storefront_settings.bangla_enabled` (default `true`), `default_locale` (default `en`), `bangla_digits` (default `false`); `orders.locale` (default `en`); `customer_accounts.preferred_locale` (nullable). Additive, no backfill; on PostgreSQL each adds a CHECK (`{table}_translations_check`, `storefront_settings_default_locale_check`, `orders_locale_check`, `customer_accounts_preferred_locale_check`). `ALTER TABLE … ADD COLUMN` with a constant default does not rewrite tables on PostgreSQL; adding the CHECKs scans each table once — run at a quiet time on large `orders` tables.
- **After the upgrade every store is bilingual** (Bangla on, English default) and shows the *English / বাংলা* switcher; untranslated content reads in English. Switch Bangla off under *Online store → Settings → Languages* where it is not wanted.
- **`lang` cookie:** written by the storefront SPA (1 year, `path=/`, `SameSite=Lax`, not HttpOnly, no secret) and excluded from cookie encryption (`bootstrap/app.php`); do not add it back to the encrypted cookies or the shell stops reading it. It is a client-side preference, so it does not appear in the security checklist's HttpOnly rule.
- **CDN / proxy:** storefront HTML pages now send `Vary: Cookie` (the language can come from the cookie) — a CDN must honour it or not cache the shell. The public API carries the language in the URL (`?lang=`) and sends `Content-Language`; no `Vary` there, so URL-keyed caching stays correct. Server cache entries and ETags are per language (`storefront:{org}:v{version}:{locale}:{key}`); the first Bangla reads after a deploy fill a second set of entries.
- **Fonts:** new self-hosted Fontsource packages `@fontsource/hind-siliguri` 5.3.0 and `@fontsource-variable/baloo-da-2` 5.3.0 (`npm ci`); the build emits their `woff2` files into `frontend/dist/assets` (8 files, ≈ 450 KB, fetched only on Bangla pages per `unicode-range`). No external font origin. The Bangla dictionary is a separate lazy chunk — deploy the whole `assets` directory as before.
- **Search engines:** with Bangla on, indexable pages list `hreflang` alternates and sitemaps list `xhtml:link` alternates (`?lang=bn` URLs for an English-default store). Bangla URLs are `?lang=` variants of the same paths — no new routes or rewrite rules.
- E-mails stay English (localized e-mails: E13). No new permission, environment variable, scheduler job or rate limiter.
- The new PostgreSQL CHECKs and the jsonb search expression (`lower(translations->'bn'->>'name') LIKE …`) ran with the full suite on PostgreSQL 18 (2026-11-11).

PDF and Excel export on admin lists (X1):
- **PHP 8.4 is required** (`composer.json` `php` `^8.4`; OpenSpout 5 needs it). `composer install` refuses PHP 8.3.
- **Excel** needs nothing beyond `composer install` (OpenSpout, pure PHP; `zip` extension as before). Files are written to `storage/app/private/exports` and deleted after sending — the storage directory must be writable.
- **PDF prerequisites** (otherwise PDF answers 503 `PDF_UNAVAILABLE` and Excel keeps working):
  - **Node.js ≥ 22.12** on the PHP host (`PDF_NODE_BINARY`, default `node` on `PATH` of the PHP-FPM user; `PDF_NPM_BINARY`, default `npm`).
  - **A system Chrome or Chromium** (e.g. `apt install chromium`). Set `PDF_CHROME_PATH` to its executable; when empty the app tries `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/snap/bin/chromium`. A configured path that does not exist is not replaced by auto-detection.
  - **The renderer package:** `cd backend/pdf-renderer && PUPPETEER_SKIP_DOWNLOAD=1 npm ci` on every release (installs `puppeteer-core` from the committed lockfile; no Chromium download). `PDF_NODE_MODULES_PATH` (default `backend/pdf-renderer/node_modules`) and `PDF_RENDERER_SCRIPT` (default `backend/pdf-renderer/browser.cjs`) only need changing for a non-standard layout.
  - **Containers / root:** Chrome's sandbox needs user namespaces. Where they are unavailable (most containers, or Chrome running as root) set `PDF_NO_SANDBOX=true`; the HTML rendered is the app's own, escaped, with JavaScript disabled, but prefer running PHP-FPM as a non-root user with the sandbox on.
  - `PDF_TIMEOUT` (default 60 s) bounds one render; a timeout answers 503. Rendering writes a temporary directory under `storage/app/private/pdf-render` and removes it.
  - Fonts (Poppins, Hind Siliguri) ship in `backend/resources/fonts` and are inlined — no system fonts or network access needed for Bangla.
- **Environment keys** (all optional): `EXPORT_MAX_ROWS_XLSX` (50000), `EXPORT_MAX_ROWS_PDF` (2000), `EXPORT_MAX_ROWS_CSV` (100000, Phase 7), `EXPORT_RATE_LIMIT` (10 per minute per user), `EXPORT_CHUNK_SIZE` (500 rows per query); `PDF_CHROME_PATH`, `PDF_NODE_BINARY`, `PDF_NPM_BINARY`, `PDF_NODE_MODULES_PATH`, `PDF_RENDERER_SCRIPT`, `PDF_TIMEOUT`, `PDF_NO_SANDBOX`. Run `php artisan optimize` after changing them (config cache).
- Check after deploying: `GET /api/v1/customers?export=pdf` as an admin returns `application/pdf`; a 503 `PDF_UNAVAILABLE` means Chrome, Node or `node_modules` is missing (the reason is logged as "PDF rendering failed." at warning level when Chrome itself fails).
- Exports run inside the web request (no queue); a 2 000-row PDF takes seconds. Keep PHP-FPM's `request_terminate_timeout` and the proxy timeout above `PDF_TIMEOUT`.
- Licenses: OpenSpout and Browsershot MIT, puppeteer-core Apache-2.0, fonts SIL OFL 1.1 (license files kept beside the fonts).
- No migration, permission, scheduler job or queue job. Exports are audited (`export.created`).
- Business dates (GRN invoice and manufacturing dates, supplier payments, expenses) are now checked against today in the organization's timezone; set each organization's timezone correctly. `config/app.php` stays UTC.
- The export tests ran with the full suite on PostgreSQL 18 (2026-11-11); only the opt-in real PDF render (`PDF_E2E=1`) was skipped.

Supplier catalog, reorder suggestions and replenishment (SC1):
- **Migrations** (additive, no backfill): Inventory `2026_11_06_100000_create_replenishment_tables` (`stock_reorder_rules`, `replenishment_settings`), Purchasing `2026_11_06_100100_create_supplier_catalog_tables` (`supplier_products` with the partial unique index `supplier_products_preferred_unique`, `reorder_notification_runs`). `php artisan migrate --force` as usual.
- **Run `php artisan pos:permissions:sync`.** The new permission `inventory.manage` (reorder rules, replenishment settings) reaches the built-in roles Organization Admin (`*`), Branch Manager and Inventory Manager (`inventory.*`) only after the sync; until then the *Inventory → Settings* tab is hidden, reorder rules are read-only and `PUT /inventory/reorder-rules` / `PATCH /inventory/replenishment-settings` answer 403. Custom roles need it added by hand.
- **The scheduler must run** (`php artisan schedule:run` every minute from cron, or `schedule:work`): `purchasing:reorder-notifications` is scheduled **hourly** (`withoutOverlapping`) and notifies each organization from 07:00 in its own timezone, once per store and local day (claimed in `reorder_notification_runs`). Without the scheduler there are no daily *Reorder needed* alerts; the Reorder page works regardless. Manual run: `php artisan purchasing:reorder-notifications --any-hour`. Set each organization's timezone correctly.
- Recipients are users with `purchases.manage` in the store's branch (database notifications, no e-mail, no queue job).
- Optional after deploying: choose a source (central) store under *Inventory → Settings → Replenishment* to get transfer suggestions; without one every suggestion is a purchase. Replenishment transfers are dispatched immediately (stock leaves the source at once).
- No new environment variable, queue job, rate limiter or dependency.
- The new PostgreSQL CHECKs and the partial unique index ran with the full suite on PostgreSQL 18 (2026-11-11).

Purchase requisitions, approvals and supplier quotes (SC2):
- **Migration** (additive, no backfill): Purchasing `2026_11_07_100000_create_procurement_tables` — `purchase_approval_settings`, `purchase_requisitions` + lines + status history, `rfqs`, `rfq_lines`, `rfq_suppliers`, `supplier_quotes` + lines, `rfq_awards`, `rfq_status_history`, `rfq_reminder_runs`, `purchase_order_status_history`, approval columns on `purchase_orders`; on PostgreSQL it rebuilds `purchase_orders_status_check` (adds `pending_approval`) and creates the function `prevent_procurement_history_mutation()` with four append-only triggers. Existing orders keep their status. `php artisan migrate --force` as usual.
- **Run `php artisan pos:permissions:sync`.** New permissions `purchases.request`, `purchases.approve`, `purchases.approve_high`, `purchases.settings`; the sync also applies the changed role map: Branch Manager's and Inventory Manager's `purchases.*` become explicit lists (Branch Manager approves up to the manager limit, Inventory Manager does not approve), Cashier gains `purchases.request`, Organization Admin keeps all through `*` (the only built-in role with `purchases.approve_high` and `purchases.settings`). Built-in roles hold expanded permission lists, so until the sync **nobody — the Organization Admin included — holds the new permissions**: requisitions, approvals and the approval limits are unavailable, while purchase order approval is already enforced (default on), so drafts above 10 000.00 cannot be approved or placed. Run the sync right after migrating. Custom roles need the permissions added by hand.
- **Check the approval limits** under *Purchasing → Settings* (defaults: auto-approve up to 10 000.00, manager up to 100 000.00, purchase order approval on). With approval on, draft orders above the auto limit can no longer be placed directly (*Save & submit* sends them for approval; `POST …/place` answers `APPROVAL_REQUIRED`); integrations that place orders through the API must submit instead, or the setting must be turned off.
- **A queue worker must run** for RFQ e-mails: suppliers with an e-mail address get a queued mail with the PDF attached (base64 inside the job, so allow for job payloads of a few hundred KB on the queue backend). Configure outgoing mail (`MAIL_*`) and the organization's e-mail (used as reply-to). Without a worker the RFQ shows the supplier as e-mailed but nothing leaves; suppliers without an address are always "send manually" (download the PDF).
- **PDF prerequisites are those of X1** (system Chromium, `backend/pdf-renderer` with `npm ci`, `PDF_*` keys above): the RFQ PDF is rendered when an RFQ is sent to a supplier with an e-mail address and on each download. Without a renderer those requests answer 503 `PDF_UNAVAILABLE` and nothing is sent; RFQs to suppliers without an e-mail address can still be sent.
- **The scheduler must run:** `purchasing:rfq-reminders` is scheduled **hourly** (`withoutOverlapping`) and reminds each RFQ's creator from 07:00 organization time, once per RFQ and local day, while suppliers have not answered after the reply-by date (claimed in `rfq_reminder_runs`). Manual run: `php artisan purchasing:rfq-reminders --any-hour`.
- Approval and reminder notifications are database notifications (no e-mail, no queue job).
- No new environment variable, rate limiter or dependency.
- The new PostgreSQL CHECKs and triggers ran with the full suite on PostgreSQL 18 (2026-11-11).

Landed cost and supplier performance (SC3):
- **Migrations** (additive; run in this order by their timestamps): Inventory `2026_11_08_100000_add_value_to_stock_movements` (nullable `stock_movements.value`; on PostgreSQL the CHECK `stock_movements_value_only_check` — existing rows satisfy it, `value` stays NULL), Expenses `2026_11_08_100100_add_on_account_to_expenses` (`expenses.on_account` default false), Purchasing `2026_11_08_100200_create_landed_cost_tables` (receipt totals and line columns, `goods_receipt_charges`, `landed_cost_vouchers` + charges + receipts, `landed_cost_allocations`; on PostgreSQL the CHECKs, the function `prevent_landed_cost_mutation()` and two append-only triggers). **Backfill inside the migration:** every existing goods receipt gets `landed_total = subtotal` and `payable_total = total`, every existing receipt line `landed_unit_cost = unit_cost` (one `UPDATE` per table — on a large `goods_receipt_lines` table plan for it inside the deploy window). Supplier balances are unchanged by the backfill (`payable_total` = the old `total`). `php artisan migrate --force` as usual.
- **Run `php artisan pos:permissions:sync`.** New permission `purchases.landed_cost` (create, edit, delete and post landed cost vouchers, and the voucher preview) for Branch Manager, Inventory Manager and Accountant; Organization Admin through `*`. Built-in roles hold expanded permission lists, so until the sync **nobody — the Organization Admin included — holds it**: the *Landed costs* list is readable (`purchases.view`) but vouchers cannot be created or posted. Custom roles need it added by hand. Receipt charges need no new permission (`purchases.receive`); supplier performance reads with `purchases.view`.
- From this release goods receipts with charges post stock at the landed unit cost, and supplier balances count receipts at `payable_total`. Expenses booked by vouchers are **on account**: they write no payments-ledger row (cash and bank reports do not show them as outflows; the supplier payment does) and cannot be voided.
- No new environment variable, queue job, scheduled command, rate limiter or dependency.
- The new PostgreSQL CHECKs and triggers ran with the full suite on PostgreSQL 18 (2026-11-11).

Reports and dashboard (Phase 7):
- **Migration** (additive, no data change): Reports `2026_11_09_100000_add_reporting_indexes`. It creates seven indexes with `CREATE INDEX IF NOT EXISTS`:
  - `sales (organization_id, status, sold_at)`;
  - `sale_returns (organization_id, status, decided_at)`;
  - `orders (organization_id, status, delivered_at)`;
  - `order_returns (organization_id, status, refunded_at)`;
  - `payments (organization_id, created_at)`;
  - `goods_receipts (organization_id, invoice_date)`;
  - `purchase_returns (organization_id, created_at)`.

  `CREATE INDEX` without `CONCURRENTLY` blocks writes to that table while it builds. On large `sales` / `payments` tables, run the migration in the deploy window, or create the same indexes beforehand with `CREATE INDEX CONCURRENTLY IF NOT EXISTS <name> ON …` (same names) so the migration finds them. `php artisan migrate --force` as usual. No tables, views or materialized views.
- **Run `php artisan pos:permissions:sync`.** New permissions `reports.view`, `reports.financial` and `dashboard.view`. The sync also applies the changed role map:
  - Branch Manager and Accountant: `reports.*` + `dashboard.view`;
  - Inventory Manager: `reports.view` + `dashboard.view`, replacing the old undefined `reports.inventory`;
  - Cashier: `dashboard.view`;
  - Organization Admin through `*`.

  Until the sync nobody, the Organization Admin included, sees *Dashboard* or *Reports*: the sidebar entries need the permissions, and `/dashboard` and `/reports*` answer 403. Custom roles need the permissions added by hand. Only give `reports.financial` to roles that should see COGS and gross profit: P&L and tax are not filtered by `products.view_cost`.
- **Landing page:** after the sync, owners, managers, accountants and inventory managers land on *Dashboard* instead of the POS terminal or their first page. Cashiers still land on the POS terminal.
- **CSV exports:** every export endpoint now accepts `?export=csv` (`text/csv; charset=UTF-8`). It is written to `storage/app/private/exports` like xlsx, so that directory needs the same write permission. Optional `EXPORT_MAX_ROWS_CSV` (default 100000; not in `.env.example`). The export throttle and audit cover CSV.
- **Dashboard cache:** answers are cached for 60 s in the default cache store per organization × branch scope × range × day × access. No invalidation, no tags, plain arrays: any store works, and Redis is recommended as for the storefront.
- No new queue job, scheduled command, rate limiter or dependency (charts are hand-written SVG).
- The report SQL (`AT TIME ZONE` grouping, NUMERIC aggregates) and the new indexes ran with the full suite on PostgreSQL 18 (2026-11-11). **Still pending:** `EXPLAIN ANALYZE` of the sales, P&L, tax and dashboard queries on production-sized data before production. Summary tables or materialized views are deferred until then.

AI assistant and insights (Phase 8 / AI1, optional — [AI_INTEGRATION.md](AI_INTEGRATION.md)):
- **Off by default.** Nothing changes for a deployment that leaves `AI_ENABLED` unset: the assistant answers `503 AI_UNAVAILABLE`, insight pages show their facts without a summary, every other function is unaffected.
- **Migration** (additive): AI `2026_11_10_100000_create_ai_tables` creates `ai_settings`, `ai_requests`, `ai_insights` (PostgreSQL CHECKs on `period` and `data_sharing_level`). No change to existing tables.
- **Run `php artisan pos:permissions:sync`.** New permissions `ai.ask`, `ai.insights`, `ai.manage`. The role map changes: Branch Manager `ai.ask` + `ai.insights` (replacing the undefined `ai.*`, which would have matched `ai.manage`), Accountant `ai.ask` + `ai.insights`, Inventory Manager `ai.ask`, Organization Admin through `*`. Until the sync nobody, the Organization Admin included, sees *AI Insights* or the *AI* settings card (built-in roles hold expanded permission lists). Custom roles need the permissions added by hand.
- **Environment** (backend `.env`, from the secret store):

  ```
  AI_ENABLED=true
  AI_PROVIDER=anthropic
  AI_MODEL=claude-sonnet-5-5
  AI_API_KEY=<from the secret store>
  # optional: AI_TIMEOUT=30, AI_MAX_TOOL_ROUNDS=4, AI_MONTHLY_TOKEN_BUDGET=2000000 (0 = unlimited), AI_TOOL_ROW_LIMIT=50,
  # AI_ASK_RATE_LIMIT=20, AI_MAX_TOKENS=8000, AI_EFFORT=low, AI_REFUSAL_FALLBACK=true, AI_MAX_RETRIES=2,
  # AI_ANTHROPIC_BASE_URL=https://api.anthropic.com, AI_ANTHROPIC_VERSION=2026-10-21, AI_RETRY_BASE_MS=500, AI_RETRY_MAX_MS=8000
  ```

  **Never commit the key** (not in `.env.example`, not in the repository, not in CI logs). The application never logs, stores or returns it; provider errors log only status, error type and request id. Rotate it in the provider console if it leaks. `AI_PROVIDER=fake` is ignored in production (no provider is bound). Re-run `php artisan optimize` (config cache) after changing these keys.
- **Egress:** the API servers (PHP-FPM and the scheduler host) need outbound HTTPS to `api.anthropic.com:443` (or `AI_ANTHROPIC_BASE_URL`). Calls are synchronous in the request. Each attempt times out after `AI_TIMEOUT` seconds (connect ≤ 10 s) and is retried up to `AI_MAX_RETRIES` times with backoff (worst case about 100 s per call with the defaults), and a question makes up to `AI_MAX_TOOL_ROUNDS` + 1 calls. Size the PHP-FPM pool and the proxy / load balancer read timeout for `/api/v1/ai/*` with that in mind, or lower `AI_TIMEOUT` / `AI_MAX_RETRIES`.
- **The scheduler must run:** `ai:daily-insights` is scheduled every 30 minutes (`withoutOverlapping`) and stores yesterday's daily insight per organization and active branch from 07:30 organization time, once per scope and day (unique key in `ai_insights`). Without it the first reader of a day computes the insight on demand (slower first load). Manual run: `php artisan ai:daily-insights --any-hour [--date=Y-m-d]`. It stores facts even with AI off.
- **Enabling per organization:** with `AI_ENABLED=true` and a key, AI is on for every organization (`ai_settings.enabled` defaults to true). An Organization Admin turns it off, sets a monthly token budget (empty = `AI_MONTHLY_TOKEN_BUDGET`, `0` = unlimited) and watches usage under *Organization → AI*. When a month's input + output tokens reach the budget, the assistant answers `429 AI_BUDGET_EXCEEDED` until the next month (organization timezone) or a higher budget; one request may end slightly above it. Usage is in `ai_requests` (no questions, answers or result rows are stored).
- **Rate limit:** `AI_ASK_RATE_LIMIT` (20) requests per minute per user on `/ai/ask` and `/ai/explain-reorder` (limiter `ai`, cache store). Behind a proxy keep `TRUSTED_PROXIES` right as for the other limiters.
- **Cache:** insights of running periods 15 min and customer insights 1 h in the default cache store (plain arrays; any store works).
- **Not yet verified:** no call to the live Anthropic API has been made from this codebase (the adapter is tested against recorded responses); make one test question in staging with a real key before enabling AI in production. (The AI tables, their CHECKs and the daily insights job ran with the full suite on PostgreSQL 18 on 2026-11-11.)
- No queue job and no new dependency (the provider is called with Laravel's HTTP client).

## Release steps

```bash
# backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan storage:link        # once: media and product images under /storage
php artisan pos:permissions:sync  # new module permissions + role map -> built-in roles (SC1: inventory.manage; SC2: purchases.request/approve/approve_high/settings; SC3: purchases.landed_cost; Phase 7: reports.view/financial, dashboard.view; Phase 8: ai.ask/insights/manage)
php artisan optimize            # config, routes, events, views cache
php artisan queue:restart
(cd pdf-renderer && PUPPETEER_SKIP_DOWNLOAD=1 npm ci)   # PDF exports (X1); needs Node >= 22.12 and a system Chromium

# frontend
npm ci
npm run build                   # publish frontend/dist
```

## Processes

| Process | Command | Supervision |
|---------|---------|-------------|
| Queue workers | `php artisan queue:work redis --tries=3 --max-time=3600` | systemd/Supervisor, ≥2 workers |
| Scheduler | `php artisan schedule:run` every minute (cron) — prunes idempotency keys daily, refreshes storefront product stats hourly, prunes expired guest carts daily (`cart:prune`), cancels expired unpaid bank-transfer orders every minute (`orders:expire-pending`), sends the daily reorder alerts (`purchasing:reorder-notifications`, hourly, from 07:00 organization time, once per store and day) and the quotes-overdue reminders (`purchasing:rfq-reminders`, hourly, from 07:00 organization time, once per RFQ and day), and caches the daily AI insights (`ai:daily-insights`, every 30 min, from 07:30 organization time, once per organization / branch and day; Phase 8) | cron |
| Health probe | `GET /api/v1/health` (200 / 503) and `GET /up` | load balancer |

## Database

- Application connects as a non-superuser role that owns the schema; a separate read-only role for reporting replicas (optional).
- Daily base backups + WAL archiving (point-in-time recovery). Restore drills each release cycle.
- Run migrations before switching traffic; migrations must be backward compatible with the previous release (expand → migrate → contract).

## Security checklist

- `APP_DEBUG=false`; Scramble docs disabled or gated (`viewApiDocs`).
- HTTPS only, HSTS, secure + HttpOnly + SameSite=Lax cookies.
- Upload storage outside the web root; images served through signed/authorized routes.
- Rate limiters enabled; fail2ban or WAF on login endpoints.
- Behind a load balancer or reverse proxy: `TRUSTED_PROXIES` lists exactly its addresses (or `*` only when PHP cannot be reached around it), so client IPs and HTTPS are taken from trusted headers only. `SESSION_DOMAIN` unset (or a parent covering every host).
- Log shipping with `request_id` correlation; alerts on 5xx rate and queue backlog.
- AI (Phase 8): `AI_API_KEY` only in the secret store; outbound HTTPS limited to `api.anthropic.com`; a monthly token budget set (`AI_MONTHLY_TOKEN_BUDGET` or per organization); alert on `ai_requests` rows with `status = failed` (`provider_auth` = a bad or revoked key).
