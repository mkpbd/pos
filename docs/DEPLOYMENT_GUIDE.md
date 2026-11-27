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

**Deployment files (G1c):** ready-made templates are in [`deploy/`](../deploy/README.md): the Nginx site (`deploy/nginx/pos.conf` with `snippets/pos-common.conf` and `snippets/pos-admin-headers.conf`, which already carries the admin security headers from the *Security checklist*), the PHP-FPM pool and OPcache settings (`deploy/php/`), queue workers for Supervisor or systemd, the scheduler as a cron file or systemd timer, and `deploy/scripts/release.sh`. Placeholders are written `{{NAME}}`; `deploy/README.md` shows how to fill them in and install each file. This guide stays the reference for settings and upgrade notes; the files implement it.
- The Nginx site has a back-office server block (admin SPA, builder canvas, API; `client_max_body_size 32m`) and a catch-all storefront block (`default_server`, no `/admin`, `2m`). Every store domain needs DNS pointing at the server and a certificate covering it: a SAN / wildcard certificate, one server block per domain, or TLS ending at a proxy in front. For a single-domain install, list that host in the back-office block.
- Use `TRUSTED_PROXIES` (Laravel) **or** Nginx `real_ip`, never both.
- **CI:** `.github/workflows/ci.yml` runs on every push and pull request — backend (Pint + the full PHPUnit suite on a PostgreSQL 18 service, with `postgresql-client-18` so the backup tests run the real `pg_dump`), frontend (typecheck, oxlint, Vitest, build; `frontend/dist` uploaded as the artifact `frontend-dist`) and the mocked Playwright suite. The runner is Linux / UTC.

Serving the SPA and API from the **same origin** is required for Sanctum cookie authentication without third-party cookies.

**Store builder upgrade (B1–B4):** run `php artisan migrate` (B1 adds `builder_documents`, `builder_versions` and `builder_templates`) and `php artisan pos:permissions:sync`. The sync adds `storefront.publish` (builder and theme publishing; Organization Admin and Online Store Manager) and `storefront.custom_html` (custom HTML elements; Organization Admin only) to the built-in roles. Without the sync, nobody can publish on an existing database.

**Store builder upgrade (B8b):** `php artisan migrate` adds `builder_documents.active` (popups) and `builder_form_submissions`; `php artisan pos:permissions:sync` adds `forms.view` and `forms.manage` (Organization Admin; Online Store Manager gets both). Optional `POS_FORM_RATE_LIMIT` (form submissions per hour per IP, default 10). Form e-mails go through the queue, so keep the queue worker running.

**Product variants upgrade (P1a):** `php artisan migrate` (colour photos, back-in-stock requests, size guides). Demo stores seeded before P1a get their sample colour photos and size guides with `php artisan db:seed --class=DemoVariantsSeeder` (idempotent). Back-in-stock e-mails are queued: keep the queue worker running. No new permissions.

**Product page upgrade (P1b):** `php artisan migrate` (product affinities, product questions); run `php artisan pos:affinities:compute` once; demo databases seeded earlier: `php artisan db:seed --class=DemoProductPageSeeder`. The scheduler must run (`php artisan schedule:run` every minute) for the nightly *frequently bought together* scores (`pos:affinities:compute --nightly`, hourly, effective once per organization per day from 03:00), and the queue worker for question notifications and answer e-mails. Optional `POS_QUESTION_RATE_LIMIT` (default 5 questions per hour per visitor).

**Landing pages upgrade (P2a):** `php artisan migrate` (orders source/attribution, nullable redemption e-mail, domain `entry_path`, marketing tables) and `php artisan pos:permissions:sync` (adds `marketing.view` / `marketing.manage`). Demo stores seeded earlier: `php artisan db:seed --class=DemoLandingSeeder`. The daily `marketing:prune-visitor-hashes` needs the scheduler. Short links `/go/<code>` are Laravel routes — no Nginx change (all non-static paths already reach PHP). **Campaign domains:** point the domain (A/CNAME) at the server, add it under *Online store → Settings & domains* and issue its TLS certificate as for any store domain; *Opens on* then makes its `/` show the chosen campaign page.

