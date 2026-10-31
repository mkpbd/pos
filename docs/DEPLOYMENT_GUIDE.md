# Deployment Guide

> Status: baseline written in Phase 1; completed and validated in Phase 10.

## Target topology

```
            ┌──────────── HTTPS (TLS terminates here) ────────────┐
Browser ──▶ │ Nginx                                                │
            │  /assets/*   → frontend/dist/assets (static)         │
            │  /admin/*    → frontend/dist/index.html (admin SPA)  │
            │  /api, /sanctum, /docs, /storage, all other paths    │
            │              → PHP-FPM (backend/public); storefront  │
            │                pages = Laravel shell around          │
            │                frontend/dist/storefront.html         │
            └──────────────────────────────────────────────────────┘
                     │                  │                  │
               PHP-FPM 8.4       queue workers (N)     scheduler (1)
                     └──────────┬───────┴──────────────────┘
                         PostgreSQL 18      Redis
```

Serving the SPA and API from the **same origin** is required for Sanctum cookie authentication without third-party cookies.

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

Secrets (`APP_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`, AI provider keys) come from the host's secret store or environment, never from the repository.

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
- The PostgreSQL-only `CheckoutConcurrencyTest` (two checkouts racing for the last unit) has not run yet — run the full suite on PostgreSQL before production.

## Release steps

```bash
# backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan storage:link        # once: media and product images under /storage
php artisan pos:permissions:sync  # new module permissions -> built-in roles
php artisan optimize            # config, routes, events, views cache
php artisan queue:restart

# frontend
npm ci
npm run build                   # publish frontend/dist
```

## Processes

| Process | Command | Supervision |
|---------|---------|-------------|
| Queue workers | `php artisan queue:work redis --tries=3 --max-time=3600` | systemd/Supervisor, ≥2 workers |
| Scheduler | `php artisan schedule:run` every minute (cron) — prunes idempotency keys daily, refreshes storefront product stats hourly, prunes expired guest carts daily (`cart:prune`), cancels expired unpaid bank-transfer orders every minute (`orders:expire-pending`) | cron |
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
