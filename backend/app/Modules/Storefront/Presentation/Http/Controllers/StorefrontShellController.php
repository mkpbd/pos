<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use App\Modules\Storefront\Presentation\Http\Support\StructuredData;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Serves the built storefront page (frontend/dist/storefront.html) for every storefront
 * URL, with the page's metadata written into the HTML on the server (ADR-008) and the
 * bootstrap payload inlined so the first paint needs no extra request.
 *
 * Paths the storefront does not have yet are answered with status 404 while the SPA
 * renders its not-found page, so crawlers never index dead URLs.
 *
 * E12: schema.org JSON-LD per page type (Organization everywhere; WebSite on the homepage;
 * Product + BreadcrumbList on products; CollectionPage + BreadcrumbList on categories and
 * brands; BlogPosting + BreadcrumbList on posts; BreadcrumbList on content pages and blog
 * categories) — only Organization on noindex pages. Listings canonicalize to the unfiltered
 * URL (`?page=N` kept beyond page 1) and are noindex,follow when filtered or sorted. With
 * `allow_indexing` off every page is noindex.
 */
class StorefrontShellController
{
    /** Storefront routes that exist in this phase (exact paths); content pages are looked up. */
    private const KNOWN_PATHS = ['/', '/shop', '/search', '/blog', '/newsletter/confirm', '/newsletter/unsubscribe', ...self::ACCOUNT_PATHS];

    /** Shopper pages (E7, E8a, E9, E10b returns): account, cart, wishlist and checkout. Personal, never indexed. */
    private const ACCOUNT_PATHS = [
        '/account', '/account/login', '/account/register', '/account/forgot-password', '/account/reset-password',
        '/account/verify-email', '/account/profile', '/account/addresses', '/account/orders', '/account/reviews', '/account/returns',
        '/cart', '/wishlist', '/checkout',
    ];

    /** Utility pages that search engines should not index. */
    private const NOINDEX_PATHS = ['/search', '/newsletter/confirm', '/newsletter/unsubscribe', ...self::ACCOUNT_PATHS];

    /** Query parameters that neither filter a listing nor change its canonical URL (campaign tracking). */
    private const TRACKING_PARAMETERS = ['gclid', 'fbclid', 'msclkid', 'ref'];

    public const ROBOTS_NOINDEX = 'noindex, follow';

