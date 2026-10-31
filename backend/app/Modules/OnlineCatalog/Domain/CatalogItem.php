<?php

namespace App\Modules\OnlineCatalog\Domain;

/**
 * A live product as the listing engine sees it: what it can be filtered, faceted and
 * sorted by. Built by the read model; pure data otherwise.
 */
final readonly class CatalogItem
{
    /**
     * @param  array<string, array<string, string>>  $attributeValues  attribute slug => lower-cased value => display value
     */
    public function __construct(
        public string $id,
        public string $name,
        public ?string $brandId,
        public ?string $categoryId,
        public string $price,
        public bool $onSale,
        public bool $inStock,
        public bool $isFeatured,
        public int $sortWeight,
        /** ISO-8601 instant the product went live (for "latest"), comparable as a string. */
        public string $publishedAt,
        public string $unitsSold30d,
        public string $unitsSoldTotal,
        public array $attributeValues = [],
    ) {}
}
