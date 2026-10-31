<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Serves the built storefront page (frontend/dist/storefront.html) for every storefront
 * URL, with the page's metadata written into the HTML on the server (ADR-008) and the
 * bootstrap payload inlined so the first paint needs no extra request.
 *
 * Paths the storefront does not have yet are answered with status 404 while the SPA
 * renders its not-found page, so crawlers never index dead URLs.
 */
class StorefrontShellController
{
    /** Storefront routes that exist in this phase (exact paths); content pages are looked up. */
    private const KNOWN_PATHS = ['/', '/shop', '/search', '/newsletter/confirm', '/newsletter/unsubscribe', ...self::ACCOUNT_PATHS];

    /** Shopper pages (E7, E8a): account, cart, wishlist and checkout. Personal, never indexed. */
    private const ACCOUNT_PATHS = [
        '/account', '/account/login', '/account/register', '/account/forgot-password', '/account/reset-password',
        '/account/verify-email', '/account/profile', '/account/addresses', '/cart', '/wishlist', '/checkout',
    ];

    /** Utility pages that search engines should not index. */
    private const NOINDEX_PATHS = ['/search', '/newsletter/confirm', '/newsletter/unsubscribe', ...self::ACCOUNT_PATHS];

    public function __invoke(Request $request, StorefrontBootstrap $bootstrap, PageDirectory $pages, StorefrontCatalog $catalog): Response
    {
        $shell = config('storefront.shell_path');
        if (! is_string($shell) || ! is_file($shell)) {
            return response('The storefront has not been built. Run "npm run build" in frontend/.', 503, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }

        $data = $bootstrap->build() + ['preview' => $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview']];
        $path = '/'.ltrim($request->path(), '/');
        $meta = ['title' => $data['store']['name'], 'description' => $data['store']['description']];
        $status = in_array($path, self::KNOWN_PATHS, true) ? 200 : 404;

        if (preg_match('#^/pages/([a-z0-9-]{1,100})$#', $path, $m) === 1 && ($page = $pages->visibleBySlug($m[1])) !== null) {
            $status = 200;
            $meta = [
                'title' => ($page['seo_title'] ?? $page['title']).' | '.$data['store']['name'],
                'description' => $page['seo_description'] ?? $data['store']['description'],
            ];
        }
        if ($path === '/shop') {
            $meta['title'] = 'Shop | '.$data['store']['name'];
        }
        if ($path === '/search') {
            $meta['title'] = 'Search | '.$data['store']['name'];
        }
        if (in_array($path, self::ACCOUNT_PATHS, true)) {
            $meta['title'] = match ($path) {
                '/cart' => 'Cart',
                '/wishlist' => 'Wishlist',
                '/checkout' => 'Checkout',
                default => 'My account',
            }.' | '.$data['store']['name'];
        }
        // Order confirmation / status pages (E8a): personal, never indexed; the SPA asks the API.
        $orderPage = preg_match('#^/order/[A-Za-z0-9-]{1,40}$#', $path) === 1;
        if ($orderPage) {
            $status = 200;
            $meta['title'] = 'Your order | '.$data['store']['name'];
        }
        if (preg_match('#^/(category|brand|product)/([A-Za-z0-9-]{1,120})$#', $path, $m) === 1 && ($found = $catalog->pageMeta($m[1], $m[2])) !== null) {
            $status = 200;
            $meta = [
                'title' => $found['title'].' | '.$data['store']['name'],
                'description' => $found['description'] ?? $data['store']['description'],
                'image' => $found['image_url'] === null ? null : $request->getSchemeAndHttpHost().$found['image_url'],
                'type' => $m[1] === 'product' ? 'product' : 'website',
            ];
        }
        $noindex = $data['preview'] || $status === 404 || $orderPage || in_array($path, self::NOINDEX_PATHS, true);

        $html = $this->inject((string) file_get_contents($shell), $data, $meta, $request->url(), $noindex);

        return response($html, $status, ['Content-Type' => 'text/html; charset=UTF-8'])
            // Previews of a closed store must never be cached or indexed.
            ->header('Cache-Control', $data['preview'] ? 'no-store' : 'no-cache')
            ->header('X-Robots-Tag', $noindex ? 'noindex' : 'all');
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array{title: string, description: ?string, image?: ?string, type?: string}  $meta
     */
    private function inject(string $html, array $data, array $meta, string $url, bool $noindex): string
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
            $head[] = '<meta name="robots" content="noindex">';
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
