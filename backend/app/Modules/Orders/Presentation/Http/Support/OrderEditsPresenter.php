<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderEdit;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * BD1b: what the staff order detail adds for staff-entered orders and order edits — channel,
 * who entered it, the revision, the change history and the ids an edit form needs.
 */
class OrderEditsPresenter
{
    public function __construct(private readonly UserDirectory $users) {}

    /**
     * @return array{channel: ?string, created_by: ?array{id: string, name: ?string}, revision: int, edits: list<array<string, mixed>>, customer_id: ?string, contact_name: string, contact_phone: string, contact_email: ?string, shipping_method_id: ?string}
     */
    public function details(Order $order): array
    {
        $edits = OrderEdit::query()->where('order_id', $order->id)->orderByDesc('revision')->get();
        $names = $this->users->names($order->organization_id, array_values(array_unique(array_filter([
            $order->created_by,
            ...$edits->pluck('actor_user_id')->all(),
        ]))));
        $person = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];

        return [
            'channel' => $order->channel,
            'created_by' => $person($order->created_by),
            'revision' => (int) ($order->revision ?? 1),
            'edits' => $edits->map(fn (OrderEdit $e) => self::edit($e) + ['actor' => $person($e->actor_user_id)])->values()->all(),
            'customer_id' => $order->customer_id,
            'contact_name' => $order->contact_name,
            'contact_phone' => $order->contact_phone,
            'contact_email' => $order->contact_email,
            'shipping_method_id' => $order->shipping_method_id,
        ];
    }

    /**
     * The storefront address view plus `division_id` and `district_id`.
     *
     * @param  array<string, mixed>|null  $view
     * @return array<string, mixed>|null
     */
    public function address(Order $order, ?array $view): ?array
    {
        $address = $order->shippingAddress;
        if ($view === null || $address === null) {
            return $view;
        }

        return $view + ['division_id' => $address->division_id, 'district_id' => $address->district_id];
    }

    /**
     * One edit: totals before → after, the lines whose quantity changed ("Product — Variant",
     * null where the line was added or removed), whether contact and address changed and the
     * delivery method names when it changed (else null).
     *
     * @return array<string, mixed>
     */
    private static function edit(OrderEdit $edit): array
    {
        $before = $edit->before;
        $after = $edit->after;
        $quantities = function (array $snapshot): array {
            $result = [];
            foreach ($snapshot['lines'] ?? [] as $line) {
                $key = (string) ($line['variant_id'] ?? $line['sku']);
                $result[$key] = [
                    'name' => ($line['variant'] ?? null) !== null && $line['variant'] !== '' ? $line['name'].' — '.$line['variant'] : $line['name'],
                    'quantity' => Decimal::add($result[$key]['quantity'] ?? '0', (string) $line['quantity'], 3),
                ];
            }

            return $result;
        };
        $old = $quantities($before);
        $new = $quantities($after);
        $lines = [];
        foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $key) {
            $was = $old[$key]['quantity'] ?? null;
            $is = $new[$key]['quantity'] ?? null;
            if ($was !== null && $is !== null && Decimal::compare($was, $is) === 0) {
                continue;
            }
            $lines[] = ['name' => $new[$key]['name'] ?? $old[$key]['name'], 'before' => $was, 'after' => $is];
        }
        $shippingChanged = ($before['shipping_method']['id'] ?? null) !== ($after['shipping_method']['id'] ?? null);

        return [
            'revision' => $edit->revision,
            'reason' => $edit->reason,
            'created_at' => $edit->created_at->toIso8601String(),
            'total_before' => (string) ($before['totals']['total'] ?? ''),
            'total_after' => (string) ($after['totals']['total'] ?? ''),
            'lines' => $lines,
            'contact_changed' => ($before['contact'] ?? null) !== ($after['contact'] ?? null),
            'address_changed' => self::addressFields($before) !== self::addressFields($after),
            'shipping_before' => $shippingChanged ? ($before['shipping_method']['name'] ?? null) : null,
            'shipping_after' => $shippingChanged ? ($after['shipping_method']['name'] ?? null) : null,
        ];
    }

    /**
     * The address fields an edit can change (names derive from the ids).
     *
     * @param  array<string, mixed>  $snapshot
     * @return array<string, mixed>|null
     */
    private static function addressFields(array $snapshot): ?array
    {
        $address = $snapshot['address'] ?? null;
        if (! is_array($address)) {
            return null;
        }
        $keys = ['recipient_name', 'phone', 'division_id', 'district_id', 'area', 'address_line', 'postcode'];

        return array_combine($keys, array_map(fn (string $k) => $address[$k] ?? null, $keys));
    }
}
