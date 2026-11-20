<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;

/**
 * AI2b: what the shopper tools returned during one assistant turn — the only source of the
 * reply's product cards and links (the server never trusts URLs from the model's text).
 *
 * - products(): every live product a tool returned, keyed by lowercase slug;
 * - links(): own-store paths (always starting with a single "/") with their labels.
 *
 * Resolve a fresh instance per turn (not a singleton). `cardsForSlugs()` gives the same card
 * data for products named in earlier turns (live products only).
 */
class ShopperFindings
{
    /** @var array<string, array{slug: string, name: string, url: string, image_url: ?string, price_text: string, in_stock: bool}> */
    private array $products = [];

    /** @var array<string, string> path => label */
    private array $links = [];

    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
    ) {}

    public function product(string $slug, string $name, ?string $imageUrl, string $priceText, bool $inStock): void
    {
        $this->products[mb_strtolower($slug)] = [
            'slug' => $slug,
            'name' => $name,
            'url' => '/product/'.$slug,
            'image_url' => $imageUrl,
            'price_text' => $priceText,
            'in_stock' => $inStock,
        ];
    }

    /**
     * A catalog card or product page object (live product).
     *
     * @param  array<string, mixed>  $product
     */
    public function productFrom(array $product, string $currency): void
    {
        $image = $product['image']['url'] ?? ($product['images'][0]['url'] ?? null);
        $this->product((string) $product['slug'], (string) $product['name'], is_string($image) ? $image : null, ShopperText::price($product, $currency), (bool) ($product['in_stock'] ?? false));
    }

    public function link(string $label, string $path): void
    {
        if (self::isOwnPath($path)) {
            $this->links[$path] = mb_substr(trim($label), 0, 80);
        }
    }

    /**
     * @return array<string, array{slug: string, name: string, url: string, image_url: ?string, price_text: string, in_stock: bool}>
     */
    public function products(): array
    {
        return $this->products;
    }

    /**
     * @return array<string, string> path => label
     */
    public function links(): array
    {
        return $this->links;
    }

    /**
     * Card data of the live products among the slugs (case-insensitive), keyed by lowercase
     * slug; unknown, hidden and other stores' products are absent. Does not record them.
     *
     * @param  list<string>  $slugs
     * @return array<string, array{slug: string, name: string, url: string, image_url: ?string, price_text: string, in_stock: bool}>
     */
    public function cardsForSlugs(array $slugs): array
    {
        $ids = [];
        foreach (array_slice(array_values(array_unique(array_map(fn ($s) => mb_strtolower(trim((string) $s)), $slugs))), 0, 20) as $slug) {
            if ($slug !== '' && preg_match('/^[\p{L}\p{N}-]{1,200}$/u', $slug) === 1) {
                $id = $this->catalog->liveProductId($slug);
                if ($id !== null) {
                    $ids[] = $id;
                }
            }
        }
        if ($ids === []) {
            return [];
        }
        $currency = $this->currency();
        $result = [];
        foreach ($this->catalog->productCards($ids) as $card) {
            $result[mb_strtolower((string) $card['slug'])] = [
                'slug' => (string) $card['slug'],
                'name' => (string) $card['name'],
                'url' => '/product/'.$card['slug'],
                'image_url' => $card['image']['url'] ?? null,
                'price_text' => ShopperText::price($card, $currency),
                'in_stock' => (bool) $card['in_stock'],
            ];
        }

        return $result;
    }

    public function currency(): string
    {
        return (string) ($this->organizations->summary($this->tenant->requireOrganization())['base_currency'] ?? '');
    }

    public static function isOwnPath(string $path): bool
    {
        return preg_match('#^/(?![/\\\\])[A-Za-z0-9/_\-.%\p{L}\p{N}]*$#u', $path) === 1 && ! str_contains($path, '..');
    }
}
