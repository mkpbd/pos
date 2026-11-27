<?php

namespace App\Modules\Orders\Infrastructure;

use App\Modules\Orders\Application\Contracts\OrderPreviews;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;

/**
 * B14: the store builder's order page sample — real orders masked (OrderPresenter's storefront
 * view with the personal details hidden), or a made-up order.
 */
class EloquentOrderPreviews implements OrderPreviews
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(private readonly OrderPresenter $presenter) {}

    public function recent(int $limit): array
    {
        return Order::query()->orderByDesc('placed_at')->orderByDesc('id')->limit(max(1, $limit))->get(['id', 'number', 'placed_at'])
            ->map(fn (Order $o) => ['number' => $o->number, 'placed_at' => $o->placed_at->toIso8601String()])
            ->values()->all();
    }

    public function masked(?string $idOrNumber): ?array
    {
        $needle = $idOrNumber === null ? null : trim($idOrNumber);
        $order = Order::query()
            ->when($needle !== null, fn ($q) => preg_match(self::UUID, strtolower($needle)) === 1
                ? $q->whereKey(strtolower($needle))
                : $q->whereRaw('upper(number) = ?', [mb_strtoupper($needle)]))
            ->orderByDesc('placed_at')->orderByDesc('id')
            ->first();

        return $order === null ? null : self::mask($this->presenter->storefront($order));
    }

    public function sample(array $products, string $currency, bool $pricesIncludeTax): array
    {
        $subtotal = '0.00';
        $lines = [];
        foreach ($products as $product) {
            $price = Decimal::round($product['price'], 2);
            $subtotal = Decimal::add($subtotal, $price, 2);
            $lines[] = [
                'product_name' => $product['name'],
                'variant_name' => null,
                'sku' => '',
                'image_url' => $product['image_url'],
                'quantity' => '1',
                'unit_price' => $price,
                'line_total' => $price,
                'discount_amount' => '0.00',
                'product_url' => $product['product_url'],
            ];
        }
        $shipping = '60.00';
        $placed = CarbonImmutable::now()->subHour()->startOfMinute();

        return [
            'number' => 'SAMPLE-1001',
            'status' => OrderStatus::Confirmed->value,
            'status_label' => OrderStatus::Confirmed->label(),
            'payment_status' => 'unpaid',
            'payment_method' => OrderPaymentMethod::CashOnDelivery->value,
            'payment_method_label' => OrderPaymentMethod::CashOnDelivery->label(),
            'payment_instructions' => null,
            'locale' => 'en',
            'placed_at' => $placed->toIso8601String(),
            'expires_at' => null,
            'contact' => ['name' => 'Rahim', 'email' => 'r•••@example.com', 'phone' => '017•••••000'],
            'shipping_address' => [
                'recipient_name' => 'Rahim', 'phone' => '017•••••000', 'division' => 'Dhaka', 'district' => 'Dhaka',
                'area' => null, 'address_line' => '•••', 'postcode' => null,
            ],
            'shipping_method_name' => 'Home delivery',
            'eta_min_days' => 2,
            'eta_max_days' => 3,
            'lines' => $lines,
            'subtotal' => $subtotal,
            'discount_total' => '0.00',
            'tax_total' => '0.00',
            'shipping_total' => $shipping,
            'shipping_discount' => '0.00',
            'shipping_breakdown' => null,
            'promotions' => [],
            'coupon_code' => null,
            'cod_fee' => '0.00',
            'total' => Decimal::add($subtotal, $shipping, 2),
            'currency' => $currency,
            'prices_include_tax' => $pricesIncludeTax,
            'courier_name' => null,
            'tracking_number' => null,
            'tracking_url' => null,
            'history' => [['status' => OrderStatus::Confirmed->value, 'label' => OrderStatus::Confirmed->label(), 'at' => $placed->toIso8601String()]],
            'sample' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $view
     * @return array<string, mixed>
     */
    public static function mask(array $view): array
    {
        $view['contact'] = [
            'name' => self::firstName($view['contact']['name'] ?? null),
            'email' => self::email($view['contact']['email'] ?? null),
            'phone' => self::phone($view['contact']['phone'] ?? null),
        ];
        if (is_array($view['shipping_address'] ?? null)) {
            $view['shipping_address'] = [
                'recipient_name' => self::firstName($view['shipping_address']['recipient_name'] ?? null),
                'phone' => self::phone($view['shipping_address']['phone'] ?? null),
                'division' => $view['shipping_address']['division'] ?? null,
                'district' => $view['shipping_address']['district'] ?? null,
                'area' => null,
                'address_line' => '•••',
                'postcode' => null,
            ];
        }
        $view['tracking_number'] = is_string($view['tracking_number'] ?? null) && $view['tracking_number'] !== '' ? '•••'.mb_substr($view['tracking_number'], -3) : null;
        $view['tracking_url'] = null;
        $view['coupon_code'] = null;

        return $view + ['sample' => false];
    }

    public static function firstName(?string $name): ?string
    {
        $name = trim((string) $name);

        return $name === '' ? null : preg_split('/\s+/u', $name)[0];
    }

    private static function email(?string $email): ?string
    {
        if (! is_string($email) || ! str_contains($email, '@')) {
            return null;
        }
        [$local, $domain] = explode('@', $email, 2);

        return mb_substr($local, 0, 1).'•••@'.$domain;
    }

    private static function phone(?string $phone): ?string
    {
        if (! is_string($phone) || mb_strlen($phone) < 6) {
            return null;
        }

        return mb_substr($phone, 0, 3).str_repeat('•', max(1, mb_strlen($phone) - 6)).mb_substr($phone, -3);
    }
}
