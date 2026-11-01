<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * "Mark processing" for many orders (E10a): each order goes confirmed → processing on its
 * own (own transaction and lock, the usual history and audit), so one order that cannot move
 * never blocks the others. Never all-or-nothing: the result lists every order.
 */
class ProcessOrdersInBulk
{
    public function __construct(private readonly OrderWorkflow $workflow) {}

    /**
     * @param  list<string>  $orderIds
     * @return list<array{id: string, number: ?string, ok: bool, error_code?: string, message?: string}>
     */
    public function __invoke(array $orderIds, string $actorId): array
    {
        $ids = array_values(array_unique($orderIds));
        $orders = Order::query()->whereIn('id', $ids)->get()->keyBy('id');
        $results = [];

        foreach ($ids as $id) {
            /** @var Order|null $order */
            $order = $orders->get($id);
            if ($order === null) {
                $results[] = ['id' => $id, 'number' => null, 'ok' => false, 'error_code' => 'NOT_FOUND', 'message' => 'Order not found.'];

                continue;
            }
            try {
                $this->workflow->process($order, $actorId);
                $results[] = ['id' => $id, 'number' => $order->number, 'ok' => true];
            } catch (BusinessRuleViolation $e) {
                $results[] = ['id' => $id, 'number' => $order->number, 'ok' => false, 'error_code' => $e->errorCode, 'message' => $e->getMessage()];
            }
        }

        return $results;
    }
}
