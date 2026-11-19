<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * B14: the order page's sample context — the store's real orders masked (builder users need no
 * web order access), the made-up order, the recent orders to choose from and isolation.
 */
class StoreBuilderB14OrderSampleTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const SAMPLE = '/api/v1/storefront/builder/sample-context?template=order';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    private function editor(): User
    {
        $organization = $this->tenant['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () {
            $role = Role::query()->create(['name' => 'Designer '.Str::random(4)]);
            $role->permissions()->sync(['storefront.view', 'storefront.manage']);

            return $role;
        }));
    }

    public function test_orders_are_shown_masked_and_a_made_up_order_is_there_without_any(): void
    {
        // No orders yet: the made-up order.
        $this->actingAsUser($this->editor());
        $made = $this->getJson(self::SAMPLE)->assertOk()->json('data');
        $this->assertTrue($made['context']['order']['sample']);
        $this->assertSame('SAMPLE-1001', $made['context']['order']['number']);
        $this->assertSame(['min_days' => 2, 'max_days' => 3], $made['context']['order']['delivery_eta']);
        $this->assertCount(2, $made['sample']['order']['lines']);
        $lineTotal = array_sum(array_map(fn (array $l) => (float) $l['line_total'], $made['sample']['order']['lines']));
        $this->assertSame(number_format($lineTotal + 60, 2, '.', ''), $made['context']['order']['total']);
        $this->assertSame([['id' => 'sample', 'label' => 'Sample order']], $made['choices']);

        $this->addToCart('SHIRT', 1);
        $number = $this->placeOrder($this->checkoutBody('510.00'))->assertCreated()->json('data.order.number');

        $this->actingAsUser($this->editor());
        $real = $this->getJson(self::SAMPLE)->assertOk()->json('data');
        $this->assertSame([
            'number' => $number, 'status' => 'Confirmed', 'total' => '510.00', 'currency' => $real['context']['order']['currency'],
            'placed_at' => $real['context']['order']['placed_at'], 'customer_first_name' => 'Rina', 'payment_method' => 'Cash on delivery',
            'delivery_eta' => ['min_days' => 1, 'max_days' => 2], 'sample' => false,
        ], $real['context']['order']);
        $order = $real['sample']['order'];
        $this->assertSame(['name' => 'Rina', 'email' => 'r•••@example.test', 'phone' => '017•••••678'], $order['contact']);
        $this->assertSame(['recipient_name' => 'Rina', 'phone' => '017•••••678', 'division' => $order['shipping_address']['division'], 'district' => $order['shipping_address']['district'], 'area' => null, 'address_line' => '•••', 'postcode' => null], $order['shipping_address']);
        $this->assertStringNotContainsString('House 1', (string) json_encode($real));
        $this->assertStringNotContainsString('rina@example.test', (string) json_encode($real));
        $this->assertSame('Shirt', $order['lines'][0]['product_name']);
        $this->assertSame([['id' => 'sample', 'label' => 'Sample order'], ['id' => $number, 'label' => $number.' · '.substr($order['placed_at'], 0, 10)]], $real['choices']);

        // By number (any case) or the made-up one; unknown → 404.
        $this->assertSame($number, $this->getJson(self::SAMPLE.'&id='.strtolower($number))->assertOk()->json('data.context.order.number'));
        $this->assertTrue($this->getJson(self::SAMPLE.'&id=sample')->assertOk()->json('data.context.order.sample'));
        $this->getJson(self::SAMPLE.'&id=WEB-999999')->assertNotFound();

        // Another store sees neither the order nor it among the choices.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($other['admin']);
        $this->getJson(self::SAMPLE.'&id='.$number)->assertNotFound();
        $this->assertSame([['id' => 'sample', 'label' => 'Sample order']], $this->getJson(self::SAMPLE)->assertOk()->json('data.choices'));

        // Reading needs storefront.view.
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], $this->inTenant($this->tenant['organization'], fn () => Role::query()->create(['name' => 'Nobody']))));
        $this->getJson(self::SAMPLE)->assertForbidden();
    }
}
