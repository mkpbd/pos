<?php

namespace App\Modules\Inventory\Application\Imports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Imports\Application\Contracts\GroupedImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Application\Support\BaseImportHandler;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Domain\AdjustmentReason;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Validation\ValidationException;

/**
 * ST1: opening stock import. Rows name a product (SKU or barcode), a store (code or name), a
 * quantity above zero, an optional unit cost and — for batch-tracked products — the batch number
 * and expiry. All rows of one store are posted as ONE stock adjustment with reason `opening`
 * through PostStockAdjustment: movements of type `opening` that raise the stock row's weighted
 * average cost exactly like a goods receipt ((q·avg + in·cost) / (q + in); the product's purchase
 * price when the cost is blank), so stock valuation and later COGS include the opening stock.
 * A line the adjustment refuses is reported on its row and the store's adjustment is posted with
 * the other lines. ST2d: serial-numbered products list their serials (comma-separated) or are refused.
 */
final class OpeningStockImport extends BaseImportHandler implements GroupedImportHandler
{
    public function __construct(
        private readonly PostStockAdjustment $post,
        private readonly ProductDirectory $products,
        private readonly BranchDirectory $branches,
    ) {}

    public function type(): string
    {
        return 'opening_stock';
    }

    public function label(): string
    {
        return 'Opening stock';
    }

    public function permission(): string
    {
        return 'inventory.adjust';
    }

    public function columns(): array
    {
        return [
            new ImportColumn('sku_or_barcode', 'SKU or barcode', true, 'JUICE-250', 'The SKU or a barcode of an existing product.', maxLength: 128),
            new ImportColumn('store', 'Store', true, 'MAIN', 'Code or name of the store / warehouse the stock is in.', maxLength: 100),
            new ImportColumn('quantity', 'Quantity', true, '24', 'Quantity on hand (more than 0; whole numbers unless the unit allows decimals).', ColumnType::Decimal),
            new ImportColumn('unit_cost', 'Unit cost', false, '18.50', 'Cost per unit for stock valuation. Blank: the product\'s cost price.', ColumnType::Decimal),
            new ImportColumn('batch_number', 'Batch number', false, '', 'Required for batch-tracked products; leave blank otherwise.', maxLength: 100),
            new ImportColumn('expires_on', 'Expiry date', false, '', 'Batch expiry date (YYYY-MM-DD or an Excel date).', ColumnType::Date),
            // ST2d: serial-numbered products list one serial per unit.
            new ImportColumn('serials', 'Serial numbers', false, '', 'Required for serial-numbered products: one serial per unit, separated by commas. Leave blank otherwise.', maxLength: 20000),
        ];
    }

    public function keyOf(array $row): ?string
    {
        return self::fold($row['store']).'|'.self::fold($row['sku_or_barcode']).'|'.(self::fold($row['batch_number']) ?? '');
    }

    public function groupOf(array $row): string
    {
        $text = self::fold($row['store']);

        return 'store:'.($this->storeIds[$text] ?? $text);
    }

    /** @var array<string, string> store cell (folded) → store id, so "MAIN" and "Main store" are one adjustment */
    private array $storeIds = [];

    public function prepare(array $rows, ImportContext $context): void
    {
        $ids = [];
        foreach (array_unique(array_map(fn (array $r) => (string) $r['sku_or_barcode'], $rows)) as $code) {
            $ids[mb_strtolower($code)] = $this->products->variantIdByCode($context->organizationId, $code);
        }
        $context->put('opening.variant_ids', $ids);
        $context->put('opening.variants', $this->products->variants($context->organizationId, array_values(array_unique(array_filter($ids)))));
        $this->storeIds = [];
        foreach ($rows as $row) {
            if (($store = $this->store($row['store'], $context)) !== null) {
                $this->storeIds[(string) self::fold($row['store'])] = $store['id'];
            }
        }
    }

    public function validateRow(array $row, ImportContext $context): RowResult
    {
        $errors = new RowErrors;

        $store = $this->store($row['store'], $context);
        if ($store === null) {
            $errors->add('store', "Store {$row['store']} does not exist, is inactive or is not in your branches.");
        }

        $variantId = $context->remember('opening.variant_ids', fn () => [])[mb_strtolower((string) $row['sku_or_barcode'])] ?? null;
        $variant = $variantId === null ? null : ($context->remember('opening.variants', fn () => [])[$variantId] ?? null);
        if ($variant === null) {
            $errors->add('sku_or_barcode', "No product has the SKU or barcode {$row['sku_or_barcode']}.");

            return $errors->result();
        }
        $name = $variant['product_name'];
        if (! $variant['track_stock']) {
            $errors->add('sku_or_barcode', "{$name} does not track stock.");
        }

        $quantity = (string) $row['quantity'];
        if (Decimal::compare($quantity, '0') <= 0 || self::tooPrecise($quantity, 3)) {
            $errors->add('quantity', 'Enter a quantity above 0 with at most 3 decimals.');
        } elseif (! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
            $errors->add('quantity', "{$name} is counted in whole units ({$variant['unit_code']}).");
        }
        if ($row['unit_cost'] !== null && (Decimal::isNegative($row['unit_cost']) || self::tooPrecise($row['unit_cost'], 4))) {
            $errors->add('unit_cost', 'Enter a cost of 0 or more with at most 4 decimals.');
        }

        if ($variant['track_batches']) {
            if ($row['batch_number'] === null) {
                $errors->add('batch_number', "{$name} tracks batches: enter the batch number.");
            } elseif ($row['expires_on'] !== null) {
                $batch = Batch::query()->where('variant_id', $variantId)
                    ->whereRaw('lower(batch_number) = ?', [mb_strtolower(trim($row['batch_number']))])->first();
                if ($batch?->expires_on !== null && $batch->expires_on->toDateString() !== $row['expires_on']) {
                    $errors->add('expires_on', "Batch {$batch->batch_number} is recorded with expiry {$batch->expires_on->toDateString()}.");
                }
            }
        } elseif ($row['batch_number'] !== null || $row['expires_on'] !== null) {
            $errors->add('batch_number', "{$name} does not track batches: leave the batch and expiry blank.");
        }

        $serials = self::serials($row['serials'] ?? null);
        if ($variant['track_serials']) {
            if ($serials === []) {
                $errors->add('serials', "{$name} is serial-numbered: list one serial number per unit, separated by commas.");
            } elseif (Decimal::isWhole($quantity) && count($serials) !== (int) Decimal::round($quantity, 0)) {
                $errors->add('serials', 'Enter one serial number per unit ('.Decimal::round($quantity, 0).' needed, '.count($serials).' given).');
            } elseif (count(array_unique(array_map(mb_strtolower(...), $serials))) !== count($serials)) {
                $errors->add('serials', 'A serial number is listed twice.');
            }
        } elseif ($serials !== []) {
            $errors->add('serials', "{$name} does not track serial numbers: leave the serials blank.");
        }

        return $errors->any() ? $errors->result() : RowResult::create();
    }

