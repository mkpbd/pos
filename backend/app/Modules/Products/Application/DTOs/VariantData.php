<?php

namespace App\Modules\Products\Application\DTOs;

final readonly class VariantData
{
    /**
     * @param  array<string, string>  $optionValues  option name => value, e.g. ["Size" => "L"]
     * @param  list<string>  $barcodes
     */
    public function __construct(
        public ?string $id,
        public ?string $sku,
        public ?string $name,
        public array $optionValues,
        public string $purchasePrice,
        public string $sellingPrice,
        public ?string $wholesalePrice,
        public string $reorderLevel,
        public array $barcodes,
        public bool $isActive,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        $sku = isset($data['sku']) ? trim((string) $data['sku']) : '';

        return new self(
            id: $data['id'] ?? null,
            sku: $sku === '' ? null : $sku,
            name: isset($data['name']) && trim($data['name']) !== '' ? trim($data['name']) : null,
            optionValues: array_map('strval', $data['option_values'] ?? []),
            purchasePrice: (string) $data['purchase_price'],
            sellingPrice: (string) $data['selling_price'],
            wholesalePrice: isset($data['wholesale_price']) ? (string) $data['wholesale_price'] : null,
            reorderLevel: isset($data['reorder_level']) ? (string) $data['reorder_level'] : '0',
            barcodes: array_values(array_map('trim', $data['barcodes'] ?? [])),
            isActive: (bool) ($data['is_active'] ?? true),
        );
    }
}
