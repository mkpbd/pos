<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Shopper\ShopperFindings;
use App\Modules\AI\Application\Tools\Shopper\ShopperToolbox;
use App\Modules\AI\Application\Tools\ToolLoop;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Infrastructure\Models\FaqItem;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * AI2b: the shopper assistant's read-only tools — scoped to the store host's organization (and
 * to the signed-in customer for the order tools), public data only.
 */
class ShopperToolsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const OTHER_HOST = 'other.example.test';

    /** @var array<string, mixed> */
    private array $other;

    private ShopperFindings $findings;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();

        // Another store selling a "Shirt" too: never visible from this store.
        $this->other = $this->openStore('Other Shop', self::OTHER_HOST);
        $foreign = $this->makeProduct($this->other['unit']->id, 'Shirt Foreign', [['F-SHIRT', '99.00']]);
        $this->publish($foreign['id'], ['slug' => 'shirt-foreign']);
        $this->postJson('/api/v1/promotions', ['name' => 'Other store sale', 'type' => 'percent', 'value' => '50', 'scope' => 'order', 'trigger' => 'automatic'])->assertCreated();
        $this->postJson('/api/v1/cms/faq', ['question' => 'Other store delivery?', 'answer_html' => '<p>Other delivery answer</p>'])->assertCreated();

        $this->buildShop();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @return array<string, AiTool>
     */
    private function tools(?string $customerId = null): array
    {
        return $this->inTenant($this->tenant['organization'], function () use ($customerId) {
            $this->findings = app(ShopperFindings::class);

            return app(ShopperToolbox::class)->forShopper($customerId, $this->findings);
        });
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function runTool(string $tool, array $input = [], ?string $customerId = null, ?Organization $organization = null): array
    {
        $tools = $this->tools($customerId);

        return $this->inTenant($organization ?? $this->tenant['organization'], fn () => $tools[$tool]->run($input)->data);
    }

    private function productId(string $sku): string
    {
        return $this->getJson('/api/v1/products?search='.$sku)->json('data.0.id');
    }

    public function test_toolbox_offers_order_tools_only_to_signed_in_shoppers_and_every_schema_is_closed(): void
    {
        $guest = $this->tools();
        $this->assertSame(['search_products', 'get_product', 'store_policies', 'search_help', 'current_offers'], array_keys($guest));

        $signedIn = $this->tools('00000000-0000-4000-8000-000000000001');
        $this->assertSame(['search_products', 'get_product', 'store_policies', 'search_help', 'current_offers', 'my_orders', 'order_status'], array_keys($signedIn));

        foreach ($signedIn as $name => $tool) {
            $definition = $tool->definition();
            $this->assertSame($name, $definition->name);
            $this->assertMatchesRegularExpression('/^[a-z0-9_]{1,64}$/', $definition->name);
            $this->assertSame('object', $definition->inputSchema['type']);
            $this->assertFalse($definition->inputSchema['additionalProperties'], $name);
            foreach (array_keys($definition->inputSchema['properties']) as $property) {
                $this->assertDoesNotMatchRegularExpression('/customer|organization|store_id|branch/', $property, $name);
            }
        }

        // Undeclared parameters are rejected before anything runs.
        foreach (['search_products' => ['query' => 'shirt', 'organization_id' => 'x'], 'my_orders' => ['customer_id' => 'x'], 'current_offers' => ['code' => 'x']] as $tool => $input) {
            try {
                $this->runTool($tool, $input, '00000000-0000-4000-8000-000000000001');
                $this->fail("{$tool} accepted an unknown parameter");
            } catch (ValidationException $e) {
                $this->assertArrayHasKey('arguments', $e->errors());
            }
        }
    }

    public function test_search_products_returns_live_products_of_this_store_with_the_price_paid_now(): void
    {
        $hidden = $this->makeProduct($this->tenant['unit']->id, 'Shirt Draft', [['SHIRT-DRAFT', '300.00']]);
        $this->putJson("/api/v1/online-catalog/products/{$hidden['id']}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $archived = $this->makeProduct($this->tenant['unit']->id, 'Shirt Archived', [['SHIRT-OLD', '200.00']]);
        $this->publish($archived['id']);
        $this->deleteJson("/api/v1/products/{$archived['id']}")->assertSuccessful();
        $this->publish($this->productId('SHIRT'), ['short_description' => 'Soft cotton shirt for kids.']);
        $this->postJson('/api/v1/promotions', [
            'name' => 'Shirt sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products',
            'target_ids' => [$this->productId('SHIRT')], 'trigger' => 'automatic',
        ])->assertCreated();

        $data = $this->runTool('search_products', ['query' => 'shirt']);

        $this->assertSame(['shirt'], array_column($data['products'], 'slug'));
        $this->assertSame(1, $data['total_matches']);
        $this->assertSame('BDT', $data['currency']);
        $shirt = $data['products'][0];
        $this->assertSame(['slug', 'name', 'url', 'category', 'price_text', 'regular_price_text', 'on_sale', 'in_stock', 'rating', 'short_description'], array_keys($shirt));
        $this->assertSame(['Shirt', '/product/shirt', 'BDT 405.00', 'BDT 450.00', true, true, 'Soft cotton shirt for kids.'], [
            $shirt['name'], $shirt['url'], $shirt['price_text'], $shirt['regular_price_text'], $shirt['on_sale'], $shirt['in_stock'], $shirt['short_description'],
        ]);
        $raw = json_encode($data);
        $this->assertStringNotContainsString($this->v['SHIRT'], $raw);
        $this->assertStringNotContainsString('SHIRT', $raw);
        $this->assertStringNotContainsStringIgnoringCase('foreign', $raw);

        // The findings carry the card for the reply (image, price, stock) — never other stores'.
        $this->assertSame(['shirt'], array_keys($this->findings->products()));
        $this->assertSame(['slug' => 'shirt', 'name' => 'Shirt', 'url' => '/product/shirt', 'image_url' => null, 'price_text' => 'BDT 405.00', 'in_stock' => true], $this->findings->products()['shirt']);

        // Cards for products named in earlier turns: live products of this store only.
        $cards = $this->inTenant($this->tenant['organization'], fn () => app(ShopperFindings::class)->cardsForSlugs(['SHIRT', 'shirt-foreign', 'shirt-archived', '../x']));
        $this->assertSame(['shirt'], array_keys($cards));
        $this->assertSame('BDT 405.00', $cards['shirt']['price_text']);
        foreach (['/pages/help' => true, '/account/orders/WEB-1' => true, '//evil.test' => false, 'https://evil.test' => false, '/\evil' => false, '/a/../b' => false, '' => false] as $path => $own) {
            $this->assertSame($own, ShopperFindings::isOwnPath($path), $path);
        }

        // Filters: regular price limit, stock; several words fall back to the best word matches.
        $this->assertSame(['rice'], array_column($this->runTool('search_products', ['query' => 'i', 'max_price' => 99, 'in_stock_only' => true])['products'], 'slug'));
        $this->assertSame(['shirt'], array_column($this->runTool('search_products', ['query' => 'blue shirt please'])['products'], 'slug'));
        // The draft and the archived product never appear, even when named.
        $this->assertSame(['shirt'], array_column($this->runTool('search_products', ['query' => 'shirt draft'])['products'], 'slug'));
        $this->assertSame([], $this->runTool('search_products', ['query' => 'archived'])['products']);

        try {
            $this->runTool('search_products', ['query' => 'shirt', 'category_slug' => 'nope']);
            $this->fail('An unknown category was accepted');
        } catch (BusinessRuleViolation $e) {
            $this->assertSame('UNKNOWN_CATEGORY', $e->errorCode);
        }
        $this->expectException(ValidationException::class);
        $this->runTool('search_products', ['query' => str_repeat('a', 101)]);
    }

    public function test_get_product_shows_public_details_only_and_hides_other_stores_and_hidden_products(): void
    {
        $sizes = $this->makeProduct($this->tenant['unit']->id, 'Kids Tee', [
            ['TEE-S', '300.00', ['Size' => 'S']],
            ['TEE-M', '320.00', ['Size' => 'M']],
        ], ['options' => [['name' => 'Size', 'values' => ['S', 'M']]]]);
        $this->publish($sizes['id'], [
            'slug' => 'kids-tee',
            'short_description' => 'A tee.',
            'specifications' => [['label' => 'Fabric', 'value' => 'Cotton']],
        ]);
        $this->stockUp($this->tenant, [$sizes['variants'][1]['id'] => '3']);

        $data = $this->runTool('get_product', ['slug' => 'Kids-Tee']);

        $this->assertSame(['Kids Tee', '/product/kids-tee', 'BDT 300.00 – 320.00', null, true, 'A tee.'], [
            $data['name'], $data['url'], $data['price_text'], $data['regular_price_text'], $data['in_stock'], $data['short_description'],
        ]);
        $this->assertSame([['name' => 'Size', 'values' => ['S', 'M']]], $data['options']);
        $this->assertSame([
            ['name' => 'S', 'options' => ['Size' => 'S'], 'price_text' => 'BDT 300.00', 'available' => false],
            ['name' => 'M', 'options' => ['Size' => 'M'], 'price_text' => 'BDT 320.00', 'available' => true],
        ], $data['variants']);
        $this->assertSame([['label' => 'Fabric', 'value' => 'Cotton']], $data['specifications']);
        $this->assertSame([
            ['zone' => 'Inside Dhaka', 'method' => 'Home delivery', 'days' => '1–2', 'fee_text' => 'BDT 60.00', 'free_over_text' => 'BDT 2000.00'],
            ['zone' => 'Outside Dhaka', 'method' => 'Courier delivery', 'days' => '3–5', 'fee_text' => 'BDT 120.00', 'free_over_text' => null],
        ], $data['delivery_note']['options']);
        $this->assertTrue($data['delivery_note']['cash_on_delivery']);
        $raw = json_encode($data);
        foreach ([$sizes['id'], $sizes['variants'][0]['id'], 'TEE-S', 'stock_left', 'sku', 'cost', 'purchase'] as $secret) {
            $this->assertStringNotContainsString($secret, $raw);
        }
        $this->assertArrayHasKey('kids-tee', $this->findings->products());

        // Another store's product, an unpublished one and an unknown slug: the same "not found".
        $draft = $this->makeProduct($this->tenant['unit']->id, 'Secret', [['SECRET', '10.00']]);
        $this->putJson("/api/v1/online-catalog/products/{$draft['id']}", ['slug' => 'secret', 'is_published' => false, 'is_featured' => false])->assertOk();
        foreach (['shirt-foreign', 'secret', 'nothing-here'] as $slug) {
            try {
                $this->runTool('get_product', ['slug' => $slug]);
                $this->fail("{$slug} was found");
            } catch (BusinessRuleViolation $e) {
                $this->assertSame(['NOT_FOUND', 'Product not found.'], [$e->errorCode, $e->getMessage()]);
            }
        }
        // From the other store's host, its own product is found and ours is not.
        $this->assertSame('Shirt Foreign', $this->inTenant($this->other['organization'], fn () => app(ShopperToolbox::class)
            ->forShopper(null, app(ShopperFindings::class))['get_product']->run(['slug' => 'shirt-foreign'])->data['name']));
    }

    public function test_store_policies_give_delivery_payment_returns_and_contact_without_private_settings(): void
    {
        $this->putJson('/api/v1/storefront/theme', ['footer' => ['contact' => ['phone' => '+8801712345678', 'email' => 'hello@berry.test']]])->assertOk();

        $data = $this->runTool('store_policies', ['topic' => 'all']);

        $this->assertSame(['delivery', 'payment', 'returns', 'contact'], array_keys($data));
        $inside = $data['delivery']['zones'][0];
        $this->assertSame(['Inside Dhaka', ['Dhaka'], 0], [$inside['zone'], $inside['districts'], $inside['more_districts']]);
        $this->assertSame([
            'name' => 'Home delivery', 'description' => null, 'fee_text' => 'BDT 60.00', 'free_over_text' => 'BDT 2000.00',
            'cash_on_delivery' => true, 'cod_fee_text' => null, 'days' => '1–2',
        ], $inside['methods'][0]);
        $this->assertSame('BDT 20.00', $data['delivery']['zones'][1]['methods'][0]['cod_fee_text']);
        $this->assertSame([
            ['name' => 'Cash on delivery', 'kind' => 'cod', 'instructions' => 'Pay in cash when your order is delivered.'],
            ['name' => 'Bank transfer', 'kind' => 'bank_transfer', 'instructions' => 'Pay to Test Bank, account 123.'],
        ], $data['payment']['methods']);
        $this->assertStringNotContainsString('hold_hours', json_encode($data));
        $this->assertSame([true, 7], [$data['returns']['online_returns'], $data['returns']['window_days']]);
        $this->assertStringContainsString('7 days after delivery', $data['returns']['rules']);
        $this->assertSame(['email' => 'hello@berry.test', 'phone' => '+8801712345678', 'address' => null, 'whatsapp' => false, 'contact_page' => null], $data['contact']);
        $this->assertSame(['/account/orders' => 'My orders'], $this->findings->links());

        // A published page "contact" becomes the contact page; a draft does not count.
        $this->inTenant($this->tenant['organization'], fn () => CmsPage::query()->create(['slug' => 'contact', 'title' => 'Contact us', 'status' => 'draft']));
        $this->assertNull($this->runTool('store_policies', ['topic' => 'contact'])['contact']['contact_page']);
        $this->inTenant($this->tenant['organization'], fn () => CmsPage::query()->where('slug', 'contact')->update(['status' => 'published']));
        $contact = $this->runTool('store_policies', ['topic' => 'contact']);
        $this->assertSame(['contact'], array_keys($contact));
        $this->assertSame('/pages/contact', $contact['contact']['contact_page']);
        $this->assertSame(['/pages/contact' => 'Contact us'], $this->findings->links());

        $this->patchJson('/api/v1/storefront/settings', ['return_window_days' => 0])->assertOk();
        $this->assertFalse($this->runTool('store_policies', ['topic' => 'returns'])['returns']['online_returns']);

        $this->expectException(ValidationException::class);
        $this->runTool('store_policies', ['topic' => 'secrets']);
    }

    public function test_search_help_finds_active_faq_and_visible_pages_in_the_shoppers_language(): void
    {
        $org = $this->tenant['organization'];
        $this->inTenant($org, function () {
            FaqItem::query()->create(['question' => 'How long does delivery take?', 'answer_html' => '<p>Inside Dhaka <b>1–2</b> days.</p>', 'is_active' => true, 'sort_order' => 1,
                'translations' => ['bn' => ['question' => 'ডেলিভারি কত দিনে?', 'answer_html' => '<p>ঢাকার ভিতরে ১–২ দিন।</p>']]]);
            FaqItem::query()->create(['question' => 'Old delivery question', 'answer_html' => '<p>Hidden</p>', 'is_active' => false, 'sort_order' => 2]);
            CmsPage::query()->create(['slug' => 'delivery-info', 'title' => 'Delivery information', 'body_html' => '<p>We deliver across Bangladesh.</p>', 'status' => 'published']);
            CmsPage::query()->create(['slug' => 'delivery-draft', 'title' => 'Delivery draft', 'body_html' => '<p>Draft</p>', 'status' => 'draft']);
            CmsPage::query()->create(['slug' => 'delivery-later', 'title' => 'Delivery later', 'body_html' => '<p>Soon</p>', 'status' => 'published', 'published_at' => now()->addDay()]);
        });

        $data = $this->runTool('search_help', ['query' => 'delivery']);

        $this->assertSame([
            ['type' => 'faq', 'title' => 'How long does delivery take?', 'path' => null, 'excerpt' => 'Inside Dhaka 1–2 days.'],
            ['type' => 'page', 'title' => 'Delivery information', 'path' => '/pages/delivery-info', 'excerpt' => 'We deliver across Bangladesh.'],
        ], $data['results']);
        $this->assertSame(['/pages/delivery-info' => 'Delivery information'], $this->findings->links());

        // With a published FAQ page the FAQ entries link to it.
        $this->inTenant($org, fn () => CmsPage::query()->create(['slug' => 'help', 'title' => 'Help centre', 'template' => 'faq', 'status' => 'published']));
        $this->assertSame('/pages/help', $this->runTool('search_help', ['query' => 'how long'])['results'][0]['path']);
        $this->assertSame(['/pages/help' => 'Help centre'], $this->findings->links());

        // Bangla: the translated texts, found by Bangla words too.
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => true])->assertOk();
        app(LocaleContext::class)->configure(true, 'en', 'bn');
        $bn = $this->runTool('search_help', ['query' => 'ডেলিভারি']);
        $this->assertSame([['type' => 'faq', 'title' => 'ডেলিভারি কত দিনে?', 'path' => '/pages/help', 'excerpt' => 'ঢাকার ভিতরে ১–২ দিন।']], $bn['results']);
        app(LocaleContext::class)->reset();

        $this->assertSame([], $this->runTool('search_help', ['query' => 'other store'])['results']);
    }

    public function test_current_offers_lists_live_automatic_promotions_and_never_coupons(): void
    {
        $shirt = $this->productId('SHIRT');
        $this->postJson('/api/v1/promotions', ['name' => 'Shirt flash sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$shirt],
            'trigger' => 'automatic', 'show_countdown' => true, 'ends_at' => now()->addDays(2)->toIso8601String()])->assertCreated();
        $this->postJson('/api/v1/promotions', ['name' => 'Free delivery over 1000', 'type' => 'free_shipping', 'value' => '0', 'scope' => 'order',
            'min_subtotal' => '1000', 'trigger' => 'automatic'])->assertCreated();
        $coupon = $this->postJson('/api/v1/promotions', ['name' => 'Secret coupon', 'type' => 'percent', 'value' => '20', 'scope' => 'order', 'trigger' => 'coupon'])->assertCreated()->json('data');
        $this->postJson("/api/v1/promotions/{$coupon['id']}/coupons", ['code' => 'SECRET20'])->assertCreated();
        $this->postJson('/api/v1/promotions', ['name' => 'Switched off', 'type' => 'percent', 'value' => '5', 'scope' => 'order', 'trigger' => 'automatic', 'is_active' => false])->assertCreated();
        $this->postJson('/api/v1/promotions', ['name' => 'Next week', 'type' => 'percent', 'value' => '5', 'scope' => 'order', 'trigger' => 'automatic',
            'starts_at' => now()->addWeek()->toIso8601String()])->assertCreated();

        $data = $this->runTool('current_offers');

        $this->assertSame(['Shirt flash sale', 'Free delivery over 1000'], array_column($data['offers'], 'name'));
        [$flash, $free] = $data['offers'];
        $this->assertSame(['percent', '10% off', true], [$flash['kind'], $flash['value_text'], $flash['flash_sale']]);
        $this->assertSame(['type' => 'products', 'items' => [['name' => 'Shirt', 'path' => '/product/shirt']], 'more' => 0], $flash['applies_to']);
        $this->assertNotNull($flash['ends_at']);
        $this->assertSame(['Free delivery', 'whole order', 'BDT 1000.00', null, false], [$free['value_text'], $free['applies_to'], $free['min_order_text'], $free['ends_at'], $free['flash_sale']]);
        $raw = json_encode($data);
        foreach (['SECRET20', 'Secret coupon', 'Switched off', 'Next week', 'Other store sale', $shirt] as $hidden) {
            $this->assertStringNotContainsString($hidden, $raw);
        }
        $this->assertSame(['shirt'], array_keys($this->findings->products()));

        // A product promotion whose products are all hidden is not offered.
        $this->putJson("/api/v1/online-catalog/products/{$shirt}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $this->assertSame(['Free delivery over 1000'], array_column($this->runTool('current_offers')['offers'], 'name'));
    }

    public function test_order_tools_only_see_the_signed_in_customers_own_orders(): void
    {
        $this->asVisitor();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $mine = $this->customerOrder(['SHIRT' => 2, 'JUICE' => 1]);
        $this->travel(1)->minutes();
        $delivered = $this->customerOrder(['RICE' => '1']);
        $this->advance($delivered, 'delivered');
        $rina = $this->orderModel($mine)->customer_id;

        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'karim@example.test');
        $theirs = $this->customerOrder(['JUICE' => 1]);
        $karim = $this->orderModel($theirs)->customer_id;
        $this->assertNotSame($rina, $karim);

        $list = $this->runTool('my_orders', [], $rina);
        $this->assertSame([$delivered, $mine], array_column($list['orders'], 'number'));
        $this->assertSame(['number', 'placed_on', 'status', 'status_label', 'payment_status', 'total_text', 'item_count', 'items', 'path'], array_keys($list['orders'][1]));
        $this->assertSame(['confirmed', '3', ['Shirt', 'Juice'], '/account/orders/'.$mine], [
            $list['orders'][1]['status'], $list['orders'][1]['item_count'], $list['orders'][1]['items'], $list['orders'][1]['path'],
        ]);
        $this->assertSame([$theirs], array_column($this->runTool('my_orders', [], $karim)['orders'], 'number'));

        $status = $this->runTool('order_status', ['order_number' => strtolower($delivered)], $rina);
        $this->assertSame([$delivered, 'delivered', 'Cash on delivery', 'Home delivery', '1–2', false], [
            $status['number'], $status['status'], $status['payment_method'], $status['delivery_method'], $status['estimated_delivery_days'], $status['can_cancel'],
        ]);
        $this->assertSame([['name' => 'Rice', 'quantity' => '1']], $status['items']);
        $this->assertSame(['status' => 'Delivered', 'courier' => 'Pathao', 'tracking_url' => 'https://track.example.test/p?id=TRK-1'], $status['shipment']);
        $this->assertTrue($this->runTool('order_status', ['order_number' => $mine], $rina)['can_cancel']);
        $this->assertSame(['/account/orders/'.$mine => 'Order '.$mine], $this->findings->links());

        $raw = json_encode([$list, $status]);
        foreach (['Rina', 'rina@example.test', '01712345678', '1712', 'Dhanmondi', 'House 1', 'Ring the bell', $rina] as $private) {
            $this->assertStringNotContainsString($private, $raw);
        }

        // Another customer's order and an unknown number: the same "not found".
        $messages = [];
        foreach ([$theirs, 'WEB-999999'] as $number) {
            try {
                $this->runTool('order_status', ['order_number' => $number], $rina);
                $this->fail("{$number} was found");
            } catch (BusinessRuleViolation $e) {
                $messages[] = [$e->errorCode, $e->getMessage()];
            }
        }
        $this->assertSame($messages[0], $messages[1]);
        $this->assertSame('NOT_FOUND', $messages[0][0]);

        // The other store never sees this store's orders, even for the same customer id.
        $otherTools = $this->inTenant($this->other['organization'], fn () => app(ShopperToolbox::class)->forShopper($rina, app(ShopperFindings::class)));
        $this->assertSame([], $this->inTenant($this->other['organization'], fn () => $otherTools['my_orders']->run([])->data['orders']));
    }

    public function test_tool_errors_go_back_to_the_model_through_the_tool_loop(): void
    {
        $fake = $this->fakeAi();
        $fake->callTools([['get_product', ['slug' => 'shirt-foreign']], ['order_status', ['order_number' => 'WEB-1']], ['search_products', ['query' => 'shirt']]])
            ->answer('Here is the shirt.');

        $tools = $this->tools();
        $result = $this->inTenant($this->tenant['organization'], fn () => app(ToolLoop::class)->run(
            new Conversation('You help shoppers.', [Message::user('Do you have shirts?')]), $tools, 3,
        ));

        $this->assertSame('Here is the shirt.', $result->final->text());
        $sent = $this->toolResultsSent($fake, 1);
        $this->assertTrue($sent[0]['error']);
        $this->assertSame('Product not found.', $sent[0]['data']['error']);
        $this->assertTrue($sent[1]['error']);
        $this->assertStringContainsString('Unknown tool', $sent[1]['data']['error']);
        $this->assertFalse($sent[2]['error']);
        $this->assertSame(['shirt'], array_column($sent[2]['data']['products'], 'slug'));
        $this->assertSame(['shirt'], array_keys($this->findings->products()));
    }
}
