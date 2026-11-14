<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Infrastructure\Feeds\CsvFeedWriter;
use App\Modules\Social\Infrastructure\Feeds\ProductFeedFiles;
use App\Modules\Social\Infrastructure\Feeds\XmlFeedWriter;
use App\Modules\Social\Infrastructure\Models\ProductFeed;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * P2b: `GET /feeds/{channel}/{token}.xml|csv` — the catalog feed Meta, TikTok and Pinterest fetch.
 * The token is the only key (any host); unknown or rotated tokens, another channel's token, a
 * disabled feed or a suspended organization answer 404. The language is the store's default,
 * `?lang=bn` while Bangla is on. The file is streamed from the feeds disk (regenerated when the
 * catalog changed); no session, no cookie.
 */
class PublicFeedController
{
    public function __invoke(
        Request $request,
        string $channel,
        string $token,
        string $format,
        TenantContext $tenant,
        LocaleContext $locale,
        OrganizationDirectory $organizations,
        StorefrontConfig $storefront,
        ProductFeedFiles $files,
    ): Response {
        $feed = ProductFeed::query()->withoutGlobalScope('organization')->where('token', strtolower($token))->first();
        if ($feed === null || $feed->channel->value !== $channel || ! $feed->enabled || ! $organizations->isActive($feed->organization_id)) {
            return response('Not found', 404, ['Content-Type' => 'text/plain; charset=UTF-8', 'X-Robots-Tag' => 'noindex']);
        }

        $file = $tenant->runAs($feed->organization_id, function () use ($feed, $format, $request, $locale, $storefront, $files) {
            $settings = $storefront->settings();
            $lang = LocaleContext::resolve($request->query('lang'), $settings->bangla_enabled, $settings->default_locale);
            $locale->configure($settings->bangla_enabled, $settings->default_locale, $lang);
            try {
                return $files->current($feed, $format);
            } finally {
                $locale->reset();
            }
        });

        $disk = $files->disk();
        $contentType = $format === 'csv' ? (new CsvFeedWriter)->contentType() : (new XmlFeedWriter)->contentType();
        $headers = [
            'Content-Type' => $contentType,
            // The URL is the secret: no shared cache may keep a feed alive after its token is rotated.
            'Cache-Control' => 'private, no-store',
            'X-Robots-Tag' => 'noindex',
            'X-Feed-Items' => (string) $file['item_count'],
        ];
        if ($format === 'csv') {
            $headers['Content-Disposition'] = 'inline; filename="'.$channel.'-catalog.csv"';
        }

        return new StreamedResponse(function () use ($disk, $file) {
            $stream = $disk->readStream($file['path']);
            if (is_resource($stream)) {
                fpassthru($stream);
                fclose($stream);
            }
        }, 200, $headers);
    }
}