    public function validateGroup(array $rows, ImportContext $context): array
    {
        return [];
    }

    public function importRow(array $row, ImportContext $context): RowResult
    {
        return $this->importGroup([$row['_row'] => $row], $context)[$row['_row']];
    }

    /**
     * One adjustment for the store. Lines the adjustment refuses (validation errors per line)
     * are taken out and reported; the rest is posted again.
     */
    public function importGroup(array $rows, ImportContext $context): array
    {
        $store = $this->store((string) reset($rows)['store'], $context)
            ?? throw ValidationException::withMessages(['store' => ['The store does not exist or is inactive.']]);

        $results = [];
        $pending = $rows;
        while ($pending !== []) {
            $numbers = array_keys($pending);
            $lines = [];
            foreach ($pending as $row) {
                $lines[] = array_filter([
                    'variant_id' => $context->remember('opening.variant_ids', fn () => [])[mb_strtolower((string) $row['sku_or_barcode'])] ?? '',
                    'quantity' => $row['quantity'],
                    'unit_cost' => $row['unit_cost'],
                    'batch_number' => $row['batch_number'],
                    'expires_on' => $row['expires_on'],
                    'serials' => self::serials($row['serials'] ?? null) ?: null,
                ], fn ($v) => $v !== null);
            }

            try {
                ($this->post)($context->user, [
                    'store_id' => $store['id'],
                    'reason' => AdjustmentReason::Opening->value,
                    'note' => 'Opening stock import',
                    'lines' => $lines,
                ]);
                foreach ($numbers as $number) {
                    $results[$number] = RowResult::create();
                }
                break;
            } catch (BusinessRuleViolation $e) {
                // ST2d: a serial already in stock is refused on the rows that list it.
                $taken = array_map(mb_strtolower(...), $e->details['serials'] ?? []);
                $refused = array_filter($pending, fn (array $row) => array_intersect(array_map(mb_strtolower(...), self::serials($row['serials'] ?? null)), $taken) !== []);
                if (! str_starts_with($e->errorCode, 'SERIAL_') || $refused === []) {
                    throw $e;
                }
                foreach (array_keys($refused) as $number) {
                    $results[$number] = RowResult::errors([['column' => 'serials', 'message' => $e->getMessage()]]);
                    unset($pending[$number]);
                }
            } catch (ValidationException $e) {
                $refused = [];
                foreach ($e->errors() as $field => $messages) {
                    if (preg_match('/^lines\.(\d+)\.(\w+)$/', $field, $m) !== 1 || ! isset($numbers[(int) $m[1]])) {
                        throw $e;
                    }
                    $column = match ($m[2]) {
                        'variant_id' => 'sku_or_barcode',
                        'batch_id' => 'batch_number',
                        default => $m[2],
                    };
                    $refused[$numbers[(int) $m[1]]][] = ['column' => $column, 'message' => $messages[0]];
                }
                foreach ($refused as $number => $errors) {
                    $results[$number] = RowResult::errors($errors);
                    unset($pending[$number]);
                }
            }
        }

        ksort($results);

        return $results;
    }

    /**
     * @return list<string> the comma-separated serials of a cell, trimmed
     */
    private static function serials(?string $cell): array
    {
        return array_values(array_filter(array_map(trim(...), explode(',', (string) $cell)), fn (string $s) => $s !== ''));
    }

    /**
     * Active store of an active branch the user may work in, by code or name.
     *
     * @return array{id: string, code: string, name: string, branch_id: string}|null
     */
    private function store(?string $text, ImportContext $context): ?array
    {
        $text = self::fold($text);
        if ($text === null) {
            return null;
        }
        $stores = $context->remember('opening.stores', fn () => $this->branches->activeStores($context->organizationId));
        $found = array_find($stores, fn (array $s) => mb_strtolower($s['code']) === $text)
            ?? array_find($stores, fn (array $s) => mb_strtolower($s['name']) === $text);

        return $found !== null && $context->user->canAccessBranch($found['branch_id']) ? $found : null;
    }
}
