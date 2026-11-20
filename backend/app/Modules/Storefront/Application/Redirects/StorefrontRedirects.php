<?php

namespace App\Modules\Storefront\Application\Redirects;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Events\PublicAddressChanged;
use App\Modules\Storefront\Domain\RedirectPaths;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontRedirect;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;

/**
 * B16: storefront redirects — serving, hit counts, whether an address is a live page, and the
 * automatic 301s when a public address changes:
 *
 * - addressChanged() (PublicAddressChanged, inside the owning module's transaction): no redirect
 *   stays from the new address (it is live again); everything that went to the old address goes
 *   to the new one (chains collapse: A→B, B→C ⇒ A→C, C→… untouched); old → new is added (an
 *   existing redirect from the old address is replaced: the old address was a live page, so it
 *   could never apply). Loops cannot remain: a redirect back from the new address was deleted.
 * - match(): the redirect of a path that is not a live page (the shell and the public resolve
 *   endpoint); reserved addresses never redirect.
 * - hit(): counted through the cache and written at most once a minute per redirect (no
 *   visitor data at all), so a busy old address costs one UPDATE a minute.
 */
class StorefrontRedirects
{
    /** Cached hits not yet written, and the once-a-minute write marker. */
    private const PENDING = 'sf-redirect-hits:';

    private const FLUSH = 'sf-redirect-flush:';

    private const FLUSH_SECONDS = 60;

    public function __construct(
        private readonly PageDirectory $pages,
        private readonly BlogDirectory $blog,
        private readonly StorefrontCatalog $catalog,
    ) {}

    public function onAddressChanged(PublicAddressChanged $event): void
    {
        $this->addressChanged($event->organizationId, $event->from, $event->to);
    }

    /**
     * @param  ?string  $from  the old address (null: a new record)
     * @param  ?string  $to  the new address
     */
    public function addressChanged(string $organizationId, ?string $from, ?string $to): void
    {
        $from = $from === null ? null : RedirectPaths::from($from);
        $to = $to === null ? null : RedirectPaths::from($to);
        $query = fn (): Builder => StorefrontRedirect::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId);

        if ($to !== null) {
            $query()->where('from_path', $to)->delete();
        }
        if ($from === null || $to === null || $from === $to || RedirectPaths::reserved($from)) {
            return;
        }

        $now = CarbonImmutable::now();
        $query()->where(fn (Builder $q) => $q->where('to_path', $from)->orWhere('to_path', 'like', self::escapeLike($from).'?%'))
            ->get()->each(function (StorefrontRedirect $redirect) use ($from, $to, $now) {
                $redirect->to_path = $to.substr($redirect->to_path, strlen($from));
                $redirect->updated_at = $now;
                $redirect->save();
            });

        $existing = $query()->where('from_path', $from)->first();
        if ($existing !== null) {
            $existing->fill(['to_path' => $to, 'type' => 301, 'source' => StorefrontRedirect::SOURCE_AUTO])->save();

            return;
        }
        $redirect = new StorefrontRedirect(['from_path' => $from, 'to_path' => $to, 'type' => 301, 'source' => StorefrontRedirect::SOURCE_AUTO]);
        $redirect->organization_id = $organizationId;
        $redirect->save();
    }

    /**
     * The redirect of an address of the current store, or null (no redirect, or an address that
     * is never redirected). The caller knows the address is not a live page.
     */
    public function find(string $path): ?StorefrontRedirect
    {
        $path = RedirectPaths::from($path);
        if ($path === null || RedirectPaths::reserved($path)) {
            return null;
        }

        return StorefrontRedirect::query()->where('from_path', $path)->first();
    }

    /**
     * Counts a visit through a redirect: at most one write a minute per redirect, adding what
     * was counted in the cache meanwhile.
     */
    public function hit(StorefrontRedirect $redirect): void
    {
        $pending = self::PENDING.$redirect->id;
        Cache::add($pending, 0, 86400);
        Cache::increment($pending);
        if (! Cache::add(self::FLUSH.$redirect->id, true, self::FLUSH_SECONDS)) {
            return;
        }
        $count = (int) Cache::pull($pending, 0);
        if ($count > 0) {
            // The base query: the redirect's own updated_at stays "last edited".
            StorefrontRedirect::query()->whereKey($redirect->id)->toBase()->increment('hits', $count, ['last_hit_at' => CarbonImmutable::now()]);
        }
    }

    /**
     * Where a redirect sends a visitor: the target with the request's query string (campaign
     * tags survive) unless the target has its own.
     */
    public static function location(StorefrontRedirect $redirect, ?string $query): string
    {
        return $query === null || $query === '' || str_contains($redirect->to_path, '?')
            ? $redirect->to_path
            : $redirect->to_path.'?'.$query;
    }

    /**
     * Whether a normalized address of the current store is a page shoppers can open now
     * (reserved store pages, content pages, published landing pages, blog posts and categories,
     * visible products, categories and brands).
     */
    public function live(string $path): bool
    {
        if (RedirectPaths::reserved($path)) {
            return true;
        }

        return match (true) {
            preg_match('#^/pages/([a-z0-9-]{1,100})$#', $path, $m) === 1 => $this->pages->visibleBySlug($m[1]) !== null,
            preg_match('#^/p/([a-z0-9-]{2,60})$#', $path, $m) === 1 => BuilderDocument::query()->where('key', BuilderDocument::LANDING_PREFIX.$m[1])
                ->whereNotNull('published_version_id')->exists(),
            preg_match('#^/blog/category/([a-z0-9-]{1,100})$#', $path, $m) === 1 => $this->blog->categoryMeta($m[1]) !== null,
            preg_match('#^/blog/([a-z0-9-]{1,100})$#', $path, $m) === 1 => $this->blog->postMeta($m[1]) !== null,
            preg_match('#^/(category|brand|product)/([a-z0-9-]{1,120})$#', $path, $m) === 1 => $this->catalog->pageMeta($m[1], $m[2]) !== null,
            default => false,
        };
    }

    /**
     * The current store's own host names (lower case).
     *
     * @return list<string>
     */
    public function ownHosts(): array
    {
        return array_values(array_map('strtolower', StorefrontDomain::query()->pluck('host')->all()));
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
