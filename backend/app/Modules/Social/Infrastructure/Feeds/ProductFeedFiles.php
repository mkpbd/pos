<?php

namespace App\Modules\Social\Infrastructure\Feeds;

use App\Modules\OnlineCatalog\Application\Contracts\CatalogFeed;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Infrastructure\Models\ProductFeed;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * P2b: generated feed files. A feed is generated item by item into a temporary stream (never one
 * big string; at most CatalogFeed::MAX_ITEMS items) and stored on the feeds disk
 * (`social.feeds_disk`, default `local`, private) under a random name; which file is current is
 * remembered per organization content version and language (StorefrontContentVersion, until the
 * next catalog / promotion schedule change), so a catalog change regenerates it on the next
 * fetch. Older files of the same feed, format and language are deleted after a generation.
 */
class ProductFeedFiles
{
    public const DIRECTORY = 'social-feeds';

    public function __construct(
        private readonly Container $container,
        private readonly StorefrontContentVersion $version,
        private readonly StorefrontCatalog $catalog,
        private readonly StorefrontConfig $storefront,
        private readonly OrganizationDirectory $organizations,
        private readonly SocialConfig $config,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * The current file of a feed in the request's language (generated when the catalog changed).
     *
     * @return array{path: string, item_count: int, generated_at: string}
     */
    public function current(ProductFeed $feed, string $format): array
    {
        $meta = $this->version->remember(
            $feed->organization_id,
            'social-feed:'.$feed->id.':'.$format,
            fn () => $this->generate($feed, $format),
            fn () => $this->catalog->nextScheduledChange(),
        );
        if (! is_array($meta) || ! is_string($meta['path'] ?? null) || ! $this->disk()->exists($meta['path'])) {
            // A newer generation replaced the remembered file.
            $meta = $this->generate($feed, $format);
        }

        return $meta;
    }

    /**
     * Writes the feed file now (also counts the items for the admin).
     *
     * @return array{path: string, item_count: int, generated_at: string}
     */
    public function generate(ProductFeed $feed, string $format): array
    {
        $writer = $format === 'csv' ? new CsvFeedWriter : new XmlFeedWriter;
        $settings = $this->storefront->settings();
        $locale = $this->locale->current();
        $default = $settings->bangla_enabled ? $settings->default_locale : LocaleContext::EN;
        $site = $this->config->siteUrl();
        $store = (string) $settings->site_name;
        $currency = (string) ($this->organizations->summary($feed->organization_id)['base_currency'] ?? config('pos.default_currency', 'BDT'));
        $now = CarbonImmutable::now();

        $stream = fopen('php://temp/maxmemory:4194304', 'w+b');
        if ($stream === false) {
            throw new \RuntimeException('Could not open a temporary stream for the feed.');
        }
        $writer->begin($stream, $store, $site.'/', (string) ($settings->meta_description ?: $store));
        $count = 0;
        foreach ($this->container->make(CatalogFeed::class)->items(CatalogFeed::MAX_ITEMS) as $item) {
            $writer->item($stream, $this->row($item, $feed, $site, $store, $currency, $locale === $default ? null : $locale, $now));
            $count++;
        }
        $writer->end($stream);
        rewind($stream);

        $prefix = $feed->id.'-'.$format.'-'.$locale.'-';
        $directory = self::DIRECTORY.'/'.$feed->organization_id;
        $path = $directory.'/'.$prefix.Str::lower(Str::random(16)).'.'.$format;
        $this->disk()->writeStream($path, $stream);
        fclose($stream);
        foreach ($this->disk()->files($directory) as $file) {
            if ($file !== $path && str_starts_with(basename($file), $prefix)) {
                $this->deleteQuietly($file);
            }
        }

        ProductFeed::query()->withoutGlobalScope('organization')->whereKey($feed->id)->update(['item_count' => $count, 'last_generated_at' => $now]);

        return ['path' => $path, 'item_count' => $count, 'generated_at' => $now->toIso8601String()];
    }

    /**
     * Removes every file of a feed (a rotated token or a disabled feed must not be served).
     */
    public function forget(ProductFeed $feed): void
    {
        foreach ($this->disk()->files(self::DIRECTORY.'/'.$feed->organization_id) as $file) {
            if (str_starts_with(basename($file), $feed->id.'-')) {
                $this->deleteQuietly($file);
            }
        }
    }

    public function disk(): Filesystem
    {
        return Storage::disk((string) config('social.feeds_disk', 'local'));
    }

    /**
     * @param  array<string, mixed>  $item  CatalogFeed item
     * @return array<string, mixed> FeedWriter row
     */
    private function row(array $item, ProductFeed $feed, string $site, string $store, string $currency, ?string $lang, CarbonImmutable $now): array
    {
        $absolute = fn (string $url) => preg_match('#^https?://#i', $url) === 1 ? $url : $site.'/'.ltrim($url, '/');
        $link = $site.$item['path'];
        $link .= (str_contains($link, '?') ? '&' : '?').http_build_query(array_filter([
            'lang' => $lang,
            'utm_source' => $feed->channel->value,
            'utm_medium' => 'shop',
        ]), '', '&', PHP_QUERY_RFC3986);
        $images = array_values(array_map($absolute, $item['image_urls']));
        $endsAt = null;
        if (is_string($item['sale_ends_at'] ?? null)) {
            try {
                $endsAt = CarbonImmutable::parse($item['sale_ends_at']);
            } catch (Throwable) {
                $endsAt = null;
            }
        }

        return [
            // Google allows 50 characters; longer SKUs use the variant id.
            'id' => mb_strlen($item['id']) <= 50 ? $item['id'] : $item['variant_id'],
            'item_group_id' => $item['item_group_id'],
            'title' => $item['title'],
            'description' => $item['description'],
            'link' => $link,
            'image_link' => $images[0] ?? null,
            'additional_image_links' => array_slice($images, 1, CatalogFeed::MAX_ADDITIONAL_IMAGES),
            'availability' => $item['in_stock'] ? 'in_stock' : 'out_of_stock',
            'condition' => 'new',
            'price' => $item['price'].' '.$currency,
            'sale_price' => $item['sale_price'] === null ? null : $item['sale_price'].' '.$currency,
            'sale_price_effective_date' => $item['sale_price'] !== null && $endsAt !== null ? $now->toIso8601String().'/'.$endsAt->toIso8601String() : null,
            'brand' => $item['brand'] ?? ($store === '' ? null : $store),
            'product_type' => $item['product_type'],
            'color' => $item['color'],
            'size' => $item['size'],
        ];
    }

    private function deleteQuietly(string $file): void
    {
        try {
            $this->disk()->delete($file);
        } catch (Throwable) {
            // Still being read (Windows) — the next generation removes it.
        }
    }
}
