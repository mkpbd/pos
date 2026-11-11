<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Queries\DemoStoreGallery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * T2: the demo store gallery, on any host (it needs no store). Only while
 * `storefront.demo_gallery` is on (never in production); otherwise 404.
 */
class DemoGalleryController
{
    public const PAGE_TITLE = 'Online store demos';

    /**
     * Demo stores
     *
     * Public. The demo stores of this server in configured order: `{host, name, preset,
     * tagline, colors: {primary, accent, canvas}, heading_font, image_url, product_count,
     * category_names}` — only what each store shows publicly. 404 `NOT_FOUND` while the
     * gallery is off.
     */
    public function index(DemoStoreGallery $gallery): JsonResponse
    {
        if (! self::enabled()) {
            return ApiResponse::error('NOT_FOUND', 'The demo gallery is not enabled on this server.', 404);
        }

        return ApiResponse::success($gallery->list());
    }

    /**
     * The storefront page (frontend/dist/storefront.html) for `/demos`, without store data:
     * the SPA renders the gallery from the API. Never indexed.
     */
    public function page(): Response
    {
        if (! self::enabled()) {
            return response()->view('storefront::not-found', [], 404);
        }
        $shell = config('storefront.shell_path');
        if (! is_string($shell) || ! is_file($shell)) {
            return response('The storefront has not been built. Run "npm run build" in frontend/.', 503, ['Content-Type' => 'text/plain; charset=UTF-8']);
        }

        $html = (string) file_get_contents($shell);
        $html = preg_replace('#<title>.*?</title>#s', '<title>'.self::PAGE_TITLE.'</title>', $html, 1) ?? $html;
        $html = str_replace('</head>', '<meta name="robots" content="noindex, nofollow">'."\n  </head>", $html);

        return response($html, 200, ['Content-Type' => 'text/html; charset=UTF-8'])
            ->header('Cache-Control', 'no-cache')
            ->header('X-Robots-Tag', 'noindex');
    }

    public static function enabled(): bool
    {
        return (bool) config('storefront.demo_gallery') && ! app()->isProduction();
    }
}
