<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Orders\Application\Contracts\CustomerOrderStatus;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: the signed-in shopper's five newest orders — only registered for a signed-in shopper
 * and bound to that customer (no customer parameter). Number, date, status, payment status,
 * total and item names; never addresses or contact details.
 */
final class MyOrdersTool implements AiTool
{
    public const NAME = 'my_orders';

    public const MAX_ORDERS = 5;

    public function __construct(
        private readonly CustomerOrderStatus $orders,
        private readonly ShopperFindings $findings,
        private readonly string $customerId,
        private readonly string $timezone,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'The signed-in shopper\'s own most recent orders (at most 5, newest first): order number, date, status, payment status, '
            .'total and items. Use order_status for one order\'s details.',
            Arguments::schema([]),
        );
    }

    public function run(array $input): ToolOutput
    {
        Validator::make(Arguments::only($input, []), [])->validate();
        $this->findings->link('My orders', '/account/orders');

        return new ToolOutput(
            data: [
                'orders' => array_map(fn (array $o) => self::summary($o, $this->timezone), $this->orders->recent($this->customerId, self::MAX_ORDERS)),
                'all_orders_path' => '/account/orders',
            ],
            params: [],
        );
    }

    /**
     * @param  array<string, mixed>  $order  CustomerOrderStatus summary
     * @return array<string, mixed>
     */
    public static function summary(array $order, string $timezone): array
    {
        return [
            'number' => $order['number'],
            'placed_on' => CarbonImmutable::parse($order['placed_at'])->setTimezone($timezone)->toDateString(),
            'status' => $order['status'],
            'status_label' => $order['status_label'],
            'payment_status' => $order['payment_status_label'],
            'total_text' => ShopperText::money($order['total'], $order['currency']),
            'item_count' => $order['item_count'],
            'items' => $order['items'],
            'path' => '/account/orders/'.$order['number'],
        ];
    }
}
