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
     * @param  bool  $checkBatches  false for documents that do not move stock yet (purchase orders)
     * @param  bool  $requireSellable  reject archived or inactive products (new purchases)
     * @return array<string, array<string, mixed>> variant info keyed by variant id
     *
     * @throws ValidationException
     */
    public function validate(string $organizationId, array $lines, string $direction, bool $requireTracked = true, string $prefix = 'lines', bool $checkBatches = true, bool $requireSellable = false): array
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
            if ($requireSellable && ! $variant['sellable']) {
                $errors["{$path}.variant_id"] = "{$variant['product_name']} is archived or inactive.";
            }
            if ($requireTracked && ! $variant['track_stock']) {
                $errors["{$path}.variant_id"] = "{$variant['product_name']} does not track stock.";
            }
            if (! $variant['allow_decimal'] && ! Decimal::isWhole($line['quantity'])) {
                $errors["{$path}.quantity"] = "{$variant['product_name']} is sold in whole units ({$variant['unit_code']}).";
            }

            if (! $checkBatches) {
                continue;
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

    /**
     * ST2d: serial numbers on document lines. Lines of serial-tracked variants need one serial per
     * unit (count = |quantity|), each serial once per variant in the document; other lines none.
     *
     * @param  array<int, array{variant_id: string, quantity: string, serials?: mixed}>  $lines
     * @param  array<string, array<string, mixed>>  $variants  variant info keyed by id (from validate())
     * @return array<int, list<string>> trimmed serials of the serial-tracked lines, by line index
     *
     * @throws ValidationException
     */
    public function serials(array $lines, array $variants, string $prefix = 'lines'): array
    {
        $errors = [];
        $result = [];
        $seen = [];
        foreach ($lines as $i => $line) {
            $variant = $variants[$line['variant_id']] ?? null;
            $given = array_values(array_filter(array_map(fn ($s) => trim((string) $s), (array) ($line['serials'] ?? [])), fn (string $s) => $s !== ''));
            $path = "{$prefix}.{$i}.serials";
            if ($variant === null || ! $variant['track_serials']) {
                if ($given !== []) {
                    $errors[$path] = [($variant['product_name'] ?? 'This product').' does not track serial numbers.'];
                }

                continue;
            }

            $quantity = Decimal::round(ltrim((string) $line['quantity'], '-'), 3);
            if (! Decimal::isWhole($quantity) || count($given) !== (int) Decimal::round($quantity, 0)) {
                $errors[$path] = ["Enter one serial number per unit of {$variant['product_name']} (".Decimal::round($quantity, 0).' needed, '.count($given).' given).'];

                continue;
            }
            foreach ($given as $serial) {
                $key = $line['variant_id'].'|'.mb_strtolower($serial);
                if (isset($seen[$key])) {
                    $errors[$path] = ["Serial {$serial} is entered twice."];
                }
                if (mb_strlen($serial) > 100) {
                    $errors[$path] = ['A serial number has at most 100 characters.'];
                }
                $seen[$key] = true;
            }
            $result[$i] = $given;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $result;
    }
}
