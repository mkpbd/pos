<?php

namespace Database\Seeders;

use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Domain\CartOwner;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Application\Actions\PlaceOrder;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Reviews\Application\Actions\CustomerReviews;
use App\Modules\Reviews\Application\Actions\ModerateReview;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Event;
use RuntimeException;

/**
 * The demo shopper's account area (E9), through the real use cases: shopper@demo.test gets
 *
 * - WEB-000001: a delivered and paid cash-on-delivery order of 2 × Pran Mango Juice 250ml
 *   (placed, processed, shipped with the Pathao courier / DEMO-TRK-0001 — a shipment with a
 *   tracking link — delivered, COD recorded) with an approved 5-star review of the juice;
 * - WEB-000002: a confirmed, unpaid cash-on-delivery order of Miniket Rice (or another product
 *   in stock), which the shopper can still cancel;
 * - WEB-000003 (E10a): the same product, shipped with Steadfast (DEMO-SF-0002), in transit,
 *   COD unpaid — data for the orders board and the COD remittance flow.
 *
 * Both are delivered to the shopper's saved Dhaka address. The order e-mails and staff
 * notifications are not sent. No other customer account exists, so no pending review is
 * seeded.
 */
class DemoAccountSeeder extends Seeder
{
    public function run(
        string $organizationId,
        string $adminId,
        TenantContext $tenant,
        ShoppingCart $carts,
        CheckoutQuoter $quoter,
        PlaceOrder $place,
        OrderWorkflow $workflow,
        CustomerAddressBook $addresses,
        StorefrontCatalog $catalog,
        CustomerReviews $reviews,
        ModerateReview $moderate,
    ): void {
        $tenant->runAs($organizationId, function () use ($adminId, $carts, $quoter, $place, $workflow, $addresses, $catalog, $reviews, $moderate) {
            $account = CustomerAccount::query()->where('email', 'shopper@demo.test')->first();
            if ($account === null) {
                return;
            }
            $address = $addresses->list($account->customer_id)[0] ?? throw new RuntimeException('The demo shopper has no address.');

            $order = function (string $variantId, string $quantity) use ($account, $address, $carts, $quoter, $place): Order {
                $owner = CartOwner::customer($account->customer_id);
                $carts->clear($owner);
                $carts->add($owner, $variantId, $quantity);
                $input = ['shipping_address_id' => $address['id'], 'payment_method' => 'cod'];
                $preview = $quoter->quote($carts->find($owner), $input, $account->customer_id, autoPickMethod: true)['preview'];

                // Placement e-mails and staff notifications are left out of the demo data.
                return Event::fakeFor(fn () => $place($owner, ['customer_id' => $account->customer_id, 'account_id' => $account->id], $input + [
                    'contact' => ['name' => $address['recipient_name'], 'email' => $account->email, 'phone' => $address['phone']],
                    'shipping_method_id' => $preview['shipping_method_id'],
                    'notes' => null,
                    'save_address' => false,
                    'expected_total' => $preview['total'],
                ], ['ip' => null, 'user_agent' => 'Demo seeder', 'site_url' => (string) config('app.url')])['order'], [OrderPlaced::class]);
            };

            // 1. Delivered and paid, with an approved review.
            $juice = Product::query()->where('name', 'Pran Mango Juice 250ml')->firstOrFail();
            $delivered = $order($juice->variants()->value('id'), '2');
            $delivered = $workflow->process($delivered, $adminId);
            $courier = fn (string $name): string => Courier::query()->where('name', $name)->valueOrFail('id');
            $delivered = $workflow->ship($delivered->fresh(), $courier('Pathao'), 'DEMO-TRK-0001', null, $adminId);
            $delivered = $workflow->deliver($delivered->fresh(), $adminId);
            $workflow->recordCodPayment($delivered->fresh(), 'DEMO-COD-0001', $adminId);

            $review = $reviews->submit($account->customer_id, [
                'product_id' => $juice->id,
                'rating' => 5,
                'title' => 'Tastes like real mangoes',
                'body' => 'Cold from the fridge it is perfect. Delivery was quick and the bottles were well packed.',
            ]);
            $moderate->approve($review, $adminId);

            // 2. Confirmed and unpaid: still cancellable by the shopper.
            // 3. (E10a) Shipped with Steadfast, in transit, COD unpaid: the courier still owes the money.
            foreach (['Miniket Rice', 'Cotton Polo Shirt', 'Pran Mango Juice 250ml'] as $name) {
                foreach (Product::query()->where('name', $name)->first()?->variants()->pluck('id')->all() ?? [] as $variantId) {
                    $data = $catalog->variantsForCart([$variantId])[$variantId] ?? null;
                    if ($data !== null && $data['purchasable'] && $data['in_stock']) {
                        $order($variantId, '1');

                        $shipped = $workflow->process($order($variantId, '1'), $adminId);
                        $shipped = $workflow->ship($shipped->fresh(), $courier('Steadfast'), 'DEMO-SF-0002', 'Picked up from the Dhaka Main store', $adminId);
                        $workflow->shipmentEvent($shipped->fresh(), ShipmentStatus::InTransit, 'At the Steadfast sorting hub', null, $adminId);

                        return;
                    }
                }
            }
        });
    }
}