    public function __invoke(Request $request, StorefrontBootstrap $bootstrap, PageDirectory $pages, StorefrontCatalog $catalog, BlogDirectory $blog): Response
    {
        $shell = config('storefront.shell_path');
        if (! is_string($shell) || ! is_file($shell)) {
            return response('The storefront has not been built. Run "npm run build" in frontend/.', 503, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }

        $data = $bootstrap->build() + ['preview' => $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview']];
        $store = $data['store']['name'];
        $path = '/'.ltrim($request->path(), '/');
        $meta = ['title' => $store, 'description' => $data['store']['description']];
        $status = in_array($path, self::KNOWN_PATHS, true) ? 200 : 404;
        $ld = new StructuredData($request->getSchemeAndHttpHost());
        /** @var list<array<string, mixed>> $documents structured data besides Organization */
        $documents = [];
        $isListing = in_array($path, ['/shop', '/blog'], true);

        if ($path === '/') {
            $documents[] = $ld->website($store);
        }
        if (preg_match('#^/pages/([a-z0-9-]{1,100})$#', $path, $m) === 1 && ($page = $pages->visibleBySlug($m[1])) !== null) {
            $status = 200;
            $meta = [
                'title' => ($page['seo_title'] ?? $page['title']).' | '.$store,
                'description' => $page['seo_description'] ?? $data['store']['description'],
            ];
            $documents[] = $ld->breadcrumbs([['name' => 'Home', 'url' => '/'], ['name' => $page['title'], 'url' => '/pages/'.$page['slug']]]);
        }
        // The blog (E11): index, category pages and posts (staff may preview unpublished posts).
        if ($path === '/blog') {
            $meta['title'] = 'Blog | '.$store;
        }
        $blogPreview = false;
        if (preg_match('#^/blog/category/([A-Za-z0-9-]{1,100})$#', $path, $m) === 1 && ($category = $blog->categoryMeta($m[1])) !== null) {
            $status = 200;
            $isListing = true;
            $meta = [
                'title' => $category['name'].' | '.$store,
                'description' => $category['description'] ?? $data['store']['description'],
            ];
            $documents[] = $ld->breadcrumbs([
                ['name' => 'Home', 'url' => '/'],
                ['name' => 'Blog', 'url' => '/blog'],
                ['name' => $category['name'], 'url' => '/blog/category/'.$category['slug']],
            ]);
        } elseif (preg_match('#^/blog/([A-Za-z0-9-]{1,100})$#', $path, $m) === 1) {
            $blogPreview = $request->boolean('preview') && $this->canManageContent($request);
            $post = $blog->postMeta($m[1], $blogPreview);
            if ($post !== null) {
                $status = 200;
                $meta = [
                    'title' => ($post['seo_title'] ?? $post['title']).' | '.$store,
                    'description' => $post['description'] ?? $data['store']['description'],
                    'image' => $ld->absolute($post['image_url']),
                    'type' => 'article',
                ];
                $postUrl = $request->getSchemeAndHttpHost().'/blog/'.$post['slug'];
                $documents[] = $ld->blogPosting($post, $postUrl, $this->organization($ld, $data));
                $documents[] = $ld->breadcrumbs([
                    ['name' => 'Home', 'url' => '/'],
                    ['name' => 'Blog', 'url' => '/blog'],
                    ...($post['category'] === null ? [] : [['name' => $post['category']['name'], 'url' => '/blog/category/'.$post['category']['slug']]]),
                    ['name' => $post['title'], 'url' => '/blog/'.$post['slug']],
                ]);
            }
        }
        if ($path === '/shop') {
            $meta['title'] = 'Shop | '.$store;
        }
        if ($path === '/search') {
            $meta['title'] = 'Search | '.$store;
        }
        if (in_array($path, self::ACCOUNT_PATHS, true)) {
            $meta['title'] = match ($path) {
                '/cart' => 'Cart',
                '/wishlist' => 'Wishlist',
                '/checkout' => 'Checkout',
                default => 'My account',
            }.' | '.$store;
        }
        // Order confirmation / status pages (E8a): personal, never indexed; the SPA asks the API.
        // and the customer's own order page in the account area (E9).
        $orderPage = preg_match('#^/(order|account/orders)/[A-Za-z0-9-]{1,40}$#', $path) === 1;
        if ($orderPage) {
            $status = 200;
            $meta['title'] = 'Your order | '.$store;
        }
        if (preg_match('#^/(category|brand|product)/([A-Za-z0-9-]{1,120})$#', $path, $m) === 1 && ($found = $catalog->pageMeta($m[1], $m[2])) !== null) {
            $status = 200;
            $meta = [
                'title' => $found['title'].' | '.$store,
                'description' => $found['description'] ?? $data['store']['description'],
                'image' => $ld->absolute($found['image_url']),
                'type' => $m[1] === 'product' ? 'product' : 'website',
            ];
            if ($m[1] === 'product' && isset($found['product'])) {
                $documents[] = $ld->product($found['product'], (string) ($data['store']['currency'] ?? config('pos.default_currency', 'BDT')));
            } elseif ($m[1] !== 'product') {
                $isListing = true;
                $documents[] = $ld->collectionPage($found['name'], $found['description'], $path);
            }
            if ($found['breadcrumbs'] !== []) {
                $documents[] = $ld->breadcrumbs($found['breadcrumbs']);
            }
        }

        // Listings: the canonical URL drops filters, sort and tracking but keeps ?page=N (N > 1);
        // a filtered or sorted listing is noindex,follow so only the plain listing is indexed.
        $canonical = $request->url();
        $filtered = false;
        if ($isListing && $status === 200) {
            $query = array_diff_key($request->query(), array_flip(['page', ...self::TRACKING_PARAMETERS]));
            $query = array_filter($query, fn ($v, $k) => ! str_starts_with((string) $k, 'utm_'), ARRAY_FILTER_USE_BOTH);
            $filtered = $query !== [];
            $page = filter_var($request->query('page'), FILTER_VALIDATE_INT);
            if (is_int($page) && $page > 1) {
                $canonical .= '?page='.$page;
            }
        }

        $noindex = $data['preview'] || $blogPreview || $status === 404 || $orderPage || $filtered
            || in_array($path, self::NOINDEX_PATHS, true)
            || ! ($data['store']['allow_indexing'] ?? true);

        // Structured data never describes pages search engines should not index (except who runs the store).
        $documents = [$this->organization($ld, $data), ...($noindex ? [] : $documents)];

        $html = $this->inject((string) file_get_contents($shell), $data, $meta, $canonical, $noindex, $documents);

        return response($html, $status, ['Content-Type' => 'text/html; charset=UTF-8'])
            // Previews of a closed store must never be cached or indexed.
            ->header('Cache-Control', $data['preview'] || $blogPreview ? 'no-store' : 'no-cache')
            ->header('X-Robots-Tag', $noindex ? 'noindex' : 'all');
    }

    /**
     * @param  array<string, mixed>  $data  bootstrap payload
     * @return array<string, mixed>
     */
    private function organization(StructuredData $ld, array $data): array
    {
        return $ld->organization($data['store']['name'], $data['theme']['logo']['url'] ?? null, $data['theme']['footer']['contact'] ?? []);
    }

    /**
     * A signed-in staff member of this store who may manage content (blog previews).
     */
    private function canManageContent(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof TenantUser
            && $user->isActive()
            && $user->organizationId() === $request->attributes->get(ResolveStorefront::ATTRIBUTE)['organization_id']
            && $user->can('cms.manage');
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array{title: string, description: ?string, image?: ?string, type?: string}  $meta
     * @param  list<array<string, mixed>>  $documents  JSON-LD
     */
    private function inject(string $html, array $data, array $meta, string $url, bool $noindex, array $documents): string
    {
        $e = fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $name = $data['store']['name'];
        $title = $meta['title'];
        $description = $meta['description'];

        $head = [
            '<meta name="description" content="'.$e($description).'">',
            '<meta name="theme-color" content="'.$e($data['theme']['colors']['accent']).'">',
            '<link rel="canonical" href="'.$e($url).'">',
            '<meta property="og:type" content="'.$e($meta['type'] ?? 'website').'">',
            '<meta property="og:site_name" content="'.$e($name).'">',
            '<meta property="og:title" content="'.$e($title).'">',
            '<meta property="og:url" content="'.$e($url).'">',
        ];
        if ($description) {
            $head[] = '<meta property="og:description" content="'.$e($description).'">';
        }
        if (! empty($meta['image'])) {
            $head[] = '<meta property="og:image" content="'.$e($meta['image']).'">';
        }
        if ($data['theme']['favicon']) {
            $head[] = '<link rel="icon" href="'.$e($data['theme']['favicon']['url']).'">';
        }
        if ($noindex) {
            $head[] = '<meta name="robots" content="'.self::ROBOTS_NOINDEX.'">';
        }
        if ($documents !== []) {
            $head[] = StructuredData::scripts($documents);
        }
        // JSON_HEX_* keeps "</script>" and friends from ending the element early.
        $json = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $head[] = '<script id="storefront-bootstrap" type="application/json">'.$json.'</script>';

        $html = preg_replace('#<title>.*?</title>#s', '<title>'.$e($title).'</title>', $html, 1) ?? $html;
        if ($data['theme']['favicon']) {
            $html = preg_replace('#<link rel="icon"[^>]*>#', '', $html, 1) ?? $html;
        }

        return str_replace('</head>', implode("\n    ", $head)."\n  </head>", $html);
    }
}
