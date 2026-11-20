<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Orders\Application\Contracts\CustomerOrderStatus;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: one of the signed-in shopper's own orders by number — status, payment, items, delivery
 * estimate, shipment with the courier's tracking link, and whether it can be cancelled or
 * returned. Registered only for a signed-in shopper and bound to that customer; an unknown
 * number and another customer's order give the same "not found". Never addresses or contacts.
 */
final class OrderStatusTool implements AiTool
{
    public const NAME = 'order_status';

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
            'Status of one of the signed-in shopper\'s own orders by its order number: status, payment, items, delivery estimate, '
            .'shipment and tracking link, and whether it can be cancelled or returned (done by the shopper on the order page).',
            Arguments::schema([
                'order_number' => ['type' => 'string', 'description' => 'The order number, e.g. "WEB-000123"'],
            ], ['order_number']),
        );
    }

    public function run(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['order_number']), [
            'order_number' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9-]+$/'],
        ])->validate();
        $number = trim((string) $args['order_number']);

        $order = $this->orders->find($this->customerId, $number);
        if ($order === null) {
            throw new BusinessRuleViolation('NOT_FOUND', 'Order not found. Only the signed-in shopper\'s own orders can be looked up.');
        }
        $path = '/account/orders/'.$order['number'];
        $this->findings->link('Order '.$order['number'], $path);

        return new ToolOutput(
            data: array_diff_key(MyOrdersTool::summary($order, $this->timezone), ['items' => true]) + [
                'payment_method' => $order['payment_method'],
                'items' => $order['lines'],
                'delivery_method' => $order['delivery_method'],
                'estimated_delivery_days' => ShopperText::days($order['eta_min_days'], $order['eta_max_days']),
                'shipment' => $order['shipment'] === null ? null : [
                    'status' => $order['shipment']['status_label'],
                    'courier' => $order['shipment']['courier'],
                    'tracking_url' => $order['shipment']['tracking_url'],
                ],
                'can_cancel' => $order['can_cancel'],
                'returnable' => $order['returnable'],
                'return_deadline' => $order['return_deadline'] === null ? null
                    : CarbonImmutable::parse($order['return_deadline'])->setTimezone($this->timezone)->toDateString(),
            ],
            params: ['order_number' => mb_substr($number, 0, 40)],
        );
    }
}
