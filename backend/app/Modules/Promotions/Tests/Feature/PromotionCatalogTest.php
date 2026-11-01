<?php

namespace App\Modules\Promotions\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Promotions on product cards and pages, and the hot deals homepage section (E8b).
 */
class PromotionCatalogTest extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const HOST = 'berry.test';

    /** @var array<string, mixed> */
    private array $t;

    /** @var array<string, string> product ids */
    private array $p = [];

    private Promotion $juiceWeek;

    protected function setUp(): void
    {
        parent::setUp();
        $this->t = $t = $this->openStore('Berry Kids', self::HOST);
        $org = $t['organization'];
        $pran = $this->brand($org, 'Pran');
        $drinks = $this->category($org, 'Drinks');
        $juices = $this->category($org, 'Juices', $drinks);

        $mango = $this->makeProduct($t['unit']->id, 'Mango Juice', [['MANGO-S', '100.00', ['Size' => 'Small']], ['MANGO-L', '120.00', ['Size' => 'Large']]], [
            'brand_id' => $pran, 'category_id' => $juices, 'options' => [['name' => 'Size', 'values' => ['Small', 'Large']]],
        ]);
        $polo = $this->makeProduct($t['unit']->id, 'Polo Shirt', [['POLO', '450.00']]);
        $rice = $this->makeProduct($t['unit']->id, 'Rice', [['RICE', '60.00']], ['category_id' => $drinks]);
        foreach (['mango' => $mango, 'polo' => $polo, 'rice' => $rice] as $key => $product) {
            $this->publish($product['id']);
            $this->p[$key] = $product['id'];
        }

        $this->juiceWeek = $this->makePromotion($org, [
            'name' => 'Juice week', 'type' => 'percent', 'value' => '10', 'scope' => 'brands', 'target_ids' => [$pran],
            'show_countdown' => true, 'ends_at' => now()->addDays(3)->toIso8601String(),
        ]);
        // Coupon promotions never show on the storefront.
        $this->makePromotion($org, ['name' => 'Polo coupon', 'type' => 'percent', 'value' => '50', 'scope' => 'products', 'target_ids' => [$polo['id']], 'trigger' => 'coupon']);
        // Category targets include sub-categories; 'Drinks' reaches the juice too, but 10% beats 5.
        $this->makePromotion($org, ['name' => 'Drinks 5 off', 'type' => 'fixed', 'value' => '5', 'scope' => 'categories', 'target_ids' => [$drinks]]);
    }

    /**
     * @return array<string, array<string, mixed>> cards by name
     */
    private function cards(string $query = ''): array
    {
        return array_column($this->getJson('http://'.self::HOST.'/api/v1/store/products'.($query === '' ? '' : '?'.$query))->assertOk()->json('data'), null, 'name');
    }

    public function test_cards_and_product_pages_show_the_automatic_promotion(): void
    {
        $cards = $this->cards();
        $this->assertSame([
            'id' => $this->juiceWeek->id,
            'name' => 'Juice week',
            'type' => 'percent',
            'value' => '10.00',
            'ends_at' => $this->juiceWeek->ends_at->toIso8601String(),
            'show_countdown' => true,
            'price' => '90.00',
        ], $cards['Mango Juice']['promotion']);
        $this->assertSame('100.00', $cards['Mango Juice']['price']);
        $this->assertNull($cards['Polo Shirt']['promotion']);
        $this->assertSame(['Drinks 5 off', 'fixed', '5.00', false, '55.00', null], [
            $cards['Rice']['promotion']['name'], $cards['Rice']['promotion']['type'], $cards['Rice']['promotion']['value'],
            $cards['Rice']['promotion']['show_countdown'], $cards['Rice']['promotion']['price'], $cards['Rice']['promotion']['ends_at'],
        ]);

        // Filters and sorting keep the base price.
        $this->assertArrayHasKey('Mango Juice', $this->cards('price_min=95'));
        $this->assertSame(['Rice', 'Mango Juice', 'Polo Shirt'], array_keys($this->cards('sort=price_asc')));

        $page = $this->getJson('http://'.self::HOST.'/api/v1/store/products/mango-juice')->assertOk()->json('data');
        $this->assertSame(['90.00', '108.00'], array_column($page['variants'], 'promo_price'));
        $this->assertSame(['Juice week', '90.00'], [$page['promotion']['name'], $page['promotion']['price']]);
        $polo = $this->getJson('http://'.self::HOST.'/api/v1/store/products/polo-shirt')->assertOk()->json('data');
        $this->assertNull($polo['promotion']);
        $this->assertSame([null], array_column($polo['variants'], 'promo_price'));

        // Ended, switched off or used up: gone from the cards.
        $this->juiceWeek->forceFill(['ends_at' => now()->subMinute()])->save();
        $this->assertSame('Drinks 5 off', $this->cards()['Mango Juice']['promotion']['name']);
    }

    public function test_hot_deals_section_shows_flash_sale_products_and_hides_when_none_runs(): void
    {
        $org = $this->t['organization'];
        $url = '/api/v1/storefront/homepage-sections';
        $this->postJson($url, ['type' => 'hot_deals', 'config' => ['limit' => 3]])->assertUnprocessable()->assertJsonValidationErrors('config.limit', 'error.details');
        $this->postJson($url, ['type' => 'hot_deals', 'config' => ['promotion_id' => '01900000-0000-7000-8000-000000000000']])
            ->assertStatus(422)->assertJsonPath('error.code', 'PROMOTION_NOT_FOUND');
        $notCountdown = Promotion::query()->withoutGlobalScopes()->where('name', 'Drinks 5 off')->value('id');
        $this->postJson($url, ['type' => 'hot_deals', 'config' => ['promotion_id' => $notCountdown]])->assertStatus(422)->assertJsonPath('error.code', 'PROMOTION_NOT_FOUND');
        $this->postJson($url, ['type' => 'hot_deals', 'config' => ['view_all_url' => 'javascript:alert(1)']])->assertUnprocessable();

        $all = $this->postJson($url, ['type' => 'hot_deals', 'title' => 'Hot deals', 'config' => ['limit' => 8, 'view_all_url' => '/shop']])->assertCreated()->json('data');
        $this->assertSame(['promotion_id' => null, 'limit' => 8, 'view_all_url' => '/shop'], $all['config']);
        $types = array_column($this->getJson($url.'/types')->json('data'), null, 'type');
        $this->assertSame(['promotion_id' => null, 'limit' => 8, 'view_all_url' => null], $types['hot_deals']['defaults']);

        // A second flash sale ending sooner, on the polo shirt.
        $polo = $this->makePromotion($org, [
            'name' => 'Polo flash', 'type' => 'fixed', 'value' => '50', 'scope' => 'products', 'target_ids' => [$this->p['polo']],
            'show_countdown' => true, 'ends_at' => now()->addHours(5)->toIso8601String(),
        ]);
        $one = $this->postJson($url, ['type' => 'hot_deals', 'title' => 'Juice deals', 'config' => ['promotion_id' => $this->juiceWeek->id]])->assertCreated()->json('data');

        $sections = array_column($this->getJson('http://'.self::HOST.'/api/v1/store/homepage')->assertOk()->json('data.sections'), null, 'id');
        $this->assertSame($polo->ends_at->toIso8601String(), $sections[$all['id']]['ends_at']);
        $this->assertEqualsCanonicalizing(['Mango Juice', 'Polo Shirt'], array_column($sections[$all['id']]['products'], 'name'));
        $this->assertSame(['Polo flash', '400.00'], [
            array_column($sections[$all['id']]['products'], null, 'name')['Polo Shirt']['promotion']['name'],
            array_column($sections[$all['id']]['products'], null, 'name')['Polo Shirt']['promotion']['price'],
        ]);
        $this->assertSame(['Mango Juice'], array_column($sections[$one['id']]['products'], 'name'));
        $this->assertSame($this->juiceWeek->ends_at->toIso8601String(), $sections[$one['id']]['ends_at']);
        $this->assertSame('hot_deals', $sections[$one['id']]['type']);

        // When the flash sales end, the sections render nothing (and show as empty in the preview).
        Promotion::query()->withoutGlobalScopes()->whereKey([$polo->id, $this->juiceWeek->id])->update(['is_active' => false]);
        // A raw write bypasses the model events: invalidate the cached homepage as the app would (E12).
        app(StorefrontContentVersion::class)->bump($polo->organization_id);
        $this->assertSame([], array_values(array_filter($this->getJson('http://'.self::HOST.'/api/v1/store/homepage')->json('data.sections'), fn ($s) => $s['type'] === 'hot_deals')));
        $preview = array_column($this->getJson('http://'.self::HOST.'/api/v1/store/homepage?preview=1')->json('data.sections'), null, 'id');
        $this->assertSame('empty', $preview[$all['id']]['state'] ?? null);
    }
}
