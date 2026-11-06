<?php

namespace App\Modules\Purchasing\Domain\Reorder;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use InvalidArgumentException;

/**
 * Reorder suggestions (SC1) — pure: no database, no clock.
 *
 *   avg_daily     = sold / velocity_days
 *   reorder_point = max(min_qty, ceil(avg_daily x (lead_time + safety_days)))
 *   target        = max_qty ?? reorder_point + ceil(avg_daily x coverage_days)
 *   available     = on_hand + on_order + in_transit
 *   needs reorder when available <= reorder_point; need = target - available (> 0),
 *   whole units rounded up.
 *   transfer      = min(need, source surplus) (whole units rounded down) when a source can spare stock
 *   purchase      = need - transfer, raised to min_order_qty, rounded up to whole packs
 *                   (the default pack is 1, so purchases of decimal-unit products are whole
 *                   base units unless the pack is e.g. 2.5 kg; whole-unit products always whole)
 *   reason        = below_min when available <= min_qty, else velocity
 *   days_of_cover = on_hand / avg_daily (null when nothing sold)
 *
 * `ceil` rounds up to whole units for every product (a reorder point of 2.4 kg becomes 3).
 */
final class ReorderCalculator
{
    private const SCALE = 9;

    public static function calculate(ReorderInput $in): ReorderSuggestion
    {
        if ($in->velocityDays < 1) {
            throw new InvalidArgumentException('Velocity days must be at least 1.');
        }
        if (Decimal::compare($in->packSize, '0') <= 0) {
            throw new InvalidArgumentException('Pack size must be positive.');
        }

        $sold = Decimal::max(Decimal::round($in->sold, 3), '0');
        $reorderPoint = self::reorderPoint($sold, $in->velocityDays, $in->minQty, $in->leadTimeDays, $in->safetyDays);
        $target = $in->maxQty !== null
            ? Decimal::round($in->maxQty, 3)
            : Decimal::add($reorderPoint, self::daysOfSales($sold, $in->velocityDays, $in->coverageDays), 3);
        $available = Decimal::add(Decimal::add($in->onHand, $in->onOrder, 3), $in->inTransit, 3);
        $needsReorder = Decimal::compare($available, $reorderPoint) <= 0;

        $transfer = '0.000';
        $purchase = '0.000';
        $need = Decimal::sub($target, $available, 3);
        if ($needsReorder && Decimal::compare($need, '0') > 0) {
            if ($in->wholeUnits) {
                $need = Decimal::round(Decimal::ceil($need), 3);
            }
            if ($in->sourceSurplus !== null && Decimal::compare($in->sourceSurplus, '0') > 0) {
                $transfer = Decimal::min($need, Decimal::round($in->sourceSurplus, 3));
                if ($in->wholeUnits) {
                    $transfer = Decimal::round(Decimal::floor($transfer), 3);
                }
            }
            $remainder = Decimal::sub($need, $transfer, 3);
            if (Decimal::compare($remainder, '0') > 0) {
                $purchase = self::orderQuantity($remainder, $in->packSize, $in->minOrderQty, $in->wholeUnits);
            }
        }

        $avgDaily = Decimal::div($sold, (string) $in->velocityDays, self::SCALE);

        return new ReorderSuggestion(
            avgDaily: Decimal::round($avgDaily, 3),
            reorderPoint: $reorderPoint,
            target: $target,
            available: $available,
            needsReorder: $needsReorder,
            suggestedTransfer: $transfer,
            suggestedPurchase: $purchase,
            reason: $needsReorder ? (Decimal::compare($available, $in->minQty) <= 0 ? ReorderReason::BelowMin : ReorderReason::Velocity) : null,
            daysOfCover: Decimal::isZero($sold) ? null
                : Decimal::max(Decimal::div(Decimal::mul($in->onHand, (string) $in->velocityDays, 3), $sold, 1), '0.0'),
        );
    }

    /**
     * max(min_qty, ceil(avg_daily x (lead + safety))); also used for the source store.
     */
    public static function reorderPoint(string $sold, int $velocityDays, string $minQty, int $leadTimeDays, int $safetyDays): string
    {
        return Decimal::max(Decimal::round($minQty, 3), self::daysOfSales($sold, $velocityDays, $leadTimeDays + $safetyDays));
    }

    /**
     * What a store can give away: on hand above its own reorder point (whole units rounded down).
     */
    public static function surplus(string $onHand, string $reorderPoint, bool $wholeUnits): string
    {
        $surplus = Decimal::max(Decimal::sub($onHand, $reorderPoint, 3), '0.000');

        return $wholeUnits ? Decimal::round(Decimal::floor($surplus), 3) : $surplus;
    }

    /**
     * A purchase quantity: at least the minimum order, in whole packs.
     */
    public static function orderQuantity(string $quantity, string $packSize, ?string $minOrderQty, bool $wholeUnits): string
    {
        $quantity = $minOrderQty !== null ? Decimal::max($quantity, $minOrderQty) : $quantity;
        $packs = Decimal::ceil(Decimal::div($quantity, $packSize, self::SCALE));
        $quantity = Decimal::mul($packs, $packSize, 3);

        return $wholeUnits ? Decimal::round(Decimal::ceil($quantity), 3) : $quantity;
    }

    /** ceil(sold / velocity_days x days), exact: computed as ceil(sold x days / velocity_days). */
    private static function daysOfSales(string $sold, int $velocityDays, int $days): string
    {
        if (Decimal::isZero($sold) || $days <= 0) {
            return '0.000';
        }

        return Decimal::round(Decimal::ceil(Decimal::div(Decimal::mul($sold, (string) $days, 3), (string) $velocityDays, self::SCALE)), 3);
    }
}
