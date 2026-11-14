<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Application\Contracts\SaleBaskets;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P1b: completed POS sales as baskets of distinct products for "frequently bought together" —
 * cancelled sales and lines whose whole quantity came back do not count; other organizations'
 * sales never appear.
 */
class SaleBasketsTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    /**
     * @param  array<string, ProductVariant>  $variants
     * @return list<list<string>> each basket's product names, sorted
     */
    private function baskets(string $organizationId, array $variants): array
    {
        $names = [];
        foreach ($variants as $name => $variant) {
            $names[$variant->product_id] = $name;
        }
        $result = [];
        foreach (app(SaleBaskets::class)->since($organizationId, now()->subDay()) as $basket) {
            $basket = array_map(fn (string $id) => $names[$id], $basket);
            sort($basket);
            $result[] = $basket;
        }
        sort($result);

        return $result;
    }

    public function test_completed_sales_are_baskets_without_cancelled_sales_or_fully_returned_lines(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $v = [];
        foreach (['Tea' => '50.00', 'Biscuits' => '30.00', 'Cake' => '120.00', 'Sugar' => '90.00'] as $name => $price) {
            $v[$name] = $this->sellable($org, $name, $price);
            $this->stockUp($store, $v[$name], '20');
        }

        $this->checkout($this->cart($store, [[$v['Tea'], '2'], [$v['Biscuits'], '1'], [$v['Cake'], '1']], [['cash', '500']]))->assertCreated();
        // Biscuits all came back: only Tea is left of this sale.
        $returned = $this->checkout($this->cart($store, [[$v['Tea'], '1'], [$v['Biscuits'], '2']], [['cash', '200']]))->assertCreated()->json('data');
        $this->postJson('/api/v1/returns', [
            'sale_id' => $returned['id'],
            'lines' => [['sale_line_id' => $returned['lines'][1]['id'], 'quantity' => '2']],
            'refunds' => [['method' => 'cash', 'amount' => '60.00']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'completed');
        // Part of the Sugar came back: Sugar still counts.
        $partly = $this->checkout($this->cart($store, [[$v['Sugar'], '2'], [$v['Cake'], '1']], [['cash', '400']]))->assertCreated()->json('data');
        $this->postJson('/api/v1/returns', [
            'sale_id' => $partly['id'],
            'lines' => [['sale_line_id' => $partly['lines'][0]['id'], 'quantity' => '1']],
            'refunds' => [['method' => 'cash', 'amount' => '90.00']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $cancelled = $this->checkout($this->cart($store, [[$v['Sugar'], '1'], [$v['Tea'], '1']], [['cash', '200']]))->assertCreated()->json('data');
        $this->postJson("/api/v1/sales/{$cancelled['id']}/cancel", ['reason' => 'Wrong items'])->assertOk();

        $this->assertSame([['Cake', 'Sugar'], ['Biscuits', 'Cake', 'Tea']], $this->baskets($org->id, $v));

        // Another organization's baskets never hold this organization's sales.
        $other = $this->provisionTenant('Other Org')['organization'];
        $this->assertSame([], $this->baskets($other->id, $v));
    }
}
