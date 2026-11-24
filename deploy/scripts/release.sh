#!/usr/bin/env bash
# Enterprise POS — release on a single server (docs/DEPLOYMENT_GUIDE.md "Release steps", deploy/README.md).
#
# Each release is built in its own directory while the current one keeps serving, then goes live with an
# atomic symlink switch. Safe to re-run: every step is idempotent, and re-releasing the live commit is a no-op
# unless --force is given.
#
# Layout under POS_ROOT (default /srv/pos):
#   repo.git/              bare mirror of the repository, created once: git clone --mirror <url> repo.git
#   releases/<stamp>-<sha>/ one directory per release (backend/, frontend/), with a REVISION file
#   shared/.env            backend/.env of every release (fill it from your secret store; never commit it)
#   shared/storage/        backend/storage of every release (media, logs, framework cache, default backups)
#   current -> releases/…  used by Nginx, PHP-FPM, the queue workers and the scheduler
#
# Usage:
#   release.sh [--ref <branch|tag|commit>] [--frontend-dist <dir|.zip|.tar.gz>] [--maintenance]
#              [--skip-pdf-renderer] [--keep <n>] [--health-url <url>] [--force]
#   release.sh --rollback        switch back to the previous release (database migrations are NOT undone)
#
#   --ref               what to release (default: main)
#   --frontend-dist     use a prebuilt frontend/dist (e.g. the CI artifact "frontend-dist", downloaded with
#                       `gh run download <run-id> -n frontend-dist -D /tmp/dist`) instead of building it here
#   --maintenance       `php artisan down` around migrate + switch (default: stay up; migrations must be
#                       backward compatible with the running release — expand, migrate, contract)
#   --skip-pdf-renderer do not install backend/pdf-renderer (PDF exports then answer 503 PDF_UNAVAILABLE)
#   --keep              releases to keep on disk (default 5; the live one is never removed)
#   --health-url        fetched after the switch (e.g. https://pos.example.com/api/v1/health); failure fails
#                       the script but does not roll back — run --rollback if needed
#   --force             release even when the commit is already live
#
# Environment:
#   POS_ROOT             default /srv/pos
#   POS_PHP              PHP 8.4 binary (default: php)
#   POS_COMPOSER         Composer command (default: composer)
#   POS_NPM              npm command (default: npm; Node.js >= 22.12)
#   POS_FPM_SERVICE      e.g. php8.4-fpm: reloaded after the switch with `sudo -n systemctl reload` (frees the
#                        previous release's OPcache; needed with opcache.validate_timestamps=0 — give the
#                        deploy user a sudoers rule for exactly that command)
#   POS_ASSET_KEEP_DAYS  previous builds' /assets files younger than this are carried over (default 7)
#
# Run it as the application user (the PHP-FPM pool user, see deploy/php/pos-fpm.conf), never as root.
# It prints every step and command; nothing secret is printed (.env is linked, never read).

set -Eeuo pipefail   # -E: the ERR trap also fires inside functions and subshells
umask 022

POS_ROOT="${POS_ROOT:-/srv/pos}"
PHP="${POS_PHP:-php}"
COMPOSER="${POS_COMPOSER:-composer}"
NPM="${POS_NPM:-npm}"
FPM_SERVICE="${POS_FPM_SERVICE:-}"
ASSET_KEEP_DAYS="${POS_ASSET_KEEP_DAYS:-7}"

REF="main"
FRONTEND_DIST=""
MAINTENANCE=0
SKIP_PDF=0
KEEP=5
HEALTH_URL=""
FORCE=0
ROLLBACK=0

REPO_DIR="$POS_ROOT/repo.git"
RELEASES_DIR="$POS_ROOT/releases"
SHARED_DIR="$POS_ROOT/shared"
CURRENT_LINK="$POS_ROOT/current"

STEP="start"
IN_MAINTENANCE=0
SWITCHED=0

usage() {
    sed -n '2,/^$/{s/^# \{0,1\}//;p}' "$0"
}

die() {
    printf '\nERROR: %s\n' "$*" >&2
    exit 1
}