**Social media upgrade (P2b):** `php artisan migrate` (storefront share/WhatsApp settings, the Social tables) and `php artisan pos:permissions:sync` (`social.view`, `social.manage`); demo stores seeded earlier: `php artisan db:seed --class=DemoSocialSeeder`. The scheduler runs `social:publish-due` every minute and a queue worker publishes posts. Product feeds `/feeds/<channel>/<token>.xml|csv` are Laravel routes (no Nginx change) written to the `local` disk; they are sent `Cache-Control: private, no-store` — do not add a CDN/proxy cache rule for `/feeds/*`. **Live Meta posting:** create a Meta app (Facebook Login for Business; permissions pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management — some need Meta App Review), add `<APP_URL>/api/v1/social/meta/callback` as a valid OAuth redirect URI, then enter the app id and secret in *Marketing → Social posts* and switch to Live. Instagram fetches photos itself, so product images must be reachable at a public `https://` address (JPEG). Do not log outgoing request bodies of the HTTP client (token exchanges carry the app secret in the form body).

**Store builder upgrade (B9):** `php artisan migrate` adds the nullable `builder_documents.context` (global sections). The AI writer uses the existing AI settings and budget (usage feature `builder_writer`); nothing else to configure.

**Store builder upgrade (B14):** no migration. Bootstraps cached before the deploy lack `builder.templates` until the next content change (the storefront treats a missing flag as "standard page"); run `php artisan cache:clear` to make store page designs take effect at once.

**Store builder upgrade (B13):** `php artisan migrate` (A/B test stats). No new job: `marketing:prune-page-insights` also clears the A/B tables (90 days). Audience rules and A/B versions are evaluated in shoppers' browsers, so builder pages stay cacheable — don't vary caches by cookie for them.

**Store builder upgrade (B15):** `php artisan migrate` (page insight tables, `carts.builder_attribution`). The scheduler runs `marketing:prune-page-insights` daily (90-day retention, 2-day visitor hashes). `POST /api/v1/store/insights/events` receives anonymous beacons from shoppers' browsers (60/min per IP, 64 KB): keep it reachable on every store host and out of any cache; if a CDN/WAF sits in front, allow `text/plain` and `application/json` POST bodies there. No cookies are set and nothing personal is stored, so no consent banner change is needed for it; the storefront honours Do-Not-Track and Global Privacy Control.

**Deployment and performance (G1c):** templates in [`deploy/`](../deploy/README.md) (see *Deployment files* above) and CI in `.github/workflows/ci.yml`. `php artisan migrate --force` builds 12 new indexes **concurrently** (the migrations run outside a transaction — do not wrap `migrate` in one): about a minute per 20–50 M sale lines on a busy server and ~190 MB of disk per 2 M sale lines; a build that fails leaves an INVALID index that the next `migrate` drops and rebuilds. PostgreSQL settings for this workload are in [PERFORMANCE.md](PERFORMANCE.md) §7 (`shared_buffers` ≈ 25 % of RAM, `random_page_cost` 1.1 on SSD, `work_mem` 16–32 MB, autovacuum on). `config/database.php` no longer ships a default database password — set `DB_PASSWORD` in `.env`.

**Reports, alerts and due reminders (R1):** `php artisan migrate` (`alert_runs`, SMS purpose `due_reminder`). The scheduler must run (`schedule:run` every minute) for the hourly alert commands, and a queue worker for the summary e-mails and SMS. Due reminders are off until an owner turns them on (Organization → Alerts & reminders) and need SMS set up; the daily summary, expiry and open-register alerts are on by default (in-app).

