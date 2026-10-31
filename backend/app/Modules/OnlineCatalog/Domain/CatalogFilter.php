<?php

namespace App\Modules\OnlineCatalog\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * The shopper's active filters. Within a facet the selected values are OR-ed, across
 * facets they are AND-ed. Attribute values compare case-insensitively.
 */
final readonly class CatalogFilter
{
    public const BRAND = 'brand';

    public const PRICE = 'price';

    public const IN_STOCK = 'in_stock';

    public const ON_SALE = 'on_sale';

    /** @var array<string, list<string>> attribute slug => lower-cased values */
    public array $attributes;

    /**
     * @param  list<string>  $brandIds  empty = any brand
     * @param  array<string, list<string>>  $attributes  attribute slug => selected values
     */
    public function __construct(
        public array $brandIds = [],
        public ?string $priceMin = null,
        public ?string $priceMax = null,
        array $attributes = [],
        public bool $inStock = false,
        public bool $onSale = false,
    ) {
        $normalized = [];
        foreach ($attributes as $slug => $values) {
            $values = array_values(array_unique(array_map(fn ($v) => mb_strtolower(trim((string) $v)), $values)));
            if ($values !== []) {
                $normalized[$slug] = $values;
            }
        }
        $this->attributes = $normalized;
    }

    public static function attributeKey(string $slug): string
    {
        return 'attr:'.$slug;
    }

    /**
     * Whether the item passes every filter except the one named by $except.
     */
    public function matches(CatalogItem $item, ?string $except = null): bool
    {
        if ($except !== self::BRAND && $this->brandIds !== [] && ! in_array($item->brandId, $this->brandIds, true)) {
            return false;
        }
        if ($except !== self::PRICE) {
            if ($this->priceMin !== null && Decimal::compare($item->price, $this->priceMin) < 0) {
                return false;
            }
            if ($this->priceMax !== null && Decimal::compare($item->price, $this->priceMax) > 0) {
                return false;
            }
        }
        if ($except !== self::IN_STOCK && $this->inStock && ! $item->inStock) {
            return false;
        }
        if ($except !== self::ON_SALE && $this->onSale && ! $item->onSale) {
            return false;
        }
        foreach ($this->attributes as $slug => $values) {
            if ($except === self::attributeKey($slug)) {
                continue;
            }
            if (array_intersect($values, array_keys($item->attributeValues[$slug] ?? [])) === []) {
                return false;
            }
        }

        return true;
    }
}
