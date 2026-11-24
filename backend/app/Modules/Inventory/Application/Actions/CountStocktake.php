<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Inventory\Application\Services\StocktakeAccess;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StocktakeLine;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST1: counting a stocktake — several people at once.
 *
 * Every count snapshots the line's `system_quantity` = what the store holds at that moment,
 * read under a share lock on the stock row (a sale or receipt in flight finishes first). Setting
 * a count re-snapshots; a scan adds to the count atomically and snapshots only on the line's
 * first count. Products outside the scope found on the shelf become extra lines; clearing an
 * extra line's count removes it.
 */
class CountStocktake
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StocktakeAccess $access,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * Sets counted quantities (PUT lines).
     *
     * @param  list<array{variant_id: string, batch_id?: ?string, counted_quantity: string, note?: ?string}>  $lines
     * @return list<StocktakeLine>
     */
    public function set(TenantUser $actor, Stocktake $stocktake, array $lines): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $lines = array_values($lines);
        $this->validateLines($organizationId, $lines);

        return DB::transaction(function () use ($actor, $organizationId, $stocktake, $lines) {
            $locked = $this->access->lockForCounting($actor, $stocktake);
            $onHand = $this->snapshot($locked->store_id, $lines);
            $now = now();

            $saved = [];
            foreach ($lines as $line) {
                $batchId = $line['batch_id'] ?? null;
                $row = $this->lineFor($organizationId, $locked, $line['variant_id'], $batchId);
                $row->fill([
                    'counted_quantity' => Decimal::round((string) $line['counted_quantity'], 3),
                    'system_quantity' => $onHand[$this->key($line['variant_id'], $batchId)],
                    'counted_at' => $now,
                    'counted_by' => $actor->getAuthIdentifier(),
                ] + (array_key_exists('note', $line) ? ['note' => filled($line['note']) ? trim((string) $line['note']) : null] : []))->save();
                $saved[] = $row;
            }

            return $saved;
        });
    }

    /**
     * Adds a scanned quantity to the matching line.
     *
     * @throws BusinessRuleViolation UNKNOWN_BARCODE, BATCH_REQUIRED, NOT_STOCK_TRACKED, STOCKTAKE_NOT_COUNTING
     */
    public function scan(TenantUser $actor, Stocktake $stocktake, string $barcode, string $quantity = '1', ?string $batchId = null): StocktakeLine
    {
        $organizationId = $this->tenant->requireOrganization();
        $this->access->assertVisible($actor, $stocktake);
        $variantId = $this->products->variantIdByCode($organizationId, $barcode)
            ?? throw new BusinessRuleViolation('UNKNOWN_BARCODE', "No product has the barcode or SKU “{$barcode}”.", ['barcode' => $barcode]);
        $variant = $this->products->variants($organizationId, [$variantId])[$variantId];
        $summary = ['id' => $variantId, 'name' => $variant['variant_name'], 'sku' => $variant['sku'], 'product_name' => $variant['product_name']];

        if (! $variant['track_stock']) {
            throw new BusinessRuleViolation('NOT_STOCK_TRACKED', "{$variant['product_name']} does not track stock.", ['variant' => $summary]);
        }
        if (! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
            throw ValidationException::withMessages(['quantity' => ["{$variant['product_name']} is counted in whole units ({$variant['unit_code']})."]]);
        }
        if ($variant['track_batches'] && $batchId === null) {
            $batches = Batch::query()->where('variant_id', $variantId)->orderByRaw('expires_on IS NULL')->orderBy('expires_on')->orderBy('batch_number')
                ->get(['id', 'batch_number', 'expires_on'])
                ->map(fn (Batch $b) => ['id' => $b->id, 'number' => $b->batch_number, 'expires_on' => $b->expires_on?->toDateString()])->values()->all();

            throw new BusinessRuleViolation('BATCH_REQUIRED', "{$variant['product_name']} is counted per batch: choose the batch.", ['variant' => $summary, 'batches' => $batches]);
        }
        $this->assertBatch($variant, $batchId, 'batch_id');

        return DB::transaction(function () use ($actor, $organizationId, $stocktake, $variantId, $batchId, $quantity) {
            $locked = $this->access->lockForCounting($actor, $stocktake);
            $line = ['variant_id' => $variantId, 'batch_id' => $batchId];
            $system = $this->snapshot($locked->store_id, [$line])[$this->key($variantId, $batchId)];
            $row = $this->lineFor($organizationId, $locked, $variantId, $batchId);

            // One statement: concurrent scans of the same product add up; the snapshot is taken on the first count only.
            DB::update(
                'UPDATE stocktake_lines SET system_quantity = CASE WHEN counted_quantity IS NULL THEN ? ELSE system_quantity END,
                    counted_quantity = COALESCE(counted_quantity, 0) + ?, counted_at = ?, counted_by = ?, updated_at = ? WHERE id = ?',
                [$system, Decimal::round($quantity, 3), now(), $actor->getAuthIdentifier(), now(), $row->id],
            );

            return $row->refresh();
        });
    }

    /**
     * Clears a line's count; an extra line (found outside the scope) is removed. Returns null when removed.
     */
    public function clear(TenantUser $actor, Stocktake $stocktake, string $lineId): ?StocktakeLine
    {
        return DB::transaction(function () use ($actor, $stocktake, $lineId) {
            $locked = $this->access->lockForCounting($actor, $stocktake);
            /** @var StocktakeLine|null $line */
            $line = StocktakeLine::query()->where('stocktake_id', $locked->id)->whereKey($lineId)->lockForUpdate()->first();
            if ($line === null) {
                throw new NotFoundHttpException;
            }
            if ($line->is_extra) {
                $line->delete();

                return null;
            }
            $line->update(['counted_quantity' => null, 'system_quantity' => null, 'counted_at' => null, 'counted_by' => null]);

            return $line;
        });
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function validateLines(string $organizationId, array $lines): void
    {
        $variants = $this->products->variants($organizationId, array_values(array_unique(array_column($lines, 'variant_id'))));
        $errors = [];
        $seen = [];
        foreach ($lines as $i => $line) {
            $variant = $variants[$line['variant_id']] ?? null;
            $batchId = $line['batch_id'] ?? null;
            if ($variant === null) {
                $errors["lines.{$i}.variant_id"] = ['This product does not exist.'];

                continue;
            }
            if (! $variant['track_stock']) {
                $errors["lines.{$i}.variant_id"] = ["{$variant['product_name']} does not track stock."];

                continue;
            }
            if (! $variant['allow_decimal'] && ! Decimal::isWhole((string) $line['counted_quantity'])) {
                $errors["lines.{$i}.counted_quantity"] = ["{$variant['product_name']} is counted in whole units ({$variant['unit_code']})."];
            }
            if ($variant['track_batches'] && $batchId === null) {
                $errors["lines.{$i}.batch_id"] = ["{$variant['product_name']} is counted per batch: choose the batch you counted."];
            } else {
                try {
                    $this->assertBatch($variant, $batchId, "lines.{$i}.batch_id");
                } catch (ValidationException $e) {
                    $errors += $e->errors();
                }
            }
            $key = $this->key($line['variant_id'], $batchId);
            if (isset($seen[$key])) {
                $errors["lines.{$i}.variant_id"] = ['Each product (and batch) may appear only once.'];
            }
            $seen[$key] = true;
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * @param  array<string, mixed>  $variant
     */
    private function assertBatch(array $variant, ?string $batchId, string $field): void
    {
        if ($batchId === null) {
            return;
        }
        if (! $variant['track_batches']) {
            throw ValidationException::withMessages([$field => ["{$variant['product_name']} does not track batches."]]);
        }
        if (! Batch::query()->whereKey($batchId)->where('variant_id', $variant['variant_id'])->exists()) {
            throw ValidationException::withMessages([$field => ['This batch does not belong to the product.']]);
        }
    }

    /**
     * What the store holds of each line now, read under a share lock on the stock rows (in the
     * ledger's lock order). A product without a stock row holds zero.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, string> quantity (3 dp) by variant|batch key
     */
    private function snapshot(string $storeId, array $lines): array
    {
        $keys = [];
        foreach ($lines as $line) {
            $keys[$storeId.'|'.$this->key($line['variant_id'], $line['batch_id'] ?? null)] = [$line['variant_id'], $line['batch_id'] ?? null];
        }
        ksort($keys, SORT_STRING);

        $quantities = [];
        foreach ($keys as [$variantId, $batchId]) {
            $quantity = StockLevel::query()->where('store_id', $storeId)->where('variant_id', $variantId)
                ->when($batchId, fn ($q, $id) => $q->where('batch_id', $id), fn ($q) => $q->whereNull('batch_id'))
                ->sharedLock()
                ->value('quantity');
            $quantities[$this->key($variantId, $batchId)] = Decimal::round((string) ($quantity ?? '0'), 3);
        }

        return $quantities;
    }

    /**
     * The stocktake's line for the product × batch, created as an extra line when the product
     * was not in the scope (two counters finding it at once create it once).
     */
    private function lineFor(string $organizationId, Stocktake $stocktake, string $variantId, ?string $batchId): StocktakeLine
    {
        $find = fn () => StocktakeLine::query()->where('stocktake_id', $stocktake->id)->where('variant_id', $variantId)
            ->when($batchId, fn ($q, $id) => $q->where('batch_id', $id), fn ($q) => $q->whereNull('batch_id'))
            ->first();

        $line = $find();
        if ($line === null) {
            $now = now();
            StocktakeLine::query()->insertOrIgnore([
                'id' => (string) Str::uuid7(),
                'organization_id' => $organizationId,
                'stocktake_id' => $stocktake->id,
                'variant_id' => $variantId,
                'batch_id' => $batchId,
                'position' => (int) StocktakeLine::query()->where('stocktake_id', $stocktake->id)->max('position') + 1,
                'is_extra' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $line = $find() ?? throw new NotFoundHttpException;
        }

        return $line;
    }

    private function key(string $variantId, ?string $batchId): string
    {
        return mb_strtolower($variantId).'|'.($batchId ?? '');
    }
}
