<?php

namespace App\Modules\Orders\Tests\Concerns;

use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shipping\Infrastructure\Models\Courier;

/**
 * Orders of the signed-in shopper (E9) on the BuildsCheckout shop: places them through the
 * checkout API in the current browser and moves them along the workflow as the shop admin.
 * Use with BuildsCheckout, ActsAsShopper, BuildsOnlineCatalog and InteractsWithTenancy.
 */
trait BuildsCustomerOrders
{
    /**
     * Places an order with the current browser (cart emptied first) and returns its number.
     *
     * @param  array<string, string|int>  $items  sku => quantity
     */
    protected function customerOrder(array $items, string $payment = 'cod'): string
    {
        $this->browse('DELETE', $this->storeUrl('cart'))->assertOk();
        foreach ($items as $sku => $quantity) {
            $this->addToCart($sku, $quantity);
        }
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment])->json('data.total');

        return $this->placeOrder($this->checkoutBody($total, ['payment_method' => $payment]))->assertCreated()->json('data.order.number');
    }

    protected function orderModel(string $number, ?string $organizationId = null): Order
    {
        return Order::query()->withoutGlobalScopes()
            ->where('organization_id', $organizationId ?? $this->tenant['organization']->id)
            ->where('number', $number)->firstOrFail();
    }

    /**
     * Moves a confirmed order forward as the shop admin: processing, shipped or delivered.
     */
    protected function advance(string $number, string $to): void
    {
        $admin = (string) $this->tenant['admin']->id;
        $this->inTenant($this->tenant['organization'], function () use ($number, $to, $admin) {
            $workflow = app(OrderWorkflow::class);
            $order = $workflow->process($this->orderModel($number), $admin);
            if ($to === 'processing') {
                return;
            }
            $courier = Courier::query()->firstOrCreate(['name' => 'Pathao'], ['tracking_url_template' => 'https://track.example.test/p?id={tracking}']);
            $order = $workflow->ship($order->fresh(), $courier->id, 'TRK-1', null, $admin);
            if ($to === 'delivered') {
                $workflow->deliver($order->fresh(), $admin);
            }
        });
    }

    protected function signIn(string $email, string $password = 'secret-pass1', string $host = self::HOST): void
    {
        $this->clearBrowser();
        $this->browse('POST', "http://{$host}/api/v1/store/account/login", ['email' => $email, 'password' => $password])->assertSuccessful();
    }
}