step() {
    STEP="$*"
    printf '\n==> [%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

run() {
    printf '    $ %s\n' "$*"
    "$@"
}

on_error() {
    local status=$?
    # In a ( … ) step only leave the subshell; the main shell reports once.
    if ((BASH_SUBSHELL > 0)); then
        exit "$status"
    fi
    printf '\nRelease FAILED during: %s (exit %s)\n' "$STEP" "$status" >&2
    if [[ $SWITCHED -eq 0 ]]; then
        printf 'The live release is unchanged: %s\n' "$(readlink "$CURRENT_LINK" 2>/dev/null || echo 'none')" >&2
    else
        printf 'The new release is already live. Fix the problem and re-run, or: %s --rollback\n' "$0" >&2
    fi
    if [[ $IN_MAINTENANCE -eq 1 ]]; then
        printf 'The site is still in MAINTENANCE mode (left down on purpose: migrations may have run only in part).\n' >&2
        printf 'After checking: cd %s/backend && %s artisan up\n' "$CURRENT_LINK" "$PHP" >&2
    fi
    exit "$status"
}
trap on_error ERR

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
        --frontend-dist) FRONTEND_DIST="${2:?--frontend-dist needs a path}"; shift 2 ;;
        --maintenance) MAINTENANCE=1; shift ;;
        --skip-pdf-renderer) SKIP_PDF=1; shift ;;
        --keep) KEEP="${2:?--keep needs a number}"; shift 2 ;;
        --health-url) HEALTH_URL="${2:?--health-url needs a URL}"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --rollback) ROLLBACK=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1 (see --help)" ;;
    esac
done

[[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 2 ]] || die "--keep must be a number >= 2"
[[ "$ASSET_KEEP_DAYS" =~ ^[0-9]+$ ]] || die "POS_ASSET_KEEP_DAYS must be a number"
[[ $EUID -ne 0 ]] || die "run as the application user, not root"

# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------

artisan() {
    # artisan <release dir> <args…>
    local dir="$1"
    shift
    (cd "$dir/backend" && run "$PHP" artisan "$@")
}

switch_to() {
    # Atomic: a new symlink renamed over the old one.
    local target="$1"
    [[ ! -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]] || die "$CURRENT_LINK exists and is not a symlink — move it away first"
    run ln -sfn "releases/$(basename "$target")" "$POS_ROOT/.current.new"
    run mv -fT "$POS_ROOT/.current.new" "$CURRENT_LINK"
    SWITCHED=1
}

reload_fpm() {
    if [[ -n "$FPM_SERVICE" ]]; then
        run sudo -n systemctl reload "$FPM_SERVICE"
    else
        printf '    ! POS_FPM_SERVICE is not set: reload PHP-FPM yourself (systemctl reload php8.4-fpm) so OPcache\n'
        printf '      drops the previous release (required with opcache.validate_timestamps=0 once its memory fills).\n'
    fi
}

health_check() {
    if [[ -n "$HEALTH_URL" ]]; then
        step "Health check"
        run curl --fail --silent --show-error --max-time 15 --output /dev/null "$HEALTH_URL"
        printf '    ok\n'
    fi
}

# ---------------------------------------------------------------------------------------------------------------
# Lock: one release at a time.
# ---------------------------------------------------------------------------------------------------------------

[[ -d "$POS_ROOT" ]] || die "$POS_ROOT does not exist (see deploy/README.md for the first-time setup)"
exec 9>"$POS_ROOT/.release.lock"
flock -n 9 || die "another release is running (lock: $POS_ROOT/.release.lock)"

PREVIOUS=""
if [[ -L "$CURRENT_LINK" ]]; then
    PREVIOUS="$(cd "$CURRENT_LINK" && pwd -P)"
fi

# ---------------------------------------------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------------------------------------------

if [[ $ROLLBACK -eq 1 ]]; then
    step "Rollback"
    [[ -n "$PREVIOUS" ]] || die "no live release to roll back from"
    target=""
    live="$(basename "$PREVIOUS")"
    # Release names sort by time: take the newest complete release older than the live one.
    while IFS= read -r dir; do
        if [[ "$dir" < "$live" && -f "$RELEASES_DIR/$dir/REVISION" ]]; then
            target="$RELEASES_DIR/$dir"
        fi
    done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
    [[ -n "$target" ]] || die "no earlier complete release in $RELEASES_DIR"
    printf '    from %s\n    to   %s (%s)\n' "$(basename "$PREVIOUS")" "$(basename "$target")" "$(cat "$target/REVISION")"
    printf '    ! Migrations are not rolled back: the previous code must work with the current schema.\n'
    step "Refresh caches of the previous release (backend/.env may have changed since)"
    artisan "$target" optimize
    step "Switch"
    switch_to "$target"
    reload_fpm
    step "Restart queue workers"
    artisan "$target" queue:restart
    health_check
    step "Rolled back to $(basename "$target")"
    exit 0
