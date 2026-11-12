<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * B8a: the review wall and the ratings chart with real, verified reviews — approved reviews
 * of products on sale only, the public author name and nothing more of the customer, minimum
 * rating, ordering, the summary, bodies cut to 600 characters, one product's reviews, and
 * another organization's reviews never showing.
 */
class StoreBuilderB8aReviewsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    /** @var array<string, string> product ids by SKU */
    private array $p = [];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.review_rate_limit' => 100]);
        $this->buildShop();
    }

    /**
     * A delivered order of $sku by a new shopper, then their review — approved unless asked otherwise.
     */
    private function review(string $email, string $name, string $sku, int $rating, string $body, bool $approve = true): string
    {
        $this->clearBrowser();
        $this->registerShopper(self::HOST, $email, extra: ['name' => $name]);
        $number = $this->customerOrder([$sku => 1]);
        $this->advance($number, 'delivered');
        foreach ($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines') as $line) {
            $this->p[$line['sku']] = $line['product_id'];
        }
        $id = $this->browse('POST', $this->storeUrl('account/reviews'), ['product_id' => $this->p[$sku], 'rating' => $rating, 'title' => "{$rating} stars", 'body' => $body])
            ->assertCreated()->json('data.id');
        if ($approve) {
            $this->actingAsUser($this->tenant['admin']);
            $this->postJson("/api/v1/reviews/{$id}/approve")->assertOk();
            $this->asVisitor();
        }
        $this->travel(1)->minutes();

        return $id;
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private function publishHome(array $elements): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');
        $revision = $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$home}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section', 'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->asVisitor();
    }

    public function test_review_walls_and_ratings_show_approved_reviews_of_products_on_sale_only(): void
    {
        $long = trim(str_repeat('Fresh and tasty juice, delivered cold. ', 20));
        $rina = $this->review('rina@example.test', 'Rina Akter', 'JUICE', 5, $long);
        $karim = $this->review('karim@example.test', 'Karim', 'SHIRT', 4, 'Good shirt, fits well and washes nicely.');
        $nusrat = $this->review('nusrat@example.test', 'Nusrat Jahan Chowdhury', 'RICE', 3, 'The rice is fine, nothing special.');
        $this->review('tanvir@example.test', 'Tanvir Hasan', 'JUICE', 2, 'Still waiting for approval here.', false);
        $pills = $this->review('mitu@example.test', 'Mitu Das', 'PILLS', 5, 'Helped a lot, will buy again.');
        // Pills are taken off the online shop: their review no longer shows anywhere.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson("/api/v1/online-catalog/products/{$this->p['PILLS']}", ['is_published' => false, 'is_featured' => false])->assertOk();

        $this->publishHome([
            ['id' => 'e_latest', 'type' => 'review_wall', 'props' => ['source' => 'latest', 'min_rating' => 3, 'limit' => 3]],
            ['id' => 'e_top', 'type' => 'review_wall', 'props' => ['source' => 'top_rated', 'min_rating' => 4, 'show_product' => false, 'show_summary' => false]],
            ['id' => 'e_juice', 'type' => 'review_wall', 'props' => ['source' => 'product', 'product_id' => $this->p['JUICE'], 'min_rating' => 1]],
            ['id' => 'e_pills', 'type' => 'review_wall', 'props' => ['source' => 'product', 'product_id' => $this->p['PILLS']]],
            ['id' => 'e_ratings', 'type' => 'chart', 'props' => ['data_source' => 'store.rating_breakdown']],
            ['id' => 'e_juice_ratings', 'type' => 'chart', 'props' => ['data_source' => 'store.rating_breakdown', 'source_product_id' => $this->p['JUICE']]],
        ]);

        $page = $this->browse('GET', $this->storeUrl('builder/pages/home'))->assertOk()->json('data');
        $latest = $page['data']['e_latest'];
        // Newest first, approved and on sale only (the pending review and the pills are missing).
        $this->assertSame([$nusrat, $karim, $rina], array_column($latest['reviews'], 'id'));
        $this->assertSame(['id', 'author', 'rating', 'title', 'body', 'created_at', 'product'], array_keys($latest['reviews'][0]));
        $this->assertSame(['Nusrat C.', 'Karim', 'Rina A.'], array_column($latest['reviews'], 'author'));
        $this->assertStringNotContainsString('example.test', (string) json_encode($page['data']));
        $this->assertStringNotContainsString('Chowdhury', (string) json_encode($page['data']));
        // Bodies are plain text cut to 600 characters.
        $this->assertLessThanOrEqual(600, mb_strlen($latest['reviews'][2]['body']));
        $this->assertGreaterThan(500, mb_strlen($latest['reviews'][2]['body']));
        $this->assertStringEndsWith('…', $latest['reviews'][2]['body']);
        $this->assertSame('Shirt', $latest['reviews'][1]['product']['name']);
        $this->assertStringStartsWith('/product/', $latest['reviews'][1]['product']['url']);
        // The summary covers every approved review of a product on sale (not only ≥ min rating).
        $this->assertSame(['average' => '4.0', 'count' => 3], $latest['summary']);

        // Best first, at least 4 stars, no product and no summary.
        $this->assertSame([$rina, $karim], array_column($page['data']['e_top']['reviews'], 'id'));
        $this->assertNull($page['data']['e_top']['summary']);
        $this->assertSame([null, null], array_column($page['data']['e_top']['reviews'], 'product'));
        // One product's reviews; a product not on sale has none: left out.
        $this->assertSame([$rina], array_column($page['data']['e_juice']['reviews'], 'id'));
        $this->assertSame(['average' => '5.0', 'count' => 1], $page['data']['e_juice']['summary']);
        $this->assertArrayNotHasKey('e_pills', $page['data']);
        $ids = [];
        foreach ($page['sections'][0]['columns'][0]['elements'] as $element) {
            $ids[] = $element['id'];
        }
        $this->assertNotContains('e_pills', $ids);

        // Ratings chart: approved reviews of products on sale per star, 5 first.
        $this->assertSame(['labels' => ['5 stars', '4 stars', '3 stars', '2 stars', '1 star'], 'series' => [['id' => 's1', 'name' => 'Reviews', 'values' => [1, 1, 1, 0, 0]]]], $page['data']['e_ratings']);
        $this->assertSame([1, 0, 0, 0, 0], $page['data']['e_juice_ratings']['series'][0]['values']);
        $this->assertNotContains($pills, array_column($page['data']['e_latest']['reviews'], 'id'));

        // Approving the pending review changes the cached page.
        $this->actingAsUser($this->tenant['admin']);
        $pending = $this->getJson('/api/v1/reviews?status=pending')->assertOk()->json('data.0.id');
        $this->postJson("/api/v1/reviews/{$pending}/approve")->assertOk();
        $this->asVisitor();
        $page = $this->browse('GET', $this->storeUrl('builder/pages/home'))->assertOk()->json('data');
        $this->assertSame(['average' => '3.5', 'count' => 4], $page['data']['e_latest']['summary']);
        $this->assertSame([1, 1, 1, 1, 0], $page['data']['e_ratings']['series'][0]['values']);

        // Another organization sees none of these reviews, even for the same product ids.
        $other = $this->provisionTenant('Mango Mart');
        $showcase = app(ReviewShowcase::class);
        $this->assertSame([], $this->inTenant($other['organization'], fn () => $showcase->approved(array_values($this->p), 1, 'latest', 12, 600)));
        $this->assertSame(['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0], $this->inTenant($other['organization'], fn () => $showcase->ratingCounts(array_values($this->p))));
        $this->assertCount(5, $this->inTenant($this->tenant['organization'], fn () => $showcase->approved(array_values($this->p), 1, 'latest', 12, 600)));
    }
}
