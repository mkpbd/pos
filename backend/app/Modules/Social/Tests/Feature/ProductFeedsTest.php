<?php

namespace App\Modules\Social\Tests\Feature;

use App\Modules\Social\Tests\Concerns\BuildsSocial;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use SimpleXMLElement;
use Tests\TestCase;

/**
 * P2b: catalog feeds for Meta, TikTok and Pinterest — the admin list, enabling, rotating; the
 * public XML (RSS 2.0 + g:) and CSV with variants as items, prices, sale prices, availability,
 * absolute links with UTM tags and images; regeneration after catalog changes, the Bangla feed,
 * 404s for unknown, rotated, disabled or other-channel tokens, permissions and isolation.
 */
class ProductFeedsTest extends TestCase
{
    use BuildsSocial, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->shop = $this->socialShop();
    }

    /**
     * @return array<string, array<string, mixed>> feeds by channel
     */
    private function feeds(): array
    {
        return array_column($this->getJson('/api/v1/social/feeds')->assertOk()->json('data'), null, 'channel');
    }

    private function fetch(string $url): TestResponse
    {
        $this->asVisitor();
        $response = $this->get($url);
        $this->actingAsUser($this->shop['tenant']['admin']);

        return $response;
    }

    /**
     * @return list<array<string, mixed>> items keyed by element name (g: and plain)
     */
    private function items(string $xml): array
    {
        $doc = new SimpleXMLElement($xml);
        $items = [];
        foreach ($doc->channel->item as $item) {
            $row = [];
            foreach ($item->children() as $name => $value) {
                $row[$name] = (string) $value;
            }
            foreach ($item->children('g', true) as $name => $value) {
                $row['g:'.$name] = isset($row['g:'.$name]) ? $row['g:'.$name].'|'.(string) $value : (string) $value;
            }
            $items[] = $row;
        }

        return $items;
    }

    public function test_feeds_are_listed_disabled_and_answer_once_enabled(): void
    {
        $feeds = $this->feeds();
        $this->assertSame(['meta', 'tiktok', 'pinterest'], array_keys($feeds));
        foreach ($feeds as $channel => $feed) {
            $this->assertFalse($feed['enabled']);
            $this->assertMatchesRegularExpression('#^http://berry\.test/feeds/'.$channel.'/[a-f0-9]{64}\.xml$#', $feed['xml_url']);
            $this->assertSame(substr($feed['xml_url'], 0, -4).'.csv', $feed['csv_url']);
            $this->assertNull($feed['item_count']);
        }
        $this->assertSame($feeds, $this->feeds(), 'Created once.');
        $this->fetch($feeds['meta']['xml_url'])->assertNotFound();

        $enabled = $this->patchJson('/api/v1/social/feeds/meta', ['enabled' => true])->assertOk()->json('data');
        $this->assertSame([true, 3], [$enabled['enabled'], $enabled['item_count']]);
        $this->assertNotNull($enabled['last_generated_at']);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'social.feed_updated')->count());

        $response = $this->fetch($feeds['meta']['xml_url'])->assertOk()->assertHeader('Content-Type', 'application/xml; charset=UTF-8')->assertHeader('X-Robots-Tag', 'noindex');
        // The URL is the secret: never kept by a shared cache (a rotated token must stop working at once).
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $xml = $response->streamedContent();
        $this->assertStringContainsString('xmlns:g="http://base.google.com/ns/1.0"', $xml);
        $items = $this->items($xml);
        $this->assertSame(['SHIRT-M', 'SHIRT-L', 'CAP'], array_column($items, 'g:id'));

        $variants = array_column($this->shop['shirt']['variants'], 'id', 'sku');
        [$m, $l, $cap] = $items;
        $this->assertSame($this->shop['shirt']['id'], $m['g:item_group_id']);
        $this->assertSame(['Polo Shirt - M', 'Soft & breathable cotton.'], [$m['title'], $m['description']]);
        $this->assertSame('http://berry.test/product/polo-shirt?variant='.$variants['SHIRT-M'].'&utm_source=meta&utm_medium=shop', $m['link']);
        $this->assertStringStartsWith('http://berry.test/storage/', $m['g:image_link']);
        $this->assertStringStartsWith('http://berry.test/storage/', $m['g:additional_image_link']);
        $this->assertSame(['in_stock', 'new', '450.00 BDT', 'Polo', 'Clothes > Shirts', 'M'], [$m['g:availability'], $m['g:condition'], $m['g:price'], $m['g:brand'], $m['g:product_type'], $m['g:size']]);
        $this->assertArrayNotHasKey('g:sale_price', $m);
        $this->assertSame(['out_of_stock', '500.00 BDT', 'L'], [$l['g:availability'], $l['g:price'], $l['g:size']]);
        // One variant: no item group, the store's name as the brand.
        $this->assertArrayNotHasKey('g:item_group_id', $cap);
        $this->assertSame(['Sun Cap', 'A cap for sunny days', 'http://berry.test/product/sun-cap?utm_source=meta&utm_medium=shop', 'Berry Kids'], [$cap['title'], $cap['description'], $cap['link'], $cap['g:brand']]);
        $this->assertArrayNotHasKey('g:additional_image_link', $cap);

        // CSV: the same items with a header row.
        $csv = $this->fetch($feeds['meta']['csv_url'])->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8')->streamedContent();
        $rows = array_map(fn (string $line) => str_getcsv($line, ',', '"', ''), array_values(array_filter(explode("\n", $csv))));
        $this->assertSame(['id', 'item_group_id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'sale_price_effective_date', 'link', 'image_link', 'additional_image_link', 'brand', 'product_type', 'color', 'size'], $rows[0]);
        $this->assertCount(4, $rows);
        $byId = array_column(array_map(fn (array $r) => array_combine($rows[0], $r), array_slice($rows, 1)), null, 'id');
        $this->assertSame(['Polo Shirt - L', 'out_of_stock', '500.00 BDT', 'L'], [$byId['SHIRT-L']['title'], $byId['SHIRT-L']['availability'], $byId['SHIRT-L']['price'], $byId['SHIRT-L']['size']]);

        // The other channels stay off until enabled, and tag their links with their name.
        $this->fetch($feeds['tiktok']['xml_url'])->assertNotFound();
        $this->patchJson('/api/v1/social/feeds/tiktok', ['enabled' => true])->assertOk();
        $this->assertStringContainsString('utm_source=tiktok', $this->fetch($feeds['tiktok']['xml_url'])->assertOk()->streamedContent());
    }

    public function test_feeds_follow_catalog_changes_promotions_and_languages(): void
    {
        $url = $this->patchJson('/api/v1/social/feeds/pinterest', ['enabled' => true])->assertOk()->json('data.xml_url');
        $this->assertSame('120.00 BDT', $this->items($this->fetch($url)->streamedContent())[2]['g:price']);

        // An automatic promotion on the cap: the regular price stays, the sale price is the promotional one.
        $endsAt = now()->addDays(5)->startOfMinute();
        $this->postJson('/api/v1/promotions', [
            'name' => 'Cap week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->shop['cap']['id']],
            'trigger' => 'automatic', 'ends_at' => $endsAt->toIso8601String(),
        ])->assertCreated();
        $cap = $this->items($this->fetch($url)->streamedContent())[2];
        $this->assertSame(['120.00 BDT', '108.00 BDT'], [$cap['g:price'], $cap['g:sale_price']]);
        [, $until] = explode('/', $cap['g:sale_price_effective_date']);
        $this->assertTrue($endsAt->equalTo(CarbonImmutable::parse($until)));

        // A product taken off the store disappears at once.
        $this->putJson("/api/v1/online-catalog/products/{$this->shop['cap']['id']}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $this->assertSame(['SHIRT-M', 'SHIRT-L'], array_column($this->items($this->fetch($url)->streamedContent()), 'g:id'));
        $this->assertSame(2, $this->feeds()['pinterest']['item_count']);

        // Bangla: translated names and Bangla links (Bangla is on by default).
        $this->publish($this->shop['shirt']['id'], ['slug' => 'polo-shirt', 'translations' => ['bn' => ['name' => 'পোলো শার্ট']]]);
        $bangla = $this->items($this->fetch($url.'?lang=bn')->streamedContent())[0];
        $this->assertSame('পোলো শার্ট - M', $bangla['title']);
        $this->assertStringContainsString('lang=bn&utm_source=pinterest', $bangla['link']);
        $this->assertSame('Polo Shirt - M', $this->items($this->fetch($url)->streamedContent())[0]['title']);
    }

    public function test_tokens_rotate_and_only_open_their_own_feed(): void
    {
        $meta = $this->patchJson('/api/v1/social/feeds/meta', ['enabled' => true])->assertOk()->json('data');
        $token = substr(basename($meta['xml_url']), 0, 64);
        $this->fetch('http://berry.test/feeds/tiktok/'.$token.'.xml')->assertNotFound();
        $this->fetch('http://anything.example/feeds/meta/'.$token.'.csv')->assertOk();

        $rotated = $this->postJson('/api/v1/social/feeds/meta/rotate')->assertOk()->json('data');
        $this->assertNotSame($meta['xml_url'], $rotated['xml_url']);
        $this->fetch($meta['xml_url'])->assertNotFound();
        $this->fetch($rotated['xml_url'])->assertOk();
        $audit = DB::table('audit_logs')->where('action', 'social.feed_token_rotated')->get();
        $this->assertCount(1, $audit);
        $this->assertStringNotContainsString($token, json_encode($audit->all()));

        $this->patchJson('/api/v1/social/feeds/meta', ['enabled' => false])->assertOk()->assertJsonPath('data.enabled', false);
        $this->fetch($rotated['xml_url'])->assertNotFound();
        $this->patchJson('/api/v1/social/feeds/facebook', ['enabled' => true])->assertNotFound();

        // Permissions.
        $this->actingAsUser($this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::Cashier));
        $this->getJson('/api/v1/social/feeds')->assertForbidden();
        $this->actingAsUser($this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::OnlineStoreManager));
        $this->patchJson('/api/v1/social/feeds/meta', ['enabled' => true])->assertOk();

        // Another store has its own feeds and catalog.
        $other = $this->openStore('Other Shop', 'other.test');
        $cup = $this->makeProduct($other['unit']->id, 'Tea Cup', [['CUP', '80.00']]);
        $this->publish($cup['id'], ['slug' => 'tea-cup']);
        $otherUrl = $this->patchJson('/api/v1/social/feeds/meta', ['enabled' => true])->assertOk()->json('data.xml_url');
        $this->assertNotSame($rotated['xml_url'], $otherUrl);
        $this->asVisitor();
        $this->assertSame(['CUP'], array_column($this->items($this->get($otherUrl)->streamedContent()), 'g:id'));
        $this->assertSame(['SHIRT-M', 'SHIRT-L', 'CAP'], array_column($this->items($this->get($rotated['xml_url'])->streamedContent()), 'g:id'));
    }
}