fi

# ---------------------------------------------------------------------------------------------------------------
# Release
# ---------------------------------------------------------------------------------------------------------------

step "Preflight"
for tool in git tar flock find curl; do
    command -v "$tool" >/dev/null || die "$tool is not installed"
done
command -v "$PHP" >/dev/null || die "PHP not found ($PHP); set POS_PHP"
run "$PHP" -r 'exit(PHP_VERSION_ID >= 80400 ? 0 : 1);' || die "PHP 8.4 is required (composer.json, OpenSpout)"
command -v "${COMPOSER%% *}" >/dev/null || die "Composer not found ($COMPOSER); set POS_COMPOSER"
if [[ -z "$FRONTEND_DIST" || $SKIP_PDF -eq 0 ]]; then
    command -v node >/dev/null || die "Node.js >= 22.12 is required (frontend build, PDF renderer)"
    command -v "$NPM" >/dev/null || die "npm not found ($NPM); set POS_NPM"
    run node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' \
        || die "Node.js >= 22.12 is required"
fi
[[ -d "$REPO_DIR" ]] || die "$REPO_DIR missing: git clone --mirror <repository url> $REPO_DIR"
[[ -f "$SHARED_DIR/.env" ]] || die "$SHARED_DIR/.env missing: start from backend/.env.example and docs/DEPLOYMENT_GUIDE.md"
if [[ -n "$FRONTEND_DIST" ]]; then
    [[ -e "$FRONTEND_DIST" ]] || die "--frontend-dist $FRONTEND_DIST does not exist"
fi

step "Fetch $REF"
run git --git-dir="$REPO_DIR" remote update --prune
COMMIT="$(git --git-dir="$REPO_DIR" rev-parse --verify --quiet "${REF}^{commit}")" || die "unknown ref: $REF"
SHORT="${COMMIT:0:12}"
printf '    commit %s\n' "$COMMIT"

if [[ -n "$PREVIOUS" && -f "$PREVIOUS/REVISION" && "$(cat "$PREVIOUS/REVISION")" == "$COMMIT" && $FORCE -eq 0 && -z "$FRONTEND_DIST" ]]; then
    step "Commit $SHORT is already live ($(basename "$PREVIOUS")) — nothing to do (use --force to rebuild)"
    exit 0
fi

STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
RELEASE="$RELEASES_DIR/$STAMP-$SHORT"

step "Create release $(basename "$RELEASE")"
run mkdir -p "$RELEASES_DIR" "$RELEASE"
git --git-dir="$REPO_DIR" archive --format=tar "$COMMIT" | tar -x -C "$RELEASE"
printf '    $ git archive %s | tar -x -C %s\n' "$SHORT" "$RELEASE"

step "Link shared .env and storage"
for dir in app/public app/private framework/cache/data framework/sessions framework/views framework/testing logs; do
    mkdir -p "$SHARED_DIR/storage/$dir"
done
run rm -rf "$RELEASE/backend/storage"
run ln -s "$SHARED_DIR/storage" "$RELEASE/backend/storage"
run ln -sfn "$SHARED_DIR/.env" "$RELEASE/backend/.env"
run mkdir -p "$RELEASE/backend/bootstrap/cache"

step "Backend dependencies (composer install --no-dev)"
if [[ -n "$PREVIOUS" && -d "$PREVIOUS/backend/vendor" ]]; then
    # Start from the live release's vendor/ so Composer only changes what differs.
    run cp -a "$PREVIOUS/backend/vendor" "$RELEASE/backend/vendor"
fi
# shellcheck disable=SC2086 # POS_COMPOSER may be a command with arguments ("php /opt/composer.phar").
(cd "$RELEASE/backend" && run $COMPOSER install --no-dev --optimize-autoloader --no-interaction --no-progress --prefer-dist)

if [[ $SKIP_PDF -eq 0 ]]; then
    step "PDF renderer (backend/pdf-renderer, npm ci; Chromium is never downloaded)"
    (cd "$RELEASE/backend/pdf-renderer" && run env PUPPETEER_SKIP_DOWNLOAD=1 "$NPM" ci --omit=dev --no-audit --no-fund)
