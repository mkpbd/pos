<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * The storefront's XML sitemaps (E12): an index pointing at `pages.xml`, `products-{n}.xml`
 * (at most 5000 URLs each), `categories.xml`, `brands.xml` and `blog.xml`. Only live,
 * visible and published records; absolute URLs on the primary domain; `<lastmod>` from the
 * records' updated_at; products carry their first image (image sitemap extension).
 *
 * Every document is cached per organization content version until the next scheduled change.
 *
 * E12b: with Bangla on, every `<url>` lists its language versions as
 * `<xhtml:link rel="alternate" hreflang="en|bn|x-default">` — `<loc>` and x-default are the
 * default language's URL, the other language adds `?lang=`.
 */
class StorefrontSitemap
{
    private const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

    private const IMAGE_NS = 'http://www.google.com/schemas/sitemap-image/1.1';

    private const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly PageDirectory $pages,
        private readonly BlogDirectory $blog,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly ContentSchedule $schedule,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * The XML of a sitemap file (`sitemap` = the index, `pages`, `products-1`, …), or null
     * when there is no such file.
     *
     * @param  string  $base  scheme and primary host, e.g. https://shop.example.com
     */
    public function document(string $name, string $base): ?string
    {
        if (! in_array($name, ['sitemap', 'pages', 'categories', 'brands', 'blog'], true) && preg_match('/^products-[1-9][0-9]{0,4}$/', $name) !== 1) {
            return null;
        }

        return $this->version->remember(
            $this->tenant->requireOrganization(),
            'sitemap:'.$name.':'.$base,
            fn () => $this->build($name, $base),
            fn () => $this->schedule->nextChange(),
        );
    }

    private function build(string $name, string $base): ?string
    {
        if ($name === 'sitemap') {
            return $this->index($base);
        }
        if (str_starts_with($name, 'products-')) {
            $chunk = (int) substr($name, 9);
            $chunks = array_chunk($this->catalog->sitemapEntries('product'), $this->perFile());
            if (! isset($chunks[$chunk - 1])) {
                return null;
            }

            return $this->urlset(array_map(fn (array $p) => [
                'loc' => $base.'/product/'.$p['slug'],
                'lastmod' => $p['updated_at'],
                'image' => $p['image_url'] === null ? null : (str_starts_with($p['image_url'], '/') ? $base.$p['image_url'] : $p['image_url']),
            ], $chunks[$chunk - 1]), true);
        }

        return $this->urlset($this->entries($name, $base), false);
    }

    /**
     * @return list<array{loc: string, lastmod: ?DateTimeInterface}>
     */
    private function entries(string $name, string $base): array
    {
        return match ($name) {
            'pages' => [
                ['loc' => $base.'/', 'lastmod' => null],
                ['loc' => $base.'/shop', 'lastmod' => null],
                ['loc' => $base.'/blog', 'lastmod' => null],
                ...array_map(fn (array $p) => ['loc' => $base.'/pages/'.$p['slug'], 'lastmod' => $p['updated_at']], $this->pages->sitemapEntries()),
            ],
            'categories' => array_map(fn (array $c) => ['loc' => $base.'/category/'.$c['slug'], 'lastmod' => $c['updated_at']], $this->catalog->sitemapEntries('category')),
            'brands' => array_map(fn (array $b) => ['loc' => $base.'/brand/'.$b['slug'], 'lastmod' => $b['updated_at']], $this->catalog->sitemapEntries('brand')),
            'blog' => (function () use ($base) {
                $blog = $this->blog->sitemapEntries();

                return [
                    ...array_map(fn (array $c) => ['loc' => $base.'/blog/category/'.$c['slug'], 'lastmod' => $c['updated_at']], $blog['categories']),
                    ...array_map(fn (array $p) => ['loc' => $base.'/blog/'.$p['slug'], 'lastmod' => $p['updated_at']], $blog['posts']),
                ];
            })(),
        };
    }

    private function index(string $base): string
    {
        $products = $this->catalog->sitemapEntries('product');
        $children = ['pages' => $this->entries('pages', $base)];
        foreach (array_chunk($products, $this->perFile()) as $i => $chunk) {
            $children['products-'.($i + 1)] = array_map(fn (array $p) => ['lastmod' => $p['updated_at']], $chunk);
        }
        foreach (['categories', 'brands', 'blog'] as $name) {
            $children[$name] = $this->entries($name, $base);
        }

        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<sitemapindex xmlns="'.self::NS.'">'."\n";
        foreach ($children as $name => $entries) {
            $lastmod = $this->latest(array_column($entries, 'lastmod'));
            $xml .= '  <sitemap><loc>'.$this->e($base.'/sitemaps/'.$name.'.xml').'</loc>'
                .($lastmod === null ? '' : '<lastmod>'.$lastmod.'</lastmod>')."</sitemap>\n";
        }

        return $xml.'</sitemapindex>'."\n";
    }

    /**
     * @param  list<array{loc: string, lastmod: ?DateTimeInterface, image?: ?string}>  $entries
     */
    private function urlset(array $entries, bool $images): string
    {
        $languages = $this->locale->banglaEnabled() ? $this->locale->enabled() : [];
        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .'<urlset xmlns="'.self::NS.'"'.($images ? ' xmlns:image="'.self::IMAGE_NS.'"' : '').($languages !== [] ? ' xmlns:xhtml="'.self::XHTML_NS.'"' : '').">\n";
        foreach ($entries as $entry) {
            $xml .= '  <url><loc>'.$this->e($entry['loc']).'</loc>';
            if ($entry['lastmod'] !== null) {
                $xml .= '<lastmod>'.$this->w3c($entry['lastmod']).'</lastmod>';
            }
            if (! empty($entry['image'])) {
                $xml .= '<image:image><image:loc>'.$this->e($entry['image']).'</image:loc></image:image>';
            }
            foreach ($languages !== [] ? [...$languages, 'x-default'] : [] as $code) {
                $href = $code === 'x-default' || $code === $this->locale->defaultLocale() ? $entry['loc'] : $entry['loc'].'?lang='.$code;
                $xml .= '<xhtml:link rel="alternate" hreflang="'.$code.'" href="'.$this->e($href).'"/>';
            }
            $xml .= "</url>\n";
        }

        return $xml.'</urlset>'."\n";
    }

    /**
     * @param  list<?DateTimeInterface>  $times
     */
    private function latest(array $times): ?string
    {
        $times = array_filter($times);
        if ($times === []) {
            return null;
        }

        return $this->w3c(CarbonImmutable::createFromTimestamp(max(array_map(fn (DateTimeInterface $t) => $t->getTimestamp(), $times))));
    }

    private function perFile(): int
    {
        return max(1, (int) config('storefront.sitemap_products_per_file', 5000));
    }

    private function w3c(DateTimeInterface $time): string
    {
        return CarbonImmutable::instance($time)->utc()->format('Y-m-d\TH:i:sP');
    }

    private function e(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
