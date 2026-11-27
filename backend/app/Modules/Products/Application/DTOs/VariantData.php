<?php

namespace App\Modules\Products\Application\DTOs;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

final readonly class VariantData
{
    /**
     * @param  array<string, string>  $optionValues  option name => value, e.g. ["Size" => "L"]
     * @param  list<string>  $barcodes  every code of the variant (unit and pack barcodes)
     * @param  array<string, array{units: string, pack_name: ?string}>  $packs  ST2c: barcodes sent as objects, by code
     * @param  list<array{min_quantity: string, price: string}>|null  $priceTiers  ST2c: null keeps the stored list
     * @param  list<array{branch_id: string, price: string}>|null  $branchPrices  ST2c: null keeps the stored list
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
        public array $packs = [],
        public ?array $priceTiers = null,
        public ?array $branchPrices = null,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public static function fromArray(array $data): self
    {
        $sku = isset($data['sku']) ? trim((string) $data['sku']) : '';

        // ST2c: a barcode is a code, or {barcode, units, pack_name} for a pack (carton, box).
        $barcodes = [];
        $packs = [];
        foreach ($data['barcodes'] ?? [] as $entry) {
            if (! is_array($entry)) {
                $barcodes[] = trim((string) $entry);

                continue;
            }
            $code = trim((string) ($entry['barcode'] ?? ''));
            $units = isset($entry['units']) ? Decimal::round((string) $entry['units'], 3) : '1.000';
            $name = isset($entry['pack_name']) ? trim((string) $entry['pack_name']) : '';
            $barcodes[] = $code;
            $packs[$code] = ['units' => $units, 'pack_name' => Decimal::compare($units, '1') > 0 && $name !== '' ? $name : null];
        }

        return new self(
            id: $data['id'] ?? null,
            sku: $sku === '' ? null : $sku,
            name: isset($data['name']) && trim($data['name']) !== '' ? trim($data['name']) : null,
            optionValues: array_map('strval', $data['option_values'] ?? []),
            purchasePrice: (string) $data['purchase_price'],
            sellingPrice: (string) $data['selling_price'],
            wholesalePrice: isset($data['wholesale_price']) ? (string) $data['wholesale_price'] : null,
            reorderLevel: isset($data['reorder_level']) ? (string) $data['reorder_level'] : '0',
            barcodes: $barcodes,
            isActive: (bool) ($data['is_active'] ?? true),
            packs: $packs,
            priceTiers: isset($data['price_tiers']) ? array_values(array_map(fn (array $t) => [
                'min_quantity' => Decimal::round((string) $t['min_quantity'], 3),
                'price' => Decimal::round((string) $t['price'], 2),
            ], $data['price_tiers'])) : null,
            branchPrices: isset($data['branch_prices']) ? array_values(array_map(fn (array $b) => [
                'branch_id' => strtolower((string) $b['branch_id']),
                'price' => Decimal::round((string) $b['price'], 2),
            ], $data['branch_prices'])) : null,
        );
    }
}