else
    step "PDF renderer skipped (--skip-pdf-renderer)"
fi

if [[ -n "$FRONTEND_DIST" ]]; then
    step "Frontend: prebuilt dist from $FRONTEND_DIST"
    run rm -rf "$RELEASE/frontend/dist"
    run mkdir -p "$RELEASE/frontend/dist"
    case "$FRONTEND_DIST" in
        *.zip)
            command -v unzip >/dev/null || die "unzip is not installed"
            run unzip -q "$FRONTEND_DIST" -d "$RELEASE/frontend/dist" ;;
        *.tar.gz|*.tgz)
            run tar -xzf "$FRONTEND_DIST" -C "$RELEASE/frontend/dist" ;;
        *)
            [[ -d "$FRONTEND_DIST" ]] || die "--frontend-dist must be a directory, .zip or .tar.gz"
            run cp -a "$FRONTEND_DIST/." "$RELEASE/frontend/dist/" ;;
    esac
else
    step "Frontend: npm ci && npm run build"
    (cd "$RELEASE/frontend" && run "$NPM" ci --no-audit --no-fund && run "$NPM" run build)
    # Only dist/ is served; the build's node_modules is not needed at runtime.
    run rm -rf "$RELEASE/frontend/node_modules"
fi
for page in index.html storefront.html builder-canvas.html; do
    [[ -f "$RELEASE/frontend/dist/$page" ]] || die "frontend/dist/$page is missing — not a complete build"
done

if [[ -n "$PREVIOUS" && -d "$PREVIOUS/frontend/dist/assets" ]]; then
    step "Carry over recent assets of the live build (open tabs can still load their lazy chunks)"
    carried=0
    while IFS= read -r -d '' file; do
        rel="${file#"$PREVIOUS/frontend/dist/assets/"}"
        dest="$RELEASE/frontend/dist/assets/$rel"
        if [[ ! -e "$dest" ]]; then
            mkdir -p "$(dirname "$dest")"
            cp -p "$file" "$dest"
            carried=$((carried + 1))
        fi
    done < <(find "$PREVIOUS/frontend/dist/assets" -type f -mtime "-$ASSET_KEEP_DAYS" -print0)
    printf '    %s file(s) younger than %s days carried over\n' "$carried" "$ASSET_KEEP_DAYS"
fi

if [[ $MAINTENANCE -eq 1 && -n "$PREVIOUS" ]]; then
    step "Maintenance mode on (storage is shared, so it covers both releases)"
    artisan "$PREVIOUS" down --retry=60 --render=errors::503
    IN_MAINTENANCE=1
fi

step "Database migrations"
artisan "$RELEASE" migrate --force

step "Public storage link (backend/public/storage -> storage/app/public)"
if [[ -L "$RELEASE/backend/public/storage" ]]; then
    printf '    already linked\n'
else
    artisan "$RELEASE" storage:link
fi

step "Permissions and built-in roles"
artisan "$RELEASE" pos:permissions:sync

step "Cache config, routes, events and views"
artisan "$RELEASE" optimize

printf '%s\n' "$COMMIT" > "$RELEASE/REVISION"

step "Switch $CURRENT_LINK -> $(basename "$RELEASE")"
switch_to "$RELEASE"
reload_fpm

step "Restart queue workers (they finish their current job first)"
artisan "$RELEASE" queue:restart

if [[ $IN_MAINTENANCE -eq 1 ]]; then
    step "Maintenance mode off"
    artisan "$RELEASE" up
    IN_MAINTENANCE=0
fi

health_check

step "Remove old releases (keeping $KEEP complete ones)"
live="$(basename "$RELEASE")"
complete=()
while IFS= read -r dir; do
    if [[ "$dir" == "$live" || -f "$RELEASES_DIR/$dir/REVISION" ]]; then
        complete+=("$dir")
    else
        # A release that failed before going live (no REVISION): never a rollback target.
        run rm -rf "${RELEASES_DIR:?}/$dir"
    fi
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
excess=$((${#complete[@]} - KEEP))
for ((i = 0; i < excess; i++)); do
    if [[ "${complete[$i]}" != "$live" ]]; then
        run rm -rf "${RELEASES_DIR:?}/${complete[$i]}"
    fi
done

step "Released $SHORT as $live"
