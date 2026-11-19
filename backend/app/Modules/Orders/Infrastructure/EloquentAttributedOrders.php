<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Marketing\Application\Contracts\AttributedOrders;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * P2a: web orders grouped by campaign attribution for the Marketing stats (one query; tenant
 * scoped through the Order model).
 */
class EloquentAttributedOrders implements AttributedOrders
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function groups(CarbonImmutable $from, CarbonImmutable $to, string $timezone): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $lines = DB::table('order_lines')
            ->where('organization_id', $organizationId)
            ->groupBy('order_id')
            ->select('order_id')
            ->selectRaw('SUM(quantity) AS quantity');
        $lost = [OrderStatus::Cancelled->value, OrderStatus::Failed->value];

        $rows = Order::query()->toBase()
            ->leftJoinSub($lines, 'l', 'l.order_id', '=', 'orders.id')
            ->where('orders.placed_at', '>=', $from)
            ->where('orders.placed_at', '<', $to)
            ->selectRaw("to_char((orders.placed_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day", [$timezone])
            ->selectRaw("orders.attribution->>'short_link' AS short_link")
            ->selectRaw("orders.attribution->>'utm_campaign' AS utm_campaign")
            ->selectRaw("orders.attribution->>'utm_source' AS source")
            ->selectRaw("orders.attribution->>'utm_medium' AS medium")
            ->selectRaw("COALESCE(orders.attribution->>'landing_path', orders.attribution->>'order_page') AS landing_path")
            ->selectRaw('(orders.status IN (?, ?)) AS lost', $lost)
            ->selectRaw('COUNT(*) AS orders')
            ->selectRaw('COALESCE(SUM(l.quantity), 0) AS items')
            ->selectRaw('COALESCE(SUM(orders.total), 0) AS revenue')
            ->groupByRaw('1, 2, 3, 4, 5, 6, 7')
            ->get();

        return $rows->map(fn (object $r) => [
            'day' => (string) $r->day,
            'short_link' => $r->short_link,
            'utm_campaign' => $r->utm_campaign,
            'source' => $r->source,
            'medium' => $r->medium,
            'landing_path' => $r->landing_path,
            'lost' => (bool) $r->lost,
            'orders' => (int) $r->orders,
            'items' => Decimal::round((string) $r->items, 3),
            'revenue' => Decimal::round((string) $r->revenue, 2),
        ])->values()->all();
    }

    public function builderGroups(CarbonImmutable $from, CarbonImmutable $to, string $timezone, ?string $documentId = null, ?string $device = null): array
    {
        $rows = Order::query()->toBase()
            ->where('orders.placed_at', '>=', $from)
            ->where('orders.placed_at', '<', $to)
            ->whereNotIn('orders.status', [OrderStatus::Cancelled->value, OrderStatus::Failed->value])
            ->whereRaw("orders.attribution->'builder'->>'document_id' IS NOT NULL")
            ->when($documentId !== null, fn ($q) => $q->whereRaw("orders.attribution->'builder'->>'document_id' = ?", [strtolower((string) $documentId)]))
            ->when($device !== null, fn ($q) => $q->whereRaw("orders.attribution->'builder'->>'device' = ?", [$device]))
            ->selectRaw("to_char((orders.placed_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day", [$timezone])
            ->selectRaw("orders.attribution->'builder'->>'document_id' AS document_id")
            ->selectRaw("orders.attribution->'builder'->>'node_id' AS node_id")
            ->selectRaw('COUNT(*) AS orders')
            ->selectRaw('COALESCE(SUM(orders.total), 0) AS revenue')
            ->groupByRaw('1, 2, 3')
            ->get();

        return $rows->map(fn (object $r) => [
            'day' => (string) $r->day,
            'document_id' => (string) $r->document_id,
            'node_id' => $r->node_id === null ? null : (string) $r->node_id,
            'orders' => (int) $r->orders,
            'revenue' => Decimal::round((string) $r->revenue, 2),
        ])->values()->all();
    }

    public function experimentGroups(CarbonImmutable $from, CarbonImmutable $to, string $timezone, string $documentId, string $experimentId, ?string $device = null): array
    {
        $rows = Order::query()->toBase()
            ->where('orders.placed_at', '>=', $from)
            ->where('orders.placed_at', '<', $to)
            ->whereNotIn('orders.status', [OrderStatus::Cancelled->value, OrderStatus::Failed->value])
            ->whereRaw("orders.attribution->'builder'->>'document_id' = ?", [strtolower($documentId)])
            ->whereRaw("orders.attribution->'builder'->'experiments'->>? IN ('A', 'B')", [$experimentId])
            ->when($device !== null, fn ($q) => $q->whereRaw("orders.attribution->'builder'->>'device' = ?", [$device]))
            ->selectRaw("to_char((orders.placed_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day", [$timezone])
            ->selectRaw("orders.attribution->'builder'->'experiments'->>? AS arm", [$experimentId])
            ->selectRaw('COUNT(*) AS orders')
            ->selectRaw('COALESCE(SUM(orders.total), 0) AS revenue')
            ->groupByRaw('1, 2')
            ->get();

        return $rows->map(fn (object $r) => [
            'day' => (string) $r->day,
            'arm' => (string) $r->arm,
            'orders' => (int) $r->orders,
            'revenue' => Decimal::round((string) $r->revenue, 2),
        ])->values()->all();
    }
}
