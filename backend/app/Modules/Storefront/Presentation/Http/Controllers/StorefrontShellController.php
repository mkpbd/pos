<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

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
    /** Storefront routes that exist in this phase (exact paths). */
    private const KNOWN_PATHS = ['/'];

    public function __invoke(Request $request, StorefrontBootstrap $bootstrap): Response
    {
        $shell = config('storefront.shell_path');
        if (! is_string($shell) || ! is_file($shell)) {
            return response('The storefront has not been built. Run "npm run build" in frontend/.', 503, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }

        $data = $bootstrap->build() + ['preview' => $request->attributes->get(ResolveStorefront::ATTRIBUTE)['preview']];
        $path = '/'.ltrim($request->path(), '/');
        $status = in_array($path, self::KNOWN_PATHS, true) ? 200 : 404;

        $html = $this->inject((string) file_get_contents($shell), $data, $request->url());

        return response($html, $status, ['Content-Type' => 'text/html; charset=UTF-8'])
            // Previews of a closed store must never be cached or indexed.
            ->header('Cache-Control', $data['preview'] ? 'no-store' : 'no-cache')
            ->header('X-Robots-Tag', $data['preview'] || $status === 404 ? 'noindex' : 'all');
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function inject(string $html, array $data, string $url): string
    {
        $e = fn (?string $v) => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $name = $data['store']['name'];
        $description = $data['store']['description'];

        $head = [
            '<meta name="description" content="'.$e($description).'">',
            '<meta name="theme-color" content="'.$e($data['theme']['colors']['accent']).'">',
            '<link rel="canonical" href="'.$e($url).'">',
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="'.$e($name).'">',
            '<meta property="og:title" content="'.$e($name).'">',
            '<meta property="og:url" content="'.$e($url).'">',
        ];
        if ($description) {
            $head[] = '<meta property="og:description" content="'.$e($description).'">';
        }
        if ($data['theme']['favicon']) {
            $head[] = '<link rel="icon" href="'.$e($data['theme']['favicon']['url']).'">';
        }
        if ($data['preview']) {
            $head[] = '<meta name="robots" content="noindex">';
        }
        // JSON_HEX_* keeps "</script>" and friends from ending the element early.
        $json = json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $head[] = '<script id="storefront-bootstrap" type="application/json">'.$json.'</script>';

        $html = preg_replace('#<title>.*?</title>#s', '<title>'.$e($name).'</title>', $html, 1) ?? $html;
        if ($data['theme']['favicon']) {
            $html = preg_replace('#<link rel="icon"[^>]*>#', '', $html, 1) ?? $html;
        }

        return str_replace('</head>', implode("\n    ", $head)."\n  </head>", $html);
    }
}
