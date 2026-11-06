<?php

namespace App\Modules\Inventory\Infrastructure\Replenishment;

use App\Modules\Inventory\Application\Contracts\ReplenishmentData;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Models\ReplenishmentSettings;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
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
        $only = fn (Builder $q, string $column) => $variantIds === null ? $q : $q->whereIn($column, $variantIds);
        if ($variantIds === []) {
            return [];
        }

        $rules = $only(DB::table('stock_reorder_rules')->where('organization_id', $organizationId)->where('store_id', $storeId)->where('is_active', true), 'variant_id')
            ->get(['variant_id', 'min_qty', 'max_qty'])->keyBy('variant_id');
        $onHand = $only(DB::table('stock_levels')->where('organization_id', $organizationId)->where('store_id', $storeId), 'variant_id')
            ->groupBy('variant_id')->selectRaw('variant_id, SUM(quantity) as total')->pluck('total', 'variant_id');
        $inTransit = $only(DB::table('stock_transfer_lines as l')
            ->join('stock_transfers as t', 't.id', '=', 'l.stock_transfer_id')
            ->where('t.organization_id', $organizationId)
            ->where('t.to_store_id', $storeId)
            ->where('t.status', TransferStatus::InTransit->value), 'l.variant_id')
            ->groupBy('l.variant_id')->selectRaw('l.variant_id as variant_id, SUM(l.quantity) as total')->pluck('total', 'variant_id');
        $sold = $only(DB::table('stock_movements')
            ->where('organization_id', $organizationId)
            ->where('store_id', $storeId)
            ->whereIn('type', array_map(fn (MovementType $t) => $t->value, self::SALES_TYPES))
            ->where('created_at', '>=', $since), 'variant_id')
            ->groupBy('variant_id')->selectRaw('variant_id, SUM(quantity) as total')->pluck('total', 'variant_id');

        $levels = DB::table('product_variants')->where('organization_id', $organizationId);
        $levels = $variantIds === null
            ? $levels->where(fn (Builder $q) => $q->where('reorder_level', '>', 0)->orWhereIn('id', $rules->keys()->merge($sold->keys())->merge($onHand->keys())->unique()->values()->all()))
            : $levels->whereIn('id', $variantIds);
        $reorderLevels = $levels->pluck('reorder_level', 'id');

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
