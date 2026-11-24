<?php

namespace App\Modules\Orders\Application\Queries;

use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\BlockedPhone;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * BD1b: the delivery history of a mobile number in the organization — over the web orders
 * whose `contact_phone` is that number (stored normalised since E8a: checkout and order forms
 * validate 01XXXXXXXXX). Every order lands in exactly one bucket:
 *
 *   delivered    status `delivered`
 *   returned     its courier parcel came back to the sender (shipment `returned`; usually
 *                cancelled afterwards, still counted here and not under cancelled)
 *   cancelled    status `cancelled` (or `failed`) without a returned parcel
 *   in_progress  the rest (awaiting payment or confirmation, confirmed, processing, shipped)
 *
 * `success_rate` = round(100 × delivered / (delivered + returned)), null while both are 0.
 * `blocked` / `block_reason` from the organization's blocked numbers.
 */
class PhoneDeliveryReport
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  string  $phone  normalised mobile number
     * @return array{phone: string, orders: int, delivered: int, returned: int, cancelled: int, in_progress: int, success_rate: ?int, last_order_at: ?string, blocked: bool, block_reason: ?string}
     */
    public function forPhone(string $phone): array
    {
        $row = $this->counts([$phone])->first();
        /** @var BlockedPhone|null $block */
        $block = BlockedPhone::query()->where('organization_id', $this->tenant->requireOrganization())->where('phone', $phone)->first();

        $orders = (int) ($row->orders ?? 0);
        $delivered = (int) ($row->delivered ?? 0);
        $returned = (int) ($row->returned ?? 0);
        $cancelled = (int) ($row->cancelled ?? 0);

        return [
            'phone' => $phone,
            'orders' => $orders,
            'delivered' => $delivered,
            'returned' => $returned,
            'cancelled' => $cancelled,
            'in_progress' => $orders - $delivered - $returned - $cancelled,
            'success_rate' => self::rate($delivered, $returned),
            'last_order_at' => $row?->last_order_at === null ? null : CarbonImmutable::parse($row->last_order_at)->utc()->toIso8601String(),
            'blocked' => $block !== null,
            'block_reason' => $block?->reason,
        ];
    }

    /**
     * The risk signal of many numbers at once (the orders list): one grouped query over the
     * orders and one over the blocked numbers. Numbers without orders get a null rate.
     *
     * @param  list<string>  $phones
     * @return array<string, array{success_rate: ?int, blocked: bool}>
     */
    public function riskFor(array $phones): array
    {
        $phones = array_values(array_unique(array_filter($phones, fn ($p) => is_string($p) && $p !== '')));
        if ($phones === []) {
            return [];
        }
        $counts = $this->counts($phones)->keyBy('phone');
        $blocked = array_flip(BlockedPhone::query()->where('organization_id', $this->tenant->requireOrganization())->whereIn('phone', $phones)->pluck('phone')->all());

        $risk = [];
        foreach ($phones as $phone) {
            $row = $counts->get($phone);
            $risk[$phone] = [
                'success_rate' => self::rate((int) ($row->delivered ?? 0), (int) ($row->returned ?? 0)),
                'blocked' => isset($blocked[$phone]),
            ];
        }

        return $risk;
    }

    /**
     * Whether the number is on the organization's blocked list.
     *
     * @param  list<string|null>  $phones
     */
    public function anyBlocked(array $phones): bool
    {
        $phones = array_values(array_unique(array_filter($phones, fn ($p) => is_string($p) && $p !== '')));

        return $phones !== [] && BlockedPhone::query()->where('organization_id', $this->tenant->requireOrganization())->whereIn('phone', $phones)->exists();
    }

    public static function rate(int $delivered, int $returned): ?int
    {
        return $delivered + $returned === 0 ? null : (int) round(100 * $delivered / ($delivered + $returned));
    }

    /**
     * @param  list<string>  $phones
     * @return Collection<int, object{phone: string, orders: int, delivered: int, returned: int, cancelled: int, last_order_at: ?string}>
     */
    private function counts(array $phones): Collection
    {
        $returned = "s.status = '".ShipmentStatus::Returned->value."'";

        return DB::table('orders as o')
            ->leftJoin('shipments as s', fn ($join) => $join->on('s.order_id', '=', 'o.id')->on('s.organization_id', '=', 'o.organization_id'))
            ->where('o.organization_id', $this->tenant->requireOrganization())
            ->whereIn('o.contact_phone', $phones)
            ->groupBy('o.contact_phone')
            ->select('o.contact_phone as phone')
            ->selectRaw('count(*) as orders')
            ->selectRaw("sum(case when o.status = ? and not coalesce({$returned}, false) then 1 else 0 end) as delivered", [OrderStatus::Delivered->value])
            ->selectRaw("sum(case when coalesce({$returned}, false) then 1 else 0 end) as returned")
            ->selectRaw("sum(case when o.status in (?, ?) and not coalesce({$returned}, false) then 1 else 0 end) as cancelled", [OrderStatus::Cancelled->value, OrderStatus::Failed->value])
            ->selectRaw('max(o.placed_at) as last_order_at')
            ->get();
    }
}
