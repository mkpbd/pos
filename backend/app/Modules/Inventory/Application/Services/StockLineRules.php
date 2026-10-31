<?php

namespace App\Modules\Inventory\Application\Services;

use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Validation\ValidationException;

/**
 * Checks document lines that move stock against product settings:
 * the variant exists and is usable, fractional quantities only for decimal units,
 * batch numbers exactly when the product tracks batches, and batches belong to the variant.
 * Used by adjustments, transfers, goods receipts and purchase returns.
 */
class StockLineRules
{
    public function __construct(private readonly ProductDirectory $products) {}

    /**
     * @param  list<array{variant_id: string, quantity: string, batch_id?: ?string, batch_number?: ?string}>  $lines
     * @param  'in'|'out'  $direction  inbound lines name a batch number (created if new); outbound lines pick an existing batch_id
     * @param  bool  $requireTracked  reject services/untracked products (true for pure stock documents)
     * @return array<string, array<string, mixed>> variant info keyed by variant id
     *
     * @throws ValidationException
     */
    public function validate(string $organizationId, array $lines, string $direction, bool $requireTracked = true, string $prefix = 'lines'): array
    {
        $variants = $this->products->variants($organizationId, array_column($lines, 'variant_id'));
        $errors = [];

        foreach ($lines as $i => $line) {
            $variant = $variants[$line['variant_id']] ?? null;
            $path = "{$prefix}.{$i}";

            if ($variant === null) {
                $errors["{$path}.variant_id"] = 'This product does not exist.';

                continue;
            }
            if ($requireTracked && ! $variant['track_stock']) {
                $errors["{$path}.variant_id"] = "{$variant['product_name']} does not track stock.";
            }
            if (! $variant['allow_decimal'] && ! Decimal::isWhole($line['quantity'])) {
                $errors["{$path}.quantity"] = "{$variant['product_name']} is sold in whole units ({$variant['unit_code']}).";
            }

            $batchId = $line['batch_id'] ?? null;
            $batchNumber = $line['batch_number'] ?? null;
            if (! $variant['track_batches']) {
                if ($batchId !== null || $batchNumber !== null) {
                    $errors["{$path}.batch_number"] = "{$variant['product_name']} does not track batches.";
                }
            } elseif ($direction === 'in' && blank($batchNumber) && $batchId === null) {
                $errors["{$path}.batch_number"] = "Enter the batch number for {$variant['product_name']}.";
            } elseif ($direction === 'out' && $batchId === null) {
                $errors["{$path}.batch_id"] = "Choose the batch of {$variant['product_name']}.";
            } elseif ($batchId !== null && ! Batch::query()->whereKey($batchId)->where('variant_id', $variant['variant_id'])->exists()) {
                $errors["{$path}.batch_id"] = 'This batch does not belong to the product.';
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages(array_map(fn (string $m) => [$m], $errors));
        }

        return $variants;
    }
}
