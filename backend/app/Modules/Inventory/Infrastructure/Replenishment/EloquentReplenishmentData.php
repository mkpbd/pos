<?php

namespace App\Modules\Inventory\Infrastructure\Replenishment;

use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Models\ReplenishmentSettings;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Persistence\WhereInChunks;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Aggregates over the module's own tables. The variant reorder level (the fallback rule) is
 * read from product_variants read-only, like the stock list's low-stock filter.
 */
class EloquentReplenishmentData implements ReplenishmentData
{
    /** Movements that count as units sold (outbound) or given back (inbound). */
    public const SALES_TYPES = [
        MovementType::Sale, MovementType::OnlineOrder,
        MovementType::SaleCancellation, MovementType::OnlineOrderCancel, MovementType::SaleReturn, MovementType::OnlineReturn,
    ];

    public function settings(string $organizationId): array
    {
        $row = ReplenishmentSettings::query()->withoutGlobalScope('organization')->where('organization_id', $organizationId)->first();

        return $row === null ? ReplenishmentSettings::DEFAULTS : [
            'source_store_id' => $row->source_store_id,
            'coverage_days' => $row->coverage_days,
            'velocity_days' => $row->velocity_days,
            'safety_days' => $row->safety_days,
        ];
    }

    public function storeInputs(string $organizationId, string $storeId, CarbonImmutable $since, ?array $variantIds = null): array
    {
        // G1c: variant lists are chunked (WhereInChunks): a store of a large organization stocks
        // more variants than PostgreSQL allows bound parameters in one statement.
        $fetch = fn (Builder $q, string $column) => $variantIds === null ? $q->get() : WhereInChunks::get($q, $column, $variantIds);
        if ($variantIds === []) {
            return [];
        }

        $rules = $fetch(DB::table('stock_reorder_rules')->where('organization_id', $organizationId)->where('store_id', $storeId)->where('is_active', true)
            ->select(['variant_id', 'min_qty', 'max_qty']), 'variant_id')->keyBy('variant_id');
        $onHand = $fetch(DB::table('stock_levels')->where('organization_id', $organizationId)->where('store_id', $storeId)
            ->groupBy('variant_id')->selectRaw('variant_id, SUM(quantity) as total'), 'variant_id')->pluck('total', 'variant_id');
        $inTransit = $fetch(DB::table('stock_transfer_lines as l')
            ->join('stock_transfers as t', 't.id', '=', 'l.stock_transfer_id')
            ->where('t.organization_id', $organizationId)
            ->where('t.to_store_id', $storeId)
            ->where('t.status', TransferStatus::InTransit->value)
            ->groupBy('l.variant_id')->selectRaw('l.variant_id as variant_id, SUM(l.quantity) as total'), 'l.variant_id')->pluck('total', 'variant_id');
        $sold = $fetch(DB::table('stock_movements')
            ->where('organization_id', $organizationId)
            ->where('store_id', $storeId)
            ->whereIn('type', array_map(fn (MovementType $t) => $t->value, self::SALES_TYPES))
            ->where('created_at', '>=', $since)
            ->groupBy('variant_id')->selectRaw('variant_id, SUM(quantity) as total'), 'variant_id')->pluck('total', 'variant_id');

        $levels = fn () => DB::table('product_variants')->where('organization_id', $organizationId)->select(['id', 'reorder_level']);
        if ($variantIds === null) {
            // Variants with a reorder level, plus those with a rule, sales or stock in the store.
            $reorderLevels = $levels()->where('reorder_level', '>', 0)->pluck('reorder_level', 'id');
            $others = $rules->keys()->merge($sold->keys())->merge($onHand->keys())->unique()->reject(fn ($id) => $reorderLevels->has($id))->values()->all();
            foreach (WhereInChunks::get($levels(), 'id', $others) as $row) {
                $reorderLevels->put($row->id, $row->reorder_level);
            }
        } else {
            $reorderLevels = WhereInChunks::get($levels(), 'id', $variantIds)->pluck('reorder_level', 'id');
        }

        $candidates = $variantIds ?? collect($reorderLevels)->filter(fn ($level) => Decimal::compare(self::q($level), '0') > 0)->keys()
            ->merge($rules->keys())
            ->merge($sold->keys())
            ->merge($onHand->filter(fn ($q) => Decimal::isNegative(self::q($q)))->keys())
            ->unique()->values()->all();

        $inputs = [];
        foreach ($candidates as $variantId) {
            if (! $reorderLevels->has($variantId)) {
                continue; // not a variant of this organization
            }
            $rule = $rules->get($variantId);
            $net = Decimal::negate(self::q($sold->get($variantId)), 3);
            $inputs[$variantId] = [
                'on_hand' => self::q($onHand->get($variantId)),
                'in_transit' => self::q($inTransit->get($variantId)),
                'sold' => Decimal::isNegative($net) ? '0.000' : $net,
                'min_qty' => self::q($rule !== null ? $rule->min_qty : $reorderLevels->get($variantId)),
                'max_qty' => $rule !== null && $rule->max_qty !== null ? self::q($rule->max_qty) : null,
                'has_rule' => $rule !== null,
            ];
        }

        return $inputs;
    }

    private static function q(mixed $value): string
    {
        return Decimal::round($value === null ? '0' : self::plain((string) $value), 3);
    }

    /** Normalizes driver output (SQLite may return floats such as "1.0E-3" or ints). */
    private static function plain(string $value): string
    {
        return is_numeric($value) && preg_match('/[eE]/', $value) ? number_format((float) $value, 6, '.', '') : $value;
    }
}
