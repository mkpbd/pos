<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * schema.org JSON-LD documents the HTML shell writes (E12, ADR-008). Every URL is made
 * absolute against the request's scheme and host; documents are encoded so they can never
 * end their `<script>` element early. E12b: creative works (WebSite, CollectionPage,
 * BlogPosting) carry the page's `inLanguage`.
 */
final class StructuredData
{
    private const CONTEXT = 'https://schema.org';

    /**
     * @param  ?string  $language  BCP 47 language of the page (`en`, `bn`; E12b) for `inLanguage`
     */
    public function __construct(private readonly string $base, private readonly ?string $language = null) {}

    /**
     * `<script type="application/ld+json">` elements for the documents.
     *
     * @param  list<array<string, mixed>>  $documents
     */
    public static function scripts(array $documents): string
    {
        return implode("\n    ", array_map(
            fn (array $doc) => '<script type="application/ld+json">'.json_encode($doc, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR).'</script>',
            $documents,
        ));
    }

    public function absolute(?string $url): ?string
    {
        if ($url === null || $url === '') {
            return null;
        }

        return preg_match('#^https?://#i', $url) === 1 ? $url : $this->base.'/'.ltrim($url, '/');
    }

    /**
     * The store as an `Organization`: name, home URL, logo and contact details when set.
     *
     * @param  array{email?: ?string, phone?: ?string}  $contact
     * @return array<string, mixed>
     */
    public function organization(string $name, ?string $logoUrl, array $contact): array
    {
        $doc = ['@context' => self::CONTEXT, '@type' => 'Organization', 'name' => $name, 'url' => $this->base.'/'];
        if (($logo = $this->absolute($logoUrl)) !== null) {
            $doc['logo'] = $logo;
        }
        $point = array_filter([
            'telephone' => $contact['phone'] ?? null,
            'email' => $contact['email'] ?? null,
        ], fn ($v) => is_string($v) && $v !== '');
        if ($point !== []) {
            $doc['contactPoint'] = ['@type' => 'ContactPoint', 'contactType' => 'customer service', ...$point];
        }

        return $doc;
    }

    /**
     * The homepage's `WebSite` with the search action of /search.
     *
     * @return array<string, mixed>
     */
    public function website(string $name): array
    {
        return [
            '@context' => self::CONTEXT,
            '@type' => 'WebSite',
            'name' => $name,
            'url' => $this->base.'/',
            ...($this->language === null ? [] : ['inLanguage' => $this->language]),
            'potentialAction' => [
                '@type' => 'SearchAction',
                'target' => ['@type' => 'EntryPoint', 'urlTemplate' => $this->base.'/search?q={search_term_string}'],
                'query-input' => 'required name=search_term_string',
            ],
        ];
    }

    /**
     * @param  list<array{name: string, url: string}>  $crumbs  site-relative URLs, Home first
     * @return array<string, mixed>
     */
    public function breadcrumbs(array $crumbs): array
    {
        return [
            '@context' => self::CONTEXT,
            '@type' => 'BreadcrumbList',
            'itemListElement' => array_map(fn (array $crumb, int $i) => [
                '@type' => 'ListItem',
                'position' => $i + 1,
                'name' => $crumb['name'],
                'item' => $this->absolute($crumb['url']),
            ], $crumbs, array_keys($crumbs)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function collectionPage(string $name, ?string $description, string $url): array
    {
        return array_filter([
            '@context' => self::CONTEXT,
            '@type' => 'CollectionPage',
            'name' => $name,
            'description' => $description,
            'url' => $this->absolute($url),
            'inLanguage' => $this->language,
        ], fn ($v) => $v !== null);
    }

    /**
     * A `Product` with one `Offer` (single variant) or an `AggregateOffer` over the variants.
     *
     * @param  array{name: string, url: string, description: ?string, sku: ?string, images: list<string>, brand: ?string, offers: list<array{sku: string, name: string, price: string, price_valid_until: ?string, availability: string}>, rating: array{average: string, count: int}|null}  $product
     * @return array<string, mixed>
     */
    public function product(array $product, string $currency): array
    {
        $url = $this->absolute($product['url']);
        $doc = ['@context' => self::CONTEXT, '@type' => 'Product', 'name' => $product['name'], 'url' => $url];
        if ($product['description'] !== null) {
            $doc['description'] = $product['description'];
        }
        if ($product['sku'] !== null) {
            $doc['sku'] = $product['sku'];
        }
        if ($product['images'] !== []) {
            $doc['image'] = array_map(fn (string $u) => $this->absolute($u), $product['images']);
        }
        if ($product['brand'] !== null) {
            $doc['brand'] = ['@type' => 'Brand', 'name' => $product['brand']];
        }

        $offers = array_map(fn (array $o) => array_filter([
            '@type' => 'Offer',
            'sku' => $o['sku'],
            'name' => count($product['offers']) > 1 ? $o['name'] : null,
            'price' => $o['price'],
            'priceCurrency' => $currency,
            'priceValidUntil' => $o['price_valid_until'],
            'availability' => 'https://schema.org/'.$o['availability'],
            'url' => $url,
        ], fn ($v) => $v !== null), $product['offers']);

        if (count($offers) === 1) {
            $doc['offers'] = $offers[0];
        } elseif ($offers !== []) {
            $prices = array_column($product['offers'], 'price');
            usort($prices, fn (string $a, string $b) => Decimal::compare($a, $b));
            $doc['offers'] = [
                '@type' => 'AggregateOffer',
                'lowPrice' => $prices[0],
                'highPrice' => $prices[count($prices) - 1],
                'offerCount' => count($offers),
                'priceCurrency' => $currency,
                'offers' => $offers,
            ];
        }

        if ($product['rating'] !== null && $product['rating']['count'] >= 1) {
            $doc['aggregateRating'] = [
                '@type' => 'AggregateRating',
                'ratingValue' => $product['rating']['average'],
                'reviewCount' => $product['rating']['count'],
                'bestRating' => 5,
                'worstRating' => 1,
            ];
        }

        return $doc;
    }

    /**
     * @param  array{title: string, description: ?string, image_url: ?string, published_at: ?string, updated_at: ?string, author: ?string}  $post
     * @param  array<string, mixed>  $publisher  the store's Organization document
     * @return array<string, mixed>
     */
    public function blogPosting(array $post, string $url, array $publisher): array
    {
        unset($publisher['@context'], $publisher['contactPoint']);

        return array_filter([
            '@context' => self::CONTEXT,
            '@type' => 'BlogPosting',
            'headline' => mb_substr($post['title'], 0, 110),
            'description' => $post['description'],
            'image' => $this->absolute($post['image_url']),
            'datePublished' => $post['published_at'],
            'dateModified' => $post['updated_at'] ?? $post['published_at'],
            'author' => $post['author'] === null ? null : ['@type' => 'Person', 'name' => $post['author']],
            'publisher' => $publisher,
            'mainEntityOfPage' => ['@type' => 'WebPage', '@id' => $url],
            'inLanguage' => $this->language,
        ], fn ($v) => $v !== null);
    }
}
