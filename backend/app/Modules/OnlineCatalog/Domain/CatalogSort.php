<?php

namespace App\Modules\OnlineCatalog\Domain;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * Listing orders. Every order ends with name and id, so pages are stable.
 */
enum CatalogSort: string
{
    case Featured = 'featured';
    case Popularity = 'popularity';
    case Latest = 'latest';
    case PriceAsc = 'price_asc';
    case PriceDesc = 'price_desc';
    case Name = 'name';

    /**
     * @param  list<CatalogItem>  $items
     * @return list<CatalogItem>
     */
    public function sort(array $items): array
    {
        usort($items, fn (CatalogItem $a, CatalogItem $b) => $this->compare($a, $b) ?: self::byName($a, $b));

        return $items;
    }

    private function compare(CatalogItem $a, CatalogItem $b): int
    {
        return match ($this) {
            self::Featured => self::featured($a, $b),
            self::Popularity => Decimal::compare($b->unitsSold30d, $a->unitsSold30d)
                ?: Decimal::compare($b->unitsSoldTotal, $a->unitsSoldTotal)
                ?: self::featured($a, $b),
            self::Latest => strcmp($b->publishedAt, $a->publishedAt),
            self::PriceAsc => Decimal::compare($a->price, $b->price),
            self::PriceDesc => Decimal::compare($b->price, $a->price),
            self::Name => 0,
        };
    }

    private static function featured(CatalogItem $a, CatalogItem $b): int
    {
        return ($b->isFeatured <=> $a->isFeatured)
            ?: ($b->sortWeight <=> $a->sortWeight)
            ?: strcmp($b->publishedAt, $a->publishedAt);
    }

    private static function byName(CatalogItem $a, CatalogItem $b): int
    {
        return strcmp(mb_strtolower($a->name), mb_strtolower($b->name)) ?: strcmp($a->id, $b->id);
    }
}
