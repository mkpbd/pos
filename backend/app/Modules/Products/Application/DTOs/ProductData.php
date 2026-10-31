<?php

namespace App\Modules\Products\Application\DTOs;

use App\Modules\Products\Domain\ProductType;

final readonly class ProductData
{
    /**
     * @param  list<array{name: string, values: list<string>}>|null  $options
     * @param  list<VariantData>  $variants
     */
    public function __construct(
        public string $name,
        public ?string $description,
        public ProductType $type,
        public ?string $categoryId,
        public ?string $brandId,
        public string $unitId,
        public ?string $taxRateId,
        public bool $trackStock,
        public bool $trackBatches,
        public bool $trackSerials,
        public ?string $maxDiscountPercent,
        public ?array $options,
        public bool $isActive,
        public array $variants,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        $type = ProductType::from($data['type'] ?? ProductType::Standard->value);
        $isService = $type === ProductType::Service;

        return new self(
            name: trim($data['name']),
            description: $data['description'] ?? null,
            type: $type,
            categoryId: $data['category_id'] ?? null,
            brandId: $data['brand_id'] ?? null,
            unitId: $data['unit_id'],
            taxRateId: $data['tax_rate_id'] ?? null,
            // Services are never stocked, whatever the client sends.
            trackStock: ! $isService && (bool) ($data['track_stock'] ?? true),
            trackBatches: ! $isService && (bool) ($data['track_batches'] ?? false),
            trackSerials: ! $isService && (bool) ($data['track_serials'] ?? false),
            maxDiscountPercent: isset($data['max_discount_percent']) ? (string) $data['max_discount_percent'] : null,
            options: empty($data['options']) ? null : array_map(
                fn (array $o) => ['name' => trim($o['name']), 'values' => array_values(array_map(fn ($v) => trim((string) $v), $o['values']))],
                $data['options'],
            ),
            isActive: (bool) ($data['is_active'] ?? true),
            variants: array_map(VariantData::fromArray(...), $data['variants']),
        );
    }
}
