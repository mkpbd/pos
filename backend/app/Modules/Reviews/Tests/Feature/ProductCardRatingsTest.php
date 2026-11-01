<?php

namespace App\Modules\Reviews\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * E10b: product cards carry the approved-review rating (one batched query) and the listing
 * sorts by it (`sort=rating`: average, then count, unrated last).
 */
class ProductCardRatingsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.review_rate_limit' => 100]);
        $this->buildShop();
    }

    /**
     * Registers $email, has $ratings' products delivered and reviews them.
     *
     * @param  array<string, int>  $ratings  sku => stars
     * @return list<string> review ids
     */
    private function reviewer(string $email, array $ratings): array
    {
        $this->clearBrowser();
        $this->registerShopper(self::HOST, $email);
        $number = $this->customerOrder(array_map(fn () => 1, $ratings));
        $this->advance($number, 'delivered');
        $products = collect($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines'))->pluck('product_id', 'sku');

        $ids = [];
        foreach ($ratings as $sku => $stars) {
            $ids[] = $this->browse('POST', $this->storeUrl('account/reviews'), ['product_id' => $products[$sku], 'rating' => $stars, 'body' => 'Honest opinion of it.'])->assertCreated()->json('data.id');
        }

        return $ids;
    }

    public function test_cards_show_ratings_and_sort_by_them(): void
    {
        $approve = [
            ...$this->reviewer('a@example.test', ['JUICE' => 5, 'SHIRT' => 5, 'RICE' => 4]),
            ...$this->reviewer('b@example.test', ['SHIRT' => 3]),
        ];
        $this->reviewer('c@example.test', ['PILLS' => 5]); // stays pending: not counted
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        foreach ($approve as $id) {
            $this->postJson("/api/v1/reviews/{$id}/approve")->assertOk();
        }
        $this->clearBrowser();

        DB::enableQueryLog();
        $cards = $this->getJson('http://'.self::HOST.'/api/v1/store/products?sort=rating')->assertOk()->json('data');
        $reviewQueries = array_filter(DB::getQueryLog(), fn (array $q) => str_contains($q['query'], '"reviews"'));
        DB::disableQueryLog();
        $this->assertCount(1, $reviewQueries, 'Ratings of all cards come from one query.');

        $this->assertSame(['Juice', 'Shirt', 'Rice', 'Pills'], array_column($cards, 'name'));
        $this->assertSame([
            ['average' => '5.0', 'count' => 1],
            ['average' => '4.0', 'count' => 2],
            ['average' => '4.0', 'count' => 1],
            null,
        ], array_column($cards, 'rating'));

        // Other listings carry the rating too; unknown sorts are refused.
        $byName = collect($this->getJson('http://'.self::HOST.'/api/v1/store/products?sort=name')->assertOk()->json('data'))->keyBy('name');
        $this->assertSame(['average' => '4.0', 'count' => 2], $byName['Shirt']['rating']);
        $this->assertNull($byName['Pills']['rating']);
        $this->getJson('http://'.self::HOST.'/api/v1/store/products?sort=stars')->assertUnprocessable();
    }
}
