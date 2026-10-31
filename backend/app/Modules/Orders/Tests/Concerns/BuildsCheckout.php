<?php

namespace App\Modules\Orders\Tests\Concerns;

use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * An open storefront ready for checkout, built through the real APIs: products (Shirt 450
 * with 5 in stock, Juice 120 + VAT 15% with 10 in stock, Rice 60.50 untracked, Pills 100
 * batch-tracked: 2 in an earlier batch, 5 in a later one), delivery zones "Inside Dhaka"
 * (Dhaka: 60, free from 2000, no COD fee) and "Outside Dhaka" (one other district: 120,
 * COD fee 20), COD on and bank transfer on (48 h hold). Use with ActsAsShopper,
 * BuildsOnlineCatalog and InteractsWithTenancy.
 */
trait BuildsCheckout
{
    protected const HOST = 'shop.example.test';

    protected const DHAKA_DIVISION = 3;

    protected const DHAKA = 18;

    /** @var array<string, mixed> */
    protected array $tenant;

    /** @var array<string, string> variant ids by SKU */
    protected array $v = [];

    /** @var array{inside: string, outside: string} method ids */
    protected array $methods;

    /** @var array{inside: string, outside: string} zone ids */
    protected array $zones;

    protected int $otherDistrict;

    protected int $otherDivision;

    protected function buildShop(string $name = 'Berry Kids', string $host = self::HOST): void
    {
        config(['pos.checkout_rate_limit' => 1000, 'pos.auth_rate_limit' => 100]);
        $this->tenant = $t = $this->openStore($name, $host);
        $org = $t['organization'];
        $vat = $this->inTenant($org, fn () => TaxRate::query()->create(['name' => 'VAT', 'rate' => '15']));

        $shirt = $this->makeProduct($t['unit']->id, 'Shirt', [['SHIRT', '450.00']]);
        $juice = $this->makeProduct($t['unit']->id, 'Juice', [['JUICE', '120.00']], ['tax_rate_id' => $vat->id]);
        $rice = $this->makeProduct($t['unit']->id, 'Rice', [['RICE', '60.50']], ['track_stock' => false]);
        $pills = $this->makeProduct($t['unit']->id, 'Pills', [['PILLS', '100.00']], ['track_batches' => true]);
        foreach ([$shirt, $juice, $rice, $pills] as $product) {
            $this->publish($product['id']);
            $this->v[$product['variants'][0]['sku']] = $product['variants'][0]['id'];
        }
        $this->stockUp($t, [$this->v['SHIRT'] => '5', $this->v['JUICE'] => '10']);
        $this->inTenant($org, fn () => app(PostStockAdjustment::class)($t['admin']->fresh(), [
            'store_id' => $t['store']->id,
            'reason' => 'opening',
            'lines' => [
                ['variant_id' => $this->v['PILLS'], 'quantity' => '2', 'unit_cost' => '10', 'batch_number' => 'EARLY', 'expires_on' => now()->addMonths(2)->toDateString()],
                ['variant_id' => $this->v['PILLS'], 'quantity' => '5', 'unit_cost' => '12', 'batch_number' => 'LATE', 'expires_on' => now()->addYear()->toDateString()],
            ],
        ]));

        $other = DB::table('geo_districts')->where('id', '!=', self::DHAKA)->orderBy('id')->first();
        $this->otherDistrict = (int) $other->id;
        $this->otherDivision = (int) $other->division_id;

        $inside = $this->postJson('/api/v1/shipping/zones', ['name' => 'Inside Dhaka', 'district_ids' => [self::DHAKA]])->assertCreated()->json('data');
        $outside = $this->postJson('/api/v1/shipping/zones', ['name' => 'Outside Dhaka', 'district_ids' => [$this->otherDistrict], 'sort_order' => 1])->assertCreated()->json('data');
        $this->zones = ['inside' => $inside['id'], 'outside' => $outside['id']];
        $this->methods = [
            'inside' => $this->postJson("/api/v1/shipping/zones/{$inside['id']}/methods", [
                'name' => 'Home delivery', 'fee' => '60', 'free_over' => '2000', 'cod_allowed' => true, 'cod_fee' => '0', 'eta_min_days' => 1, 'eta_max_days' => 2,
            ])->assertCreated()->json('data.id'),
            'outside' => $this->postJson("/api/v1/shipping/zones/{$outside['id']}/methods", [
                'name' => 'Courier delivery', 'fee' => '120', 'cod_allowed' => true, 'cod_fee' => '20', 'eta_min_days' => 3, 'eta_max_days' => 5,
            ])->assertCreated()->json('data.id'),
        ];
        $this->putJson('/api/v1/payment-gateways/bank_transfer', [
            'is_enabled' => true,
            'instructions' => 'Pay to Test Bank, account 123.',
            'settings' => ['hold_hours' => 48],
        ])->assertOk();

        $this->asVisitor();
    }

    protected function storeUrl(string $path, string $host = self::HOST): string
    {
        return "http://{$host}/api/v1/store/{$path}";
    }

    protected function addToCart(string $sku, string|int $quantity, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('cart/items', $host), ['variant_id' => $this->v[$sku], 'quantity' => $quantity])->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    protected function inlineAddress(?int $districtId = null, ?int $divisionId = null): array
    {
        return [
            'recipient_name' => 'Rina Akter',
            'phone' => '+880 1712-345678',
            'division_id' => $divisionId ?? self::DHAKA_DIVISION,
            'district_id' => $districtId ?? self::DHAKA,
            'area' => 'Dhanmondi',
            'address_line' => 'House 1, Road 2',
            'postcode' => '1205',
        ];
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function checkoutBody(string $expectedTotal, array $overrides = []): array
    {
        return $overrides + [
            'contact' => ['name' => 'Rina Akter', 'email' => 'rina@example.test', 'phone' => '01712345678'],
            'address' => $this->inlineAddress(),
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'notes' => 'Ring the bell',
            'expected_total' => $expectedTotal,
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function placeOrder(array $body, ?string $key = null, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('checkout', $host), $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function previewCheckout(array $body, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('checkout/preview', $host), $body);
    }
}
