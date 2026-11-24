# Deployment files

Templates for a single Linux server (Ubuntu/Debian paths). [docs/DEPLOYMENT_GUIDE.md](../docs/DEPLOYMENT_GUIDE.md) remains the main guide: topology, `backend/.env`, upgrade notes, backups, the security checklist. Nothing here is secret; secrets live only in `shared/.env` on the server.

| File | Installs to | Purpose |
|---|---|---|
| `nginx/pos.conf` | `/etc/nginx/sites-available/pos.conf` (+ link in `sites-enabled`) | HTTP→HTTPS + ACME; back office host (admin SPA, builder canvas, API); catch-all storefront hosts |
| `nginx/snippets/pos-common.conf` | `/etc/nginx/snippets/` | Shared locations: `/assets` (1-year cache), `/storage` (+ fonts), robots/sitemaps, `/api` `/sanctum` `/docs` `/up` and everything else → `backend/public/index.php`; gzip; dotfiles denied; real-IP notes |
| `nginx/snippets/pos-admin-headers.conf` | `/etc/nginx/snippets/` | G1a security headers (CSP, framing, …) for the static admin pages |
| `php/pos-fpm.conf` | `/etc/php/8.4/fpm/pool.d/pos.conf` | PHP-FPM pool: user, socket, `memory_limit` 512M, 32M uploads, 300 s request timeout, `clear_env` note |
| `php/opcache.ini` | `/etc/php/8.4/fpm/conf.d/99-pos-opcache.ini` | OPcache sized for the app, no timestamp checks (reload FPM per release) |
| `supervisor/pos-worker.conf` | `/etc/supervisor/conf.d/` | 2 queue workers (`queue:work redis --tries=3 --max-time=3600`) — **or** the systemd units |
| `systemd/pos-worker@.service` | `/etc/systemd/system/` | One queue worker per instance (`pos-worker@1`, `pos-worker@2`) |
| `systemd/pos-scheduler.service` + `.timer` | `/etc/systemd/system/` | `schedule:run` every minute — **or** the cron file |
| `cron/pos` | `/etc/cron.d/pos` | `schedule:run` every minute |
| `scripts/release.sh` | run from a checkout or copy to the server | Builds a release beside the live one, migrates, switches atomically, restarts workers; `--rollback` |

Pick one consistent set: **Supervisor workers + cron** (simplest), or **systemd workers + systemd timer**. Never two schedulers (tasks would run twice) or two worker managers. With nightly backups on (`POS_BACKUP_ENABLED=true`) prefer cron: the timer does not start a new `schedule:run` while the 02:00 backup is still running inside the previous one, so the every-minute tasks wait for it.

## Placeholders

| Placeholder | Example |
|---|---|
| `{{APP_ROOT}}` | `/srv/pos` (= `POS_ROOT` of `release.sh`) |
| `{{APP_USER}}` / `{{APP_GROUP}}` | `pos` / `pos` — owns `{{APP_ROOT}}`, runs PHP-FPM, workers, scheduler and releases |
| `{{NGINX_USER}}` | `www-data` |
| `{{PHP_BIN}}` | `/usr/bin/php8.4` |
| `{{PHP_FPM_SOCKET}}` | `/run/php/pos-fpm.sock` |
| `{{ADMIN_HOST}}` | `pos.example.com` |
| `{{ADMIN_CERT}}` / `{{ADMIN_CERT_KEY}}` | `/etc/letsencrypt/live/pos.example.com/fullchain.pem` / `…/privkey.pem` |
| `{{STORE_CERT}}` / `{{STORE_CERT_KEY}}` | a certificate covering every store domain (SAN/wildcard), or see the note in `pos.conf` |
| `{{ACME_ROOT}}` | `/var/www/letsencrypt` |

Render a copy with your values (run from the repository root, into a scratch folder):

```bash
mkdir -p /tmp/pos-deploy && cp -r deploy/. /tmp/pos-deploy/ && cd /tmp/pos-deploy && rm README.md .gitattributes
grep -rl '{{' . | xargs sed -i \
  -e 's#{{APP_ROOT}}#/srv/pos#g' -e 's#{{APP_USER}}#pos#g' -e 's#{{APP_GROUP}}#pos#g' \
  -e 's#{{NGINX_USER}}#www-data#g' -e 's#{{PHP_BIN}}#/usr/bin/php8.4#g' \
  -e 's#{{PHP_FPM_SOCKET}}#/run/php/pos-fpm.sock#g' -e 's#{{ADMIN_HOST}}#pos.example.com#g' \
  -e 's#{{ADMIN_CERT}}#/etc/letsencrypt/live/pos.example.com/fullchain.pem#g' \
  -e 's#{{ADMIN_CERT_KEY}}#/etc/letsencrypt/live/pos.example.com/privkey.pem#g' \
  -e 's#{{STORE_CERT}}#/etc/ssl/pos/stores-fullchain.pem#g' -e 's#{{STORE_CERT_KEY}}#/etc/ssl/pos/stores-privkey.pem#g' \
  -e 's#{{ACME_ROOT}}#/var/www/letsencrypt#g'
grep -rn '{{' . || echo "all placeholders filled"
```

