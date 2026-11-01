<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Application\Queries\StorefrontSitemap;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * robots.txt and the XML sitemaps of a storefront host (E12).
 */
class StorefrontSeoController
{
    /** Paths crawlers have no business in: personal pages, search results, the admin and the API. */
    private const DISALLOWED = ['/cart', '/checkout', '/account', '/order/', '/search', '/admin', '/api/'];

    /**
     * robots.txt
     *
     * Public, for any host. The open store on its primary domain with `allow_indexing` keeps
     * crawlers out of personal and utility paths and points at the sitemap; a closed store, a
     * store with indexing switched off, a secondary domain or an unknown host gets `Disallow: /`.
     */
    public function robots(Request $request, ResolveStorefront $resolver, OrganizationDirectory $organizations): Response
    {
        $host = $resolver->host($request);
        $domain = StorefrontDomain::query()->withoutGlobalScope('organization')->where('host', $host)->first();
        $organizationId = $domain?->organization_id;

        $open = false;
        if ($organizationId !== null && $organizations->isActive($organizationId)) {
            $settings = StorefrontSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();
            $primary = StorefrontDomain::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)
                ->orderByDesc('is_primary')->orderBy('host')->value('host');
            $open = $settings !== null && $settings->is_enabled && $settings->allow_indexing && $primary === $host;
        }

        $lines = ['User-agent: *'];
        if ($open) {
            foreach (self::DISALLOWED as $path) {
                $lines[] = 'Disallow: '.$path;
            }
            $lines[] = '';
            $lines[] = 'Sitemap: '.$this->scheme().'://'.$host.'/sitemap.xml';
        } else {
            $lines[] = 'Disallow: /';
        }

        return response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }

    /**
     * Sitemap index (`/sitemap.xml`) and its files (`/sitemaps/{name}.xml`)
     *
     * Open stores on their primary domain with `allow_indexing` only; anything else is 404.
     */
    public function sitemap(Request $request, StorefrontSitemap $sitemaps, StorefrontConfig $config, ResolveStorefront $resolver, ?string $name = null): Response
    {
        $base = $config->primaryUrl();
        $preview = $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview'];
        $xml = null;
        if (! $preview && $base !== null && $config->settings()->allow_indexing && parse_url($base, PHP_URL_HOST) === $resolver->host($request)) {
            $xml = $sitemaps->document($name ?? 'sitemap', $base);
        }
        if ($xml === null) {
            return response()->view('storefront::not-found', [], 404);
        }

        return response($xml, 200, [
            'Content-Type' => 'application/xml; charset=UTF-8',
            'Cache-Control' => 'public, max-age=600',
            'X-Robots-Tag' => 'noindex',
        ]);
    }

    private function scheme(): string
    {
        return parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https';
    }
}
