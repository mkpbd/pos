<?php

namespace App\Modules\Promotions\Application\Queries;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * How a promotion performed (E10b): its redemptions in a date range (calendar days in the
 * organization's timezone, by redemption time = order placement), the orders they belong to,
 * the discount given and those orders' totals, plus a per-day breakdown.
 *
 * Order totals and statuses are read from the `orders` table read-only (organization-scoped),
 * the read-model exception of ARCHITECTURE §2 — Promotions does not depend on Orders.
 * Redemptions of orders cancelled later stay counted (like the list counts); `cancelled_orders`
 * says how many of the orders were cancelled or failed.
 */
class PromotionReport
{
    /** At most this many days are listed one by one when a range is given. */
    public const MAX_DAYS = 366;

    public function __construct(private readonly OrganizationDirectory $organizations) {}

    /**
     * @return array{date_from: ?string, date_to: ?string, timezone: string, currency: string, redemptions: int, orders: int, cancelled_orders: int, discount_total: string, order_revenue: string, average_discount: string, by_day: list<array{date: string, redemptions: int, discount: string}>}
     */
    public function for(Promotion $promotion, ?string $dateFrom, ?string $dateTo): array
    {
        $summary = $this->organizations->summary($promotion->organization_id) ?? [];
        $timezone = $summary['timezone'] ?? (string) config('app.timezone');
        $currency = $summary['base_currency'] ?? (string) config('pos.default_currency');
        $start = $dateFrom === null ? null : CarbonImmutable::parse($dateFrom, $timezone)->startOfDay();
        $end = $dateTo === null ? null : CarbonImmutable::parse($dateTo, $timezone)->startOfDay()->addDay();

        $rows = PromotionRedemption::query()->where('promotion_id', $promotion->id)
            ->when($start !== null, fn ($q) => $q->where('created_at', '>=', $start->utc()))
            ->when($end !== null, fn ($q) => $q->where('created_at', '<', $end->utc()))
            ->orderBy('created_at')
            ->get(['order_id', 'amount', 'created_at']);

        $orderIds = $rows->pluck('order_id')->unique()->values()->all();
        $orders = [];
        foreach (array_chunk($orderIds, 500) as $chunk) {
            foreach (DB::table('orders')->where('organization_id', $promotion->organization_id)->whereIn('id', $chunk)->get(['id', 'total', 'status']) as $order) {
                $orders[$order->id] = $order;
            }
        }

        $discount = Money::zero($currency);
        $days = [];
        foreach ($rows as $row) {
            $amount = Money::of((string) $row->amount, $currency);
            $discount = $discount->plus($amount);
            $day = CarbonImmutable::parse($row->created_at)->setTimezone($timezone)->toDateString();
            $days[$day] ??= ['redemptions' => 0, 'discount' => Money::zero($currency)];
            $days[$day]['redemptions']++;
            $days[$day]['discount'] = $days[$day]['discount']->plus($amount);
        }

        $revenue = Money::zero($currency);
        $cancelled = 0;
        foreach ($orders as $order) {
            $revenue = $revenue->plus(Money::of((string) $order->total, $currency));
            if (in_array($order->status, ['cancelled', 'failed'], true)) {
                $cancelled++;
            }
        }

        // With a full range every day is listed (zeros included); otherwise only active days.
        if ($start !== null && $end !== null) {
            for ($d = $start; $d->lessThan($end); $d = $d->addDay()) {
                $days[$d->toDateString()] ??= ['redemptions' => 0, 'discount' => Money::zero($currency)];
            }
        }
        ksort($days);

        $count = $rows->count();

        return [
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'timezone' => $timezone,
            'currency' => $currency,
            'redemptions' => $count,
            'orders' => count($orderIds),
            'cancelled_orders' => $cancelled,
            'discount_total' => $discount->amount(),
            'order_revenue' => $revenue->amount(),
            'average_discount' => $count === 0 ? Money::zero($currency)->amount() : Decimal::div($discount->amount(), (string) $count, 2),
            'by_day' => array_map(
                fn (string $date, array $d) => ['date' => $date, 'redemptions' => $d['redemptions'], 'discount' => $d['discount']->amount()],
                array_keys($days),
                array_values($days),
            ),
        ];
    }
}