**Serial register and past-date valuation (ST2d):** `php artisan migrate` (`stock_movements.average_cost_after` — filled for existing rows by replaying each stock level's history, which briefly disables the movements' append-only trigger and so needs the table owner's rights; it logs how many levels end on an average different from the stored one, which should be 0 — and `serial_numbers`, `serial_number_events`, `serials` on goods receipt / purchase return lines). Serial-tracked products now need serials on receipts, manual adjustments, transfers and purchase returns; stock from before the register still sells. Web orders do not record serials yet, so a serial-tracked product sold online stays "in stock" in the register.

**Pack barcodes, wholesale price, quantity breaks, branch prices (ST2c):** `php artisan migrate` (`product_barcodes.units` / `pack_name`, `product_price_tiers`, `product_branch_prices`, `customer_groups.price_level`, sale line price sources `wholesale` / `tier`). Existing barcodes stay single units. Till prices change only for products given branch prices, quantity breaks, or a wholesale price sold to a wholesale group; the online store is unchanged.

**Transfer receiving, requests and documents (ST2b):** `php artisan migrate` (transfer statuses `requested` / `rejected`, received / damaged / requested quantities, loss total; purchase order `emailed_at` / `emailed_to`). Purchase order e-mails need mail configured and a queue worker; the PDFs need Chrome (as the RFQ and list PDFs). API change: transfer `dispatched_by` / `completed_by` are now `{id, name}` objects.

**Purchase discounts, free quantity, short-close, returns without a receipt (ST2a):** `php artisan migrate` (discount / bonus columns on order and receipt lines, `goods_receipt_lines.effective_unit_cost` backfilled from `unit_cost`, order status `closed`, nullable receipt references on purchase returns). Rolling back fails while closed orders exist. Existing receipts keep their stock cost (no discount or bonus = the unit cost).

**Receipt printers, drawer and digital receipts (POS1d):** `php artisan migrate` (`pos_drawer_openings`, approval action `no_sale`, `sale_receipt_links`, `sale_receipt_deliveries`, SMS purpose `sale_receipt`) and `php artisan pos:permissions:sync` (adds `pos.no_sale`). Silent printing needs Chrome or Edge over **https** (or localhost) — Web Serial / WebUSB are not available on plain http or in Firefox / Safari, which keep browser printing. On Windows a USB receipt printer bound to the vendor's printer driver may not be reachable by WebUSB; use its virtual COM port (serial) or the browser print fallback. Receipt links use the store's primary domain; without an open store the SMS carries no link and the e-mail carries the full receipt. Mail must be configured for e-mail receipts and SMS (Settings → SMS) for SMS receipts. Raster (Bangla) receipts use the till computer's Bangla font — check one print on each printer model.

**Exchanges (POS1c):** `php artisan migrate` (`sale_returns.exchange_sale_id`, payment / refund method `exchange`, approval action `return`). No new permissions: an exchange needs `pos.sell` + `returns.create`, and `returns.approve` or a manager's PIN approval. Only invoices of the till's own branch can be exchanged; a sale made by an exchange cannot be cancelled (return its items instead).

**Store credit and gift cards (POS1b):** `php artisan migrate` (`store_credit_entries`, `gift_cards`, `gift_card_entries`, payment / refund methods `store_credit` and `gift_card`) and `php artisan pos:permissions:sync` (adds `store_credit.view`, `store_credit.manage`, `gift_cards.view`, `gift_cards.manage`). Gift card codes are stored hashed: a lost code cannot be shown again (void the card and issue a voucher). Cancelling a sale paid with a card that was voided or expired meanwhile puts the value back on that card, which cannot be spent — issue a voucher instead. Advances, payouts and gift card sales are money through the till (payments list); they are not counted by the payment-collections report. Idempotency replay bodies stored before this release stay readable.

**Till PIN and tills (POS1a):** `php artisan migrate` (user PIN columns, `pos_terminals`, `pos_approvals`, sign-in channel `pin`, promotion channels and sale redemptions, sale price/approval/promotion columns and `sale_promotions`, product `open_price`) and `php artisan pos:permissions:sync` (adds `pos.terminals.manage` and `sales.price_override`; the Cashier role keeps only `pos.sell` of the POS permissions). Each counter computer is set up once as a till (*Settings → Tills*); cashiers then sign in there with their PIN. Accounts with two-factor sign-in use the password sign-in at the till but can still approve with their PIN. Existing promotions stay online only until *Till* is ticked. The online shop still sells an open-price product at its catalog price; keep open-price items out of the online catalog.

**Send Money, advance delivery charge and ad tracking (BD1c):** `php artisan migrate` (`order_payment_claims`, `orders.advance_amount`, `orders.tracking_ids`, storefront `cod_advance*` settings, `tracking_settings`). No new permissions. The Conversions API job goes through the queue (a worker must run) and calls `https://graph.facebook.com` — allow outbound HTTPS to it. The cookies `_fbp`, `_fbc` and `_ttp` are no longer encrypted by the app (they belong to the ad pixels and must be readable). Pasted tracking code is added by the backend's shop page (production); in development the Vite dev server serves the page, so the code does not show there. Send Money methods need the shop's receiving number before they can be switched on; the advance delivery charge stays off until one is on.

**Staff orders and cash-on-delivery checks (BD1b):** `php artisan migrate` (order source `staff`, channel, created by, revision, `order_edits`, a new trigger function that lets an order edit replace its lines, `blocked_phones`, the storefront `cod_review*` settings, an `(organization_id, contact_phone)` index) and `php artisan pos:permissions:sync` (adds `web_orders.create` and `web_orders.edit`; the Online Store Manager gets them through `web_orders.*`). Staff who enter orders also need `products.view` and `customers.view` to search products and customers. The cash-on-delivery review is off until a store turns it on (*Online store settings → Cash on delivery check*). An edit posts stock to the order's own store; if the store's fulfilment store has changed since, changing the lines of an older order may be refused for stock.

**SMS and phone sign-in (BD1a):** `php artisan migrate` (SMS tables, phone sign-in columns, checkout contact settings, promotion redemptions by phone) and `php artisan pos:permissions:sync` (adds `sms.view` / `sms.manage`). Each store sets up SMS on *Settings → SMS*: test mode writes messages to `storage/logs/sms-*.log` (it cannot send sign-in or checkout codes in production), the HTTP driver calls the store's SMS provider. Messages go through the queue, so a worker must run; the job is encrypted because it carries one-time codes. Env (optional): `SMS_TIMEOUT` 10, `SMS_CONNECT_TIMEOUT` 5, `SMS_OTP_*` limits, `POS_RETAIN_SMS_DAYS` 180, `LOG_SMS_DAYS` 14; leave `SMS_ALLOW_INSECURE_HTTP` and `SMS_ALLOW_PRIVATE_HOSTS` off in production. Outbound HTTPS from the app servers to the SMS provider must be allowed. **Checkout e-mail is now optional by default** (`checkout_email = optional`); a store that needs it sets *Customer e-mail at checkout* to Required.

**Stock operations (ST1):** `php artisan migrate` (imports, stocktakes, supplier refunds and payment voids) and `php artisan pos:permissions:sync` (adds `inventory.stocktake`). Imports run on the queue (a worker must be running) and accept files up to 10 MB: PHP `upload_max_filesize` / `post_max_size` must allow that (the G1c FPM pool does). Uploaded files are kept on the private `local` disk for `POS_RETAIN_IMPORT_FILES_DAYS` (30). **Cash supplier payments now come out of the recorder's open cash drawer** (like expenses): whoever pays suppliers in cash needs an open register session, or records the payment as a bank transfer / cheque.

**Operations (G1b):** `php artisan migrate` (`system_backups`, `error_events`). The scheduler now also runs `pos:heartbeat` every minute and `pos:prune-records` daily; turn on nightly backups with `POS_BACKUP_ENABLED=true` (see *Backups and restore* below) and set `POS_OPS_ALERT_EMAILS`. Platform admins see backups, failed jobs, the error log and warnings under *System status*. The error log writes through a second connection to the same database (one extra connection per PHP worker while it records an error).

**Sign-in security (G1a):** `php artisan migrate` (two-factor and lockout columns on `users`). New settings: `POS_LOCKOUT_MAX_ATTEMPTS` (10), `POS_LOCKOUT_MINUTES` (15), `POS_HSTS` (true — set false only if a subdomain must stay on plain HTTP, because the header covers subdomains). The lock and two-factor e-mails are queued: a mailer and a queue worker are needed. **`APP_KEY` now also protects two-factor secrets and recovery codes — rotating it turns off everyone's two-factor sign-in** (each user sets it up again; with a required policy they are sent to setup at the next sign-in). Laravel now sends the security headers itself; add the admin block under *Security checklist* to Nginx.

**Quick fixes (Q1):** `php artisan migrate` (stock count quantities on adjustment lines; `promotion_redemptions.released_at` with an updated append-only trigger). **Public sign-up is now off by default** — set `POS_REGISTRATION_ENABLED=true` only on an install where anyone may create an organization (and put a CAPTCHA / rate limit in front of it). The legacy `PUT /api/v1/storefront/theme` is removed (405); anything that called it must save the theme draft and publish. `php artisan pos:permissions:sync` is harmless (only an unused role pattern was removed).

**Store builder upgrade (B16):** `php artisan migrate` (`builder_comments`, `builder_edit_sessions`, `storefront_redirects`). Who is on a page and the one-editor-at-a-time lease are kept in the cache: production needs a cache store shared by every app server that supports atomic locks — Redis (recommended) or `database`; `file` only works on a single server, and `array` loses everything between requests. Redirects are answered by the Laravel storefront shell (no Nginx rule needed); `GET /api/v1/store/redirects/resolve` is public and cacheable for 60 s. Imports accept files up to 30 MB: keep PHP `upload_max_filesize` / `post_max_size` and Nginx `client_max_body_size` at least that large for the admin host.

**Store builder upgrade (B17):** `php artisan migrate` (`storefront_festival_setups`). Festival pages, banners and bars show and hide by their dates through node schedules and popup dates — no extra job. The bundled Eid / Ramadan / Puja dates cover 2026–2028 (expected; the owner can change them per setup); extend `FestivalCalendar` for later years.

**Store builder upgrade (B11):** `php artisan migrate` (builder schedules, reviews, saved copies; media focal point and edit source). **The scheduler must run** (`* * * * * php artisan schedule:run`): `storefront:publish-scheduled` publishes pages and themes set to *Publish later* every minute — without it scheduled pages never go live. Picture edits run in the request (GD, up to 6000 × 6000 px; PHP `memory_limit` ≥ 512M recommended); uploads over 2560 px are scaled down on upload. Optional once: `php artisan media:optimize --dry-run`, then without `--dry-run`, to shrink older oversized pictures. Demo databases: `php artisan db:seed --class=DemoThemesSeeder` adds the five new demo stores (existing ones are skipped); for local hosts add `fashion|electronics|grocery|beauty|furniture.shop.localhost`.

**Store builder upgrade (B10):** `php artisan migrate` adds `storefront_fonts` (stores' own fonts); existing themes need no change. Uploaded fonts are WOFF2 files on the media disk at `fonts/<org>/<id>.woff2` and never change once written:
- Local `public` disk: have Nginx send a long cache for them, e.g. `location ^~ /storage/fonts/ { add_header Cache-Control "public, max-age=31536000, immutable"; types { font/woff2 woff2; } }`.
- S3 / CDN bucket: the files are uploaded with `Cache-Control: public, max-age=31536000, immutable`; allow CORS `GET` from the store domains, because browsers load `@font-face` files across origins only with CORS.
- Built-in fonts (including the five Bangla fonts) ship in the frontend build as separate files and load only when a theme uses them.

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

Online store AI for staff (AI2a, optional — same switch, key and budget as AI1):
- **Migration** (additive): `ai_content_batches`, `ai_content_drafts` (OnlineCatalog). No permission sync needed: it uses `online_catalog.manage` (and `products.manage` to apply category suggestions).
- **A queue worker must run** for *AI drafts* (`WriteAiDrafts`, one model call per item, in sequence). Without a worker a batch stays *queued*; a batch with no progress for 60 minutes is cancelled the next time someone starts one. Give the worker a timeout above `AI_TIMEOUT × (AI_MAX_RETRIES + 1)` per item.
- **The scheduler** also runs `online-catalog:prune-ai-drafts` daily (drafts older than 30 days).
- *Write with AI*, category suggestions and *Describe with AI* call the model in the request (structured JSON answers), so the egress and timeout notes above apply; two-language writes are the longest — raise `AI_TIMEOUT` if they time out with a real key.

Shop assistant on the online store (AI2b, optional — same switch, key and budget):
- **Migration** (additive): assistant columns on `storefront_settings`, `assistant_conversations`, `assistant_messages`. Off for every store until the owner switches it on in *Online store → Assistant*.
- **Public endpoint:** `POST /api/v1/store/assistant/messages` on every store host calls the model in the request (up to 4 calls per shopper message). Keep it reachable and **never cached** (it sends `Cache-Control: no-store, private`; exclude `/api/v1/store/assistant/*` from any CDN cache rule). Per-IP limits `AI_STORE_ASSISTANT_PER_MINUTE` (10) and `AI_STORE_ASSISTANT_PER_HOUR` (60) use the cache store — keep `TRUSTED_PROXIES` right behind a proxy, or every shopper shares one limit. Size PHP-FPM and the proxy read timeout like `/api/v1/ai/*`.
- **Costs:** each store's daily new-conversation limit (default 200) and the organization's monthly token budget cap spending; when either is reached shoppers get a polite message with the WhatsApp / contact hand-off.
- **The scheduler** runs `storefront:prune-assistant` daily (conversations deleted 30 days after their last message). No IP address or user agent is stored.
- **Before announcing it:** try it on the live store with a real key and read the first conversations in *Online store → Assistant*.

## Release steps

**Scripted (G1c):** `POS_FPM_SERVICE=php8.4-fpm deploy/scripts/release.sh --ref <tag> --health-url https://pos.example.com/api/v1/health` builds each release in `/srv/pos/releases/<stamp>-<sha>` (shared `.env` and `storage`), runs the steps below, switches the `current` symlink atomically, reloads PHP-FPM and restarts the workers. `--frontend-dist <dir>` uses the CI artifact `frontend-dist` instead of building on the server; `--maintenance` puts the site in maintenance mode while migrating; `--rollback` goes back one release (migrations are not undone). In this layout `storage:link` runs for every release (the link lives inside the release). Recent `/assets` files (under 7 days old) are carried into the new build so open tabs keep working. Re-running for the commit that is already live does nothing unless `--force`.

**By hand** (what the script runs):

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
| Heartbeat (G1b) | `pos:heartbeat` every minute from the scheduler; it queues a small job, so *System status* shows when the scheduler and the worker last ran | (scheduler) |
| Backups (G1b) | `pos:backup` at `POS_BACKUP_TIME` and `pos:backup:verify` 90 minutes later, only when `POS_BACKUP_ENABLED=true` | (scheduler) |
| Retention (G1b) | `pos:prune-records` daily (`--dry-run` to preview) | (scheduler) |

- Pick one set (G1c files): Supervisor workers (`deploy/supervisor/pos-worker.conf`) with cron (`deploy/cron/pos`), or the systemd workers `pos-worker@1` / `@2` with `pos-scheduler.timer`. Never run cron and the timer together. The nightly backup and its check run in the background of `schedule:run`, so neither holds up the every-minute tasks.
- **Set the queue's retry time above the longest job:** `DB_QUEUE_RETRY_AFTER` (database queue) or `REDIS_QUEUE_RETRY_AFTER` (Redis), e.g. `4000`. A backup runs up to `POS_BACKUP_TIMEOUT` + 300 s and an AI drafts batch up to 3600 s; with Laravel's default 90 s the queue hands a still-running job to a second worker, which fails it. The worker stop timeout in the templates (3960 s) lets a running job finish.
- **PHP-FPM** (`deploy/php/pos-fpm.conf`): `memory_limit` 512M, `upload_max_filesize` 32M / `post_max_size` 34M, `request_terminate_timeout` 300 s (below Nginx `fastcgi_read_timeout` 310 s; a load balancer in front needs an idle timeout above 310 s for `/api/v1/ai/*`). The pool keeps `clear_env = yes`, so put `POS_PG_BIN` and the PDF renderer paths in `.env`.
- **OPcache** (`deploy/php/opcache.ini`) runs with `validate_timestamps=0`: reload PHP-FPM after every release (the release script does it when `POS_FPM_SERVICE` is set and the deploy user may `sudo -n systemctl reload` it) and after editing `.env` + `php artisan optimize`.

## Database

- Application connects as a non-superuser role that owns the schema; a separate read-only role for reporting replicas (optional).
- Run migrations before switching traffic; migrations must be backward compatible with the previous release (expand → migrate → contract).
- For a large or busy database, also keep WAL archiving / managed point-in-time recovery from your PostgreSQL host — the nightly dump below is a whole-database copy once a day, not a replacement for point-in-time recovery.

## Backups and restore (G1b)

**Settings** (`backend/.env`):

| Setting | Default | Meaning |
|---|---|---|
| `POS_BACKUP_ENABLED` | `false` | Nightly `pg_dump` at `POS_BACKUP_TIME` and a check 90 minutes later. "Back up now" works even when off. |
| `POS_BACKUP_TIME` | `02:00` | Application timezone. |
| `POS_BACKUP_PATH` | `storage/app/backups` | Folder for `pos-<db>-<date>.dump` + `.sha256` (created 0700, files 0600). Put it on a disk other than the database's, with room for `keep_days` copies. |
| `POS_BACKUP_KEEP_DAYS` / `POS_BACKUP_KEEP_MIN` | `14` / `3` | Older files are removed, but the newest N good ones are always kept. |
| `POS_PG_BIN` | empty | Folder with `pg_dump` / `pg_restore` (same major version as the server, e.g. `/usr/lib/postgresql/18/bin`); empty = on `PATH`. |
| `POS_BACKUP_TIMEOUT` | `3600` | Seconds for one dump or restore. A run still "running" after timeout + 15 min is marked interrupted. |
| `POS_BACKUP_AFTER_COMMAND` | empty | Off-site copy run after each good backup; `{file}` is replaced by the quoted path. Examples: `rclone copy {file} offsite:pos-backups` (also copy `{file}.sha256`), `aws s3 cp {file} s3://my-pos-backups/`. Runs without the database password in its environment. A failure is shown and e-mailed. |
| `POS_BACKUP_VERIFY_DATABASE` | empty | A **separate, empty scratch database** for the full restore check (e.g. `pos_restore_check`, owned by the app role: `CREATE DATABASE pos_restore_check OWNER pos_app;`). Never the live database (refused). Empty = the check only confirms the checksum and that `pg_restore --list` can read the file. |
| `POS_OPS_ALERT_EMAILS` | empty | Comma-separated addresses for backup / check / off-site failures and new server errors. Needs a working mailer and queue worker. |

The password is passed to `pg_dump` / `pg_restore` through `PGPASSWORD` in the process environment, never on the command line. Backups normally run in the scheduler or a queue worker (CLI). With `QUEUE_CONNECTION=sync`, *Back up now* runs inside the web request instead: PHP-FPM clears the environment (`clear_env`), so set `POS_PG_BIN` explicitly, and the request may hit the web timeout on a big database — use a real queue in production. Backup files are not downloadable from the app: copy them off the server with the hook or your host's tooling, and keep at least one copy outside the server and outside the cloud account that runs it.

**Check it works** after deploying: *System status* (platform admin) → **Back up now**, then **Verify**; or `php artisan pos:backup` and `php artisan pos:backup:verify`. The status page warns when the newest good backup is older than 26 hours, when a check failed, or when none was checked for 8 days.

**Restoring (runbook):**
1. Put the site in maintenance (`php artisan down`) and stop the queue workers and the scheduler.
2. Pick the file (newest `succeeded` + `passed` row on *System status*, or the newest `.dump` in `POS_BACKUP_PATH`) and check it: `sha256sum -c pos-<db>-<date>.dump.sha256`.
3. Restore into a **new** database first: `createdb -O pos_app pos_restored` then `pg_restore --no-owner --no-privileges --dbname=pos_restored pos-<db>-<date>.dump`.
4. Point `DB_DATABASE` at `pos_restored` (or rename databases while nothing is connected), `php artisan optimize`, then `php artisan migrate --force` (applies anything newer than the backup).
5. Start workers and the scheduler, `php artisan up`, sign in and check today's sales, stock and the last orders. Anything entered after the backup time must be re-entered (or recovered from point-in-time recovery if you keep it).
6. Practise this on a copy at least once per release cycle; the nightly check with `POS_BACKUP_VERIFY_DATABASE` does steps 2–3 automatically.

## Error log and data retention (G1b)

- Unexpected server errors are grouped in the built-in error log (*System status → Errors*, platform admins) and e-mailed to `POS_OPS_ALERT_EMAILS` when new or back after being resolved. `POS_ERROR_LOG_ENABLED=false` turns recording off (the normal Laravel log is always written).
- `pos:prune-records` (daily) deletes, in chunks: sign-in history older than `POS_RETAIN_LOGIN_ACTIVITY_DAYS` (365), **read** notifications older than `POS_RETAIN_READ_NOTIFICATIONS_DAYS` (180), failed jobs older than `POS_RETAIN_FAILED_JOBS_DAYS` (30), AI request logs older than `POS_RETAIN_AI_REQUESTS_DAYS` (365), resolved / ignored errors not seen for `POS_RETAIN_ERROR_EVENTS_DAYS` (90) and backup records without a file older than `POS_RETAIN_BACKUP_RECORDS_DAYS` (90). Empty or `0` keeps forever.
- The audit log is **kept forever** unless `POS_RETAIN_AUDIT_DAYS` is set — check your legal / tax retention period first (sales, payments and stock movements stay in their own tables regardless).

## Security checklist

- `APP_DEBUG=false`; Scramble docs disabled or gated (`viewApiDocs`).
- HTTPS only, HSTS, secure + HttpOnly + SameSite=Lax cookies. Laravel sends HSTS on HTTPS responses (`POS_HSTS`), plus nosniff, referrer and permissions policy, and framing rules (API: `DENY`; storefront HTML: framed only by the back office).
- **Admin app headers (G1a)** — the back office (`frontend/dist`) is served by Nginx, so add these to the `location = /admin/builder-canvas` and `location /admin/` blocks (an `add_header` inside a location replaces the server-level ones, so repeat any you rely on):

  ```nginx
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-aATtmmR3yaaFhUvWJ3fsT2ob01Z1erl5iZgfzz5pVoY='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
  ```

  Why: the `sha256-…` allows the one inline script in `index.html` (applies the light/dark theme before the first paint; `frontend/src/app/admin-csp.test.ts` keeps this hash, and the copy in `deploy/nginx/snippets/pos-admin-headers.conf`, in step with the file — change them together). Inline `<style>` is needed (dialogs, print pages, the builder canvas, uploaded fonts). `font-src data:` for small inlined fonts; `img-src https:` for pictures from the media disk or CDN and external images in rich text. `frame-src`: the builder canvas plus YouTube / Vimeo / Google Maps embeds. If `MEDIA_DISK` is an S3/CDN bucket, add its origin to `font-src` (uploaded store fonts). Try it first as `Content-Security-Policy-Report-Only` and open the dashboard, POS, the page builder and a report.
- **Two-factor sign-in (G1a):** ask owners to set *Organization → Security → Two-factor sign-in* to *Required for admins* (or everyone); keep a second admin who can reset a colleague's two-factor if a phone is lost.
- Upload storage outside the web root; images served through signed/authorized routes.
- Rate limiters enabled; account lockout (G1a, `POS_LOCKOUT_*`); fail2ban or WAF on login endpoints (`/api/v1/auth/login`, `/auth/two-factor-challenge`, `/auth/tokens`).
- Behind a load balancer or reverse proxy: `TRUSTED_PROXIES` lists exactly its addresses (or `*` only when PHP cannot be reached around it), so client IPs and HTTPS are taken from trusted headers only. `SESSION_DOMAIN` unset (or a parent covering every host).
- Log shipping with `request_id` correlation; alerts on 5xx rate and queue backlog. Built in (G1b): `POS_OPS_ALERT_EMAILS` for new server errors and backup failures, and *System status* warnings for a stopped scheduler or worker, failed jobs, low disk and debug mode.
- AI (Phase 8): `AI_API_KEY` only in the secret store; outbound HTTPS limited to `api.anthropic.com`; a monthly token budget set (`AI_MONTHLY_TOKEN_BUDGET` or per organization); alert on `ai_requests` rows with `status = failed` (`provider_auth` = a bad or revoked key).
