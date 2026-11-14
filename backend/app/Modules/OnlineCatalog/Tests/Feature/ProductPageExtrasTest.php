<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P1b: the product page's video and custom badges (saved on the web listing), the store's
 * delivery and cash-on-delivery note, and the page's builder zones and question count.
 */
class ProductPageExtrasTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * @return array<string, mixed>
     */
    private function page(string $slug, string $query = '', string $host = self::HOST): array
    {
        return $this->getJson("http://{$host}/api/v1/store/products/{$slug}".($query === '' ? '' : '?'.$query))->assertOk()->json('data');
    }

    /**
     * @param  array<string, mixed>  $listing
     */
    private function saveListing(string $productId, array $listing): TestResponse
    {
        return $this->putJson("/api/v1/online-catalog/products/{$productId}", $listing + ['is_published' => true, 'is_featured' => false]);
    }

    public function test_a_listing_keeps_a_video_and_two_custom_badges_shown_on_the_page_and_the_cards(): void
    {
        $shirt = $this->page('shirt')['id'];
        $this->actingAsUser($this->tenant['admin']);

        $invalid = fn (array $listing, string $field) => $this->saveListing($shirt, $listing)->assertUnprocessable()->assertJsonValidationErrors([$field], 'error.details');
        $invalid(['video_url' => 'https://example.com/clip.mp4'], 'video_url');
        $invalid(['video_url' => 'https://youtu.be/dQw4w9WgXcQ'.str_repeat('x', 500)], 'video_url');
        $invalid(['badges' => [['text' => 'A', 'tone' => 'sale'], ['text' => 'B', 'tone' => 'new'], ['text' => 'C', 'tone' => 'info']]], 'badges');
        $invalid(['badges' => [['text' => str_repeat('x', 25), 'tone' => 'sale']]], 'badges.0.text');
        $invalid(['badges' => [['text' => '   ', 'tone' => 'sale']]], 'badges.0.text');
        $invalid(['badges' => [['text' => 'Hot', 'tone' => 'pink']]], 'badges.0.tone');
        $invalid(['badges' => [['text' => 'Hot', 'tone' => 'sale', 'translations' => ['bn' => ['text' => str_repeat('ক', 25)]]]]], 'badges.0.translations.bn.text');
        $invalid(['badges' => [['text' => 'Hot', 'tone' => 'sale', 'colour' => 'red']]], 'badges.0');

        $listing = $this->saveListing($shirt, [
            'video_url' => ' https://www.youtube.com/watch?v=dQw4w9WgXcQ ',
            'badges' => [
                ['text' => ' Eid special ', 'tone' => 'sale', 'translations' => ['bn' => ['text' => 'ঈদ স্পেশাল']]],
                ['text' => 'Handmade', 'tone' => 'dark'],
            ],
        ])->assertOk()->json('data.listing');
        $badges = [
            ['text' => 'Eid special', 'tone' => 'sale', 'translations' => ['bn' => ['text' => 'ঈদ স্পেশাল']]],
            ['text' => 'Handmade', 'tone' => 'dark', 'translations' => ['bn' => []]],
        ];
        $this->assertSame(['https://www.youtube.com/watch?v=dQw4w9WgXcQ', $badges], [$listing['video_url'], $listing['badges']]);
        $this->assertSame($badges, $this->getJson("/api/v1/online-catalog/products/{$shirt}")->assertOk()->json('data.listing.badges'));
        // Saving without them keeps them.
        $this->saveListing($shirt, ['short_description' => 'Soft cotton'])->assertOk()->assertJsonPath('data.listing.video_url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        $this->asVisitor();

        $page = $this->page('shirt');
        $this->assertSame(['provider' => 'youtube', 'id' => 'dQw4w9WgXcQ', 'url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'], $page['video']);
        $this->assertSame([['text' => 'Eid special', 'tone' => 'sale'], ['text' => 'Handmade', 'tone' => 'dark']], $page['badges']);
        $this->assertSame([['text' => 'ঈদ স্পেশাল', 'tone' => 'sale'], ['text' => 'Handmade', 'tone' => 'dark']], $this->page('shirt', 'lang=bn')['badges']);
        $cards = array_column($this->getJson($this->storeUrl('products'))->assertOk()->json('data'), null, 'slug');
        $this->assertSame([['text' => 'Eid special', 'tone' => 'sale'], ['text' => 'Handmade', 'tone' => 'dark']], $cards['shirt']['badges']);
        $this->assertSame([[], null], [$cards['juice']['badges'], $this->page('juice')['video']]);

        // Vimeo; then both cleared.
        $this->actingAsUser($this->tenant['admin']);
        $this->saveListing($shirt, ['video_url' => 'https://vimeo.com/76979871'])->assertOk();
        $this->assertSame(['provider' => 'vimeo', 'id' => '76979871', 'url' => 'https://vimeo.com/76979871'], $this->page('shirt')['video']);
        $this->saveListing($shirt, ['video_url' => '', 'badges' => null])->assertOk()->assertJsonPath('data.listing.video_url', null)->assertJsonPath('data.listing.badges', []);
        $this->asVisitor();
        $page = $this->page('shirt');
        $this->assertSame([null, []], [$page['video'], $page['badges']]);
    }

    public function test_the_delivery_note_lists_each_zone_with_its_days_fee_and_cash_on_delivery(): void
    {
        $note = $this->page('shirt')['delivery'];
        $this->assertSame([
            'options' => [
                ['zone' => 'Inside Dhaka', 'method' => 'Home delivery', 'min_days' => 1, 'max_days' => 2, 'fee' => '60.00', 'free_over' => '2000.00'],
                ['zone' => 'Outside Dhaka', 'method' => 'Courier delivery', 'min_days' => 3, 'max_days' => 5, 'fee' => '120.00', 'free_over' => null],
            ],
            'cod_available' => true,
        ], $note);
        // Store-level: the same on every product.
        $this->assertSame($note, $this->page('juice')['delivery']);

        // A second method in a zone: the fee depends on the choice at checkout.
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['translations' => ['bn' => ['name' => 'হোম ডেলিভারি']]])->assertOk();
        $this->asVisitor();
        $this->assertSame('হোম ডেলিভারি', $this->page('shirt', 'lang=bn')['delivery']['options'][0]['method']);

        $this->actingAsUser($this->tenant['admin']);
        $this->postJson("/api/v1/shipping/zones/{$this->zones['inside']}/methods", [
            'name' => 'Express', 'fee' => '150', 'cod_allowed' => false, 'cod_fee' => '0', 'eta_min_days' => 0, 'eta_max_days' => 1,
        ])->assertCreated();
        $this->asVisitor();
        $this->assertSame(
            ['zone' => 'Inside Dhaka', 'method' => null, 'min_days' => 0, 'max_days' => 2, 'fee' => null, 'free_over' => null],
            $this->page('shirt')['delivery']['options'][0],
        );

        // Cash on delivery switched off for the store.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson('/api/v1/payment-gateways/cod', ['is_enabled' => false])->assertOk();
        $this->asVisitor();
        $this->assertFalse($this->page('shirt')['delivery']['cod_available']);

        // Inactive zones are left out; with none left, there is no note.
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['outside']}", ['is_active' => false])->assertOk();
        $this->asVisitor();
        $this->assertSame(['Inside Dhaka'], array_column($this->page('shirt')['delivery']['options'], 'zone'));
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['inside']}", ['district_ids' => []])->assertOk();
        $this->asVisitor();
        $this->assertNull($this->page('shirt')['delivery'], 'A zone that covers no district cannot deliver.');
    }

    public function test_another_store_without_shipping_has_no_delivery_note(): void
    {
        $other = $this->openStore('Other Shop', 'other.test');
        $tea = $this->makeProduct($other['unit']->id, 'Tea', [['TEA', '50.00']], ['track_stock' => false]);
        $this->publish($tea['id']);
        $this->asVisitor();

        $page = $this->page('tea', host: 'other.test');
        $this->assertNull($page['delivery']);
        $this->assertNotNull($this->page('shirt')['delivery']);
    }

    public function test_the_page_carries_its_three_builder_zones_and_the_question_count(): void
    {
        $page = $this->page('shirt');
        $this->assertSame(['product.below_price' => null, 'product.after' => null, 'product.bottom' => null], $page['zones']);
        $this->assertSame(0, $page['questions_count']);
        $this->assertSame(['related', 'frequently_bought', 'frequently_bought_source'], array_keys($this->getJson($this->storeUrl('products/shirt/related'))->assertOk()->json('data')));
    }
}
