<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReceiptDelivery;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * POS1d: the digital receipts sent for a sale, newest first (recipients masked).
 */
final class SaleReceiptHistory
{
    /**
     * @return list<array{channel: string, recipient_masked: string, status: string, created_by_name: ?string, created_at: string}>
     */
    public static function of(Sale $sale, UserDirectory $users, string $organizationId): array
    {
        $rows = SaleReceiptDelivery::query()->where('sale_id', $sale->id)
            ->orderByDesc('created_at')->orderByDesc('id')->get();
        if ($rows->isEmpty()) {
            return [];
        }
        $names = $users->names($organizationId, $rows->pluck('created_by')->filter()->unique()->values()->all());

        return $rows->map(fn (SaleReceiptDelivery $d) => [
            'channel' => $d->channel,
            'recipient_masked' => $d->recipient_masked,
            'status' => $d->status,
            'created_by_name' => $d->created_by === null ? null : ($names[$d->created_by] ?? null),
            'created_at' => $d->created_at->toIso8601String(),
        ])->values()->all();
    }
}