## First-time setup

1. Packages: Nginx, PHP 8.4 (`php8.4-fpm php8.4-cli php8.4-pgsql php8.4-gd php8.4-intl php8.4-zip php8.4-bcmath php8.4-mbstring php8.4-xml php8.4-curl`), Composer 2, Node.js ≥ 22.12, Chromium (PDF exports), PostgreSQL 18 client (`pg_dump` for backups), Redis, Supervisor (if chosen).
2. User and folders: `adduser --system --group --home /srv/pos pos`; as `pos`: `git clone --mirror <repository url> /srv/pos/repo.git` (a deploy key with read access), `mkdir -p /srv/pos/shared`, create `/srv/pos/shared/.env` from `backend/.env.example` and the guide (`APP_KEY`: `php artisan key:generate --show` in any checkout), `chmod 600 /srv/pos/shared/.env`.
3. Database role and database as in the guide (*Database*); `REDIS_QUEUE_RETRY_AFTER=4000` in `.env` (see below).
4. First release: `POS_FPM_SERVICE=php8.4-fpm deploy/scripts/release.sh --ref main` (as `pos`). Give `pos` a sudoers rule for exactly `systemctl reload php8.4-fpm`, or reload it yourself after each release.
5. Install the PHP, Nginx, worker and scheduler files above; check each: `php-fpm8.4 -t`, `nginx -t`, `systemd-analyze verify pos-worker@1.service pos-scheduler.service pos-scheduler.timer`, `supervisorctl reread`.
6. Check: `curl -fsS https://pos.example.com/api/v1/health`, sign in at `/admin/`, *System status* shows the scheduler and worker heartbeats within two minutes.

## Releases

```bash
POS_FPM_SERVICE=php8.4-fpm deploy/scripts/release.sh --ref v1.4.0 --health-url https://pos.example.com/api/v1/health
# with the frontend built by CI instead of on the server:
gh run download <run-id> -n frontend-dist -D /tmp/frontend-dist
deploy/scripts/release.sh --ref <the same commit> --frontend-dist /tmp/frontend-dist
deploy/scripts/release.sh --rollback      # previous release; migrations are not undone
```

Steps (printed as they run): fetch the ref → new `releases/<stamp>-<sha>/` from `git archive` → link `shared/.env` and `shared/storage` → `composer install --no-dev --optimize-autoloader` → `backend/pdf-renderer` `npm ci` → frontend `npm ci && npm run build` (or the CI artifact) → copy the live build's recent `/assets` files (so open tabs can still load old lazy chunks) → optional `php artisan down` (`--maintenance`) → `migrate --force` → `storage:link` → `pos:permissions:sync` → `optimize` → atomic `current` switch → PHP-FPM reload → `queue:restart` → `up` → health check → keep the last 5 releases. Re-running for the live commit does nothing (`--force` rebuilds). If a step fails before the switch, the live release is untouched; after a failed migration with `--maintenance` the site stays down on purpose until you check it.

After changing `shared/.env`: `cd /srv/pos/current/backend && php artisan optimize && sudo systemctl reload php8.4-fpm && php artisan queue:restart` (OPcache does not re-read the cached config file on its own).

## Notes

- **Long queue jobs:** the backup job can run `POS_BACKUP_TIMEOUT` + 300 s (3900 s by default) and an AI drafts batch up to 3600 s on the single default queue. Set `REDIS_QUEUE_RETRY_AFTER` above the longest (e.g. `4000`), otherwise Redis hands a still-running job to a second worker after 90 s. The worker stop timeouts (3960 s) let a running job finish.
- **Upload sizes:** admin host `client_max_body_size 32m` = PHP `upload_max_filesize 32M` / `post_max_size 34M` (builder imports up to 30 MB, media 5 MB). Storefront hosts 2m.
- **Timeouts:** PHP-FPM `request_terminate_timeout` 300 s < Nginx `fastcgi_read_timeout` 310 s; both above `PDF_TIMEOUT` (60 s). A load balancer in front needs an idle timeout above 310 s for `/api/v1/ai/*`.
- **Real IP:** keep `TRUSTED_PROXIES` (Laravel) *or* Nginx `real_ip`, not both — see `snippets/pos-common.conf`.
- **CI:** `.github/workflows/ci.yml` runs Pint + PHPUnit on PostgreSQL 18, frontend typecheck/lint/Vitest/build (artifact `frontend-dist`) and the mocked Playwright suite.
